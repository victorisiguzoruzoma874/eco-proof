# ProofChain Runbook

**Operational guide for running ProofChain.**

This guide covers prerequisites, infrastructure setup, service startup, common tasks, and troubleshooting.

## Prerequisites

- **Node.js 20.11 or later** — Verify with `node --version`.
- **npm 10+** — Usually bundled with Node 20+.
- **Docker** — For Postgres and Redis. If running on Linux, use the user socket (systemctl --user).
- **curl** — For testing endpoints.
- **A machine with 2GB+ free RAM** — Postgres, Redis, and Node services run concurrently.

### Docker Setup on Linux

Docker Desktop runs as a **user-level systemd service** on this machine, not system-wide. If docker commands fail with "permission denied", start the user daemon:

```bash
systemctl --user start docker-desktop
```

Verify Docker is running:

```bash
docker ps
```

If this still fails, ensure your user can run Docker:

```bash
usermod -aG docker $USER
newgrp docker
docker ps
```

## Infrastructure

### Start Postgres and Redis

```bash
npm run db:up
```

This starts two containers:
- **Postgres 16** on `localhost:5433` (host port 5433 → container port 5432)
- **Redis 7** on `localhost:6380` (host port 6380 → container port 6379)

**Why port 5433?** A local Postgres is already running on 5432. ProofChain uses 5433 to avoid collision.

**Why 6380?** Same reason — port 6379 is taken.

Verify both are healthy:

```bash
docker compose -f infra/docker-compose.yml ps
```

You should see both services with `healthy` status (after ~10 seconds).

To stop them:

```bash
npm run db:down
```

To completely reset (careful! destroys data):

```bash
docker compose -f infra/docker-compose.yml down -v
```

## Environment Configuration

### Copy the Example .env

```bash
cp .env.example .env
```

The `.env` file contains:

```
# Postgres
POSTGRES_USER=proofchain
POSTGRES_PASSWORD=proofchain
POSTGRES_DB=proofchain
DATABASE_URL=postgres://proofchain:proofchain@localhost:5433/proofchain

# Redis / BullMQ
REDIS_URL=redis://localhost:6380

# Backend API
PORT=3000
JWT_SECRET=change-me-in-production

# Weigh-in photos
PHOTO_STORAGE_DIR=./var/photos
MAX_PHOTO_BYTES=8388608
```

**In production**, change `JWT_SECRET` to a strong random string.

## Database Setup

### Install Dependencies and Build

```bash
npm install
npm run build
```

### Run Migrations

Migrations are TypeORM migration files that create the database schema. They run in order:

```bash
cd apps/backend
npm run migration:run
```

Expected output:

```
[TypeORM] migrations to execute: 1
[TypeORM] InitialSchema
[TypeORM] Migration InitialSchema has been executed successfully
```

If migrations fail, check that Postgres is running and the `DATABASE_URL` is correct.

### Seed the Database

The seed script creates initial entities (hub, collector, devices, users) needed for local testing:

```bash
cd apps/backend
npm run seed
```

Expected output:

```
✓ Hub created: Nairobi Pilot (UUID)
✓ Collector created: John Doe (UUID)
✓ Device 1 enrolled: d1 (UUID) — public key ...
✓ Device 2 enrolled: d2 (UUID) — public key ...
✓ Device 3 enrolled: d3 (UUID) — public key ...
✓ Operator user created: operator@proofchain.local
```

The seed stores the device private keys in `apps/backend/var/seed-devices.json` for use by the demo script. It also writes a default `material_rates` row (50/kg, no hub override) for every active material — **a payout will fail with a clear 400 if no rate exists for the material/hub it's asked to price**, so this is what makes `POST /payouts` work out of the box in a freshly seeded environment. Set real rates via `POST /material-rates` before relying on the seeded figure for anything but local testing.

## Service Startup

### Backend API

**Terminal 1:**

```bash
cd apps/backend
npm run start:dev
```

Watches for changes and rebuilds. Output:

```
[Nest] 1234  - 08/08/2024, 14:30:00   LOG [bootstrap] ProofChain API listening on :3000 (development) — docs at /docs
```

Access Swagger docs at `http://localhost:3000/docs` (dev mode only).

Health check:

```bash
curl http://localhost:3000/health | jq .
```

### Dashboard (Optional)

**Terminal 2:**

```bash
cd apps/dashboard
npm run dev
```

Access at `http://localhost:3001`. Shows batch management, event lists, and custody transfers.

### Capture PWA (Optional)

**Terminal 3:**

```bash
cd apps/capture
npm run dev
```

Access at `http://localhost:3002`. Mimics the field weigh-in flow: sign events, queue, sync. For testing, use the demo script instead.

### Mobile App (Optional)

```bash
cd apps/mobile
npm start
```

Starts the Expo CLI. Press `i` for iOS or `a` for Android (requires simulator/device). Same signing contract as capture PWA.

## Common Tasks

### Create a Test Batch and Run It Through Re-weigh and Payout

1. **Open a batch:**
   ```bash
   curl -X POST http://localhost:3000/batches \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <JWT_TOKEN>" \
     -d '{"hubId": "<hub_uuid>", "material": "PET"}'
   ```

   (You need a JWT token from logging in first; see the demo script for how it's obtained.)

2. **Run the demo** (easier):
   ```bash
   node scripts/demo-e2e.mjs
   ```

   This does all the work: creates events, batches, seals, records custody,
   records a within-tolerance and a flagged re-weigh, creates and pays out a
   payout, and downloads the audit report to confirm it all shows up there.

### List Batches

```bash
curl http://localhost:3000/batches | jq '.'
```

### Download an Audit Report

```bash
curl http://localhost:3000/batches/<batch_id>/report | jq '.'
```

The `reweighs` and `payouts` arrays in the response are recomputed from source
rows on every request — nothing about them is cached against the batch — so
this is always a live view of what's been recorded and paid for that batch.

### Record a Re-weigh

```bash
curl -X POST http://localhost:3000/events/<event_id>/reweigh \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"verifiedWeightKg": 14.2}'
```

If the verified weight is more than ±5% off the event's claimed weight, this
fails with a 400 asking for `notes` — a flagged re-weigh must carry a stated
reason. Add it and resubmit:

```bash
curl -X POST http://localhost:3000/events/<event_id>/reweigh \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"verifiedWeightKg": 11.0, "notes": "material was noticeably damp"}'
```

There is no endpoint to edit or delete a re-weigh once recorded — one event
gets exactly one. A mis-keyed value has to be corrected out of band today (see
[Known Limitations](../README.md#known-limitations) in the README).

### Create and Pay a Payout

A payout needs a `material_rates` row for the reweigh's material (and,
optionally, hub) to price against — **the seed writes a default global rate
for every active material**, so a freshly seeded environment already has one.
Check what's configured:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/material-rates?materialCode=PET" | jq '.'
```

Add or override one:

```bash
curl -X POST http://localhost:3000/material-rates \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"materialCode": "PET", "ratePerKg": 55}'
```

Then create the payout, covering one or more of a single collector's
re-weighs, and mark it paid once the collector has actually been handed the
money:

```bash
curl -X POST http://localhost:3000/payouts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"collectorId": "<collector_id>", "eventReweighIds": ["<reweigh_id>"], "method": "cash"}'

curl -X POST http://localhost:3000/payouts/<payout_id>/mark-paid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"payoutRef": "receipt-0042"}'
```

`POST /payouts` refuses a reweigh that: doesn't belong to the given
`collectorId`, is already attached to another payout, or has
`status: "rejected"`. `mark-paid` refuses a payout that isn't `pending` — it
can only be paid once.

### View Event Details

```bash
curl http://localhost:3000/batches/<batch_id>/events | jq '.'
```

## Troubleshooting

### "Can't connect to Postgres"

**Symptom:** `error: connect ECONNREFUSED 127.0.0.1:5433`

**Solution:**
1. Check Docker is running: `docker ps`
2. If Docker failed to start, see [Docker Setup on Linux](#docker-setup-on-linux)
3. Restart services: `npm run db:down && npm run db:up`
4. Verify connection: `docker compose -f infra/docker-compose.yml exec postgres pg_isready`

### "Docker permission denied"

**Symptom:** `permission denied while trying to connect to Docker daemon`

**Solution:** On this system, Docker runs as a user service:

```bash
systemctl --user start docker-desktop
```

Then retry your docker command.

### "Database migrations failed"

**Symptom:** `TypeORM migration error` or `table already exists`

**Solution:**
1. Check Postgres is healthy: `docker compose -f infra/docker-compose.yml ps`
2. If fresh start, migrations should work. If the database was partially seeded, you may need to reset:
   ```bash
   docker compose -f infra/docker-compose.yml down -v
   npm run db:up
   # Then re-run migrations and seed
   ```

### "no material rate configured for ..." on POST /payouts

**Symptom:** `400 Bad Request` from `POST /payouts`, with a message naming the
material and hub it checked.

**Cause:** No `material_rates` row resolves for that material — neither a
hub-specific override nor the `hubId: null` global default. This happens on a
fresh database if the seed hasn't run, or for a material added by hand after
seeding.

**Solution:** Add a rate before retrying the payout:

```bash
curl -X POST http://localhost:3000/material-rates \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"materialCode": "PET", "ratePerKg": 55}'
```

### "TypeScript build errors"

**Symptom:** `tsc --noEmit` fails with type errors

**Solution:**
```bash
npm run typecheck
# Identify and fix the error, or use:
npm run build --workspaces
# to build all and see which workspace has the issue
```

### "Port already in use"

**Symptom:** `listen EADDRINUSE :::3000` or `:3001` etc.

**Solution:**
1. Find what's using the port:
   ```bash
   lsof -i :3000
   ```
2. Kill it (if it's a stray Node process):
   ```bash
   kill -9 <PID>
   ```
3. Or use a different port:
   ```bash
   PORT=3001 npm run start
   ```

### "Out of memory"

**Symptom:** Node process terminates or "JavaScript heap out of memory"

**Solution:**
1. Increase Node's heap (useful for type-checking large projects):
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm run build
   ```
2. Close other memory-heavy applications (browser tabs, IDEs, etc.)
3. Add swap space if running on a VM with limited RAM.

## Maintenance

### Backing Up the Database

```bash
docker compose -f infra/docker-compose.yml exec postgres pg_dump -U proofchain proofchain > backup.sql
```

### Restoring from Backup

```bash
docker compose -f infra/docker-compose.yml exec -T postgres psql -U proofchain proofchain < backup.sql
```

### Clearing All Data

```bash
docker compose -f infra/docker-compose.yml down -v
npm run db:up
cd apps/backend && npm run migration:run && npm run seed
```

### Restarting Everything

```bash
npm run db:down
npm run db:up
# Then restart services in terminals
```

## Deploying the pilot (Neon + Render)

This deploys a hosted instance operators, hub staff and auditors can reach. It
is not a production credit issuer — see
[Before calling it production](#before-calling-it-production).

One process runs: the **API**. It's built from the `Dockerfile` at the repo
root. `render.yaml` declares it.

### 1. Database (Neon)

Create a project and copy the connection string. It ends in `?sslmode=require`;
keep that. Use the **pooled** string for the API.

The first migration installs the `uuid-ossp` extension itself, so an empty Neon
database needs no preparation.

### 2. Secrets

`JWT_SECRET` is generated by Render itself (`generateValue: true` in
`render.yaml`) — nothing to create by hand for a default deploy.

### 3. Apply the blueprint

Point Render at the repo (Blueprints → New Blueprint Instance). It reads
`render.yaml` and prompts for each `sync: false` value:

| Variable | Service | Value |
|---|---|---|
| `DATABASE_URL` | api | Neon pooled connection string |
| `CORS_ORIGINS` | api | dashboard and capture origins, comma-separated |

`JWT_SECRET` is generated by Render. `TRUST_PROXY=1` is already set — it must
be, or `req.ip` is Render's load balancer and the login and ingest rate limits
put every client in a single bucket.

### 4. Migrate

The blueprint runs migrations as a pre-deploy step, before traffic moves to the
new build. That requires a paid instance type; on the free plan, remove
`preDeployCommand` and run it yourself from a shell on the service:

```bash
npm run migration:run:prod -w @proofchain/backend
```

The `:prod` variants exist because a deployed image has no `ts-node` —
devDependencies are pruned out — so the development `migration:run` cannot run
there.

### 5. Create the first administrator

A migrated database has no users, and the development seed refuses to run in
production (it hardcodes published passwords). From a shell on the API service:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='<a long one>' \
  npm run admin:create:prod -w @proofchain/backend
```

Run it there rather than locally so the password never reaches a shell history
or a CI log. Then sign in and create the remaining accounts through the API:

```bash
TOKEN=$(curl -s -X POST https://<api>/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' | jq -r .accessToken)

curl -X POST https://<api>/users -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"ops@example.com","password":"...","role":"operator"}'
```

Passwords must be at least 12 characters. Users change their own with
`POST /auth/password`; an admin resets a forgotten one with
`POST /users/:id/password` and hands it over out of band.

To remove someone's access, `PATCH /users/:id {"active": false}`. It takes
effect on their **next request** — `JwtAuthGuard` re-reads the row rather than
trusting the token — so there is no window where a revoked operator keeps
working until their 12-hour token expires. The API refuses to deactivate or
demote the last active admin, and refuses to let you do either to yourself.

### 6. Verify

```bash
curl https://<api>/health        # {"status":"ok","database":"up",...}
curl https://<api>/              # {"service":"proofchain-api","health":"/health"}
```

`/docs` is deliberately 404 in production — Swagger is mounted only outside it.
Check the boot log for a `TRUST_PROXY` warning; if one is there, the rate limits
are not doing what you think.

### Running it anywhere else

Nothing above is Render-specific except `render.yaml`. Any host that runs a
container works:

```bash
docker build -t proofchain .
docker run -p 3000:3000 \
  -e NODE_ENV=production -e TRUST_PROXY=1 \
  -e DATABASE_URL='postgres://…?sslmode=require' \
  -e JWT_SECRET=… \
  -e CORS_ORIGINS='https://dashboard.example.com' \
  proofchain
```

### Before calling it production

Still outstanding, and none of it is on the deployment path:

1. Security audit of the integrity checks and signing path
2. Verra accreditation as a credit issuer
3. Photo storage — bytes are hashed but never stored, so a buyer cannot check a
   `photoHash` against an image
4. Shared-store rate limiting — the limiter is per-process, so it weakens as
   soon as the API runs more than one instance
5. Backups and restore drills (Neon's point-in-time restore is the starting
   point, not the plan)
6. Monitoring and alerting: logs, metrics, uptime, and an alert on the
   `material_rates` table being empty for a material that's about to be paid out
7. A structured payout-destination and disbursal integration — see
   [Known Limitations](../README.md#known-limitations) in the README

## Testing the capture PWA on a real phone

The camera and service workers are both gated behind a **secure context**:
HTTPS, or `localhost`. A phone opening the app over the office wifi at
`http://192.168.x.x:3002` is an insecure origin, so the camera is refused and the
service worker never registers — which takes the offline queue with it.

Serve it over HTTPS instead:

```bash
npm run dev:capture:https      # or, in apps/capture: npm run preview:https
```

Vite prints a Network URL such as `https://192.168.46.157:3002/`. The
certificate is self-signed, so the phone shows a warning once — accept it, and
the origin becomes a real secure context with a working camera and offline support.

Two things to remember:

- Point the app's **Backend URL** at the machine's LAN address
  (`http://192.168.x.x:3000`), not `localhost:3000` — on the phone, `localhost`
  is the phone.
- The backend accepts loopback and private-network origins automatically in
  development, so a changing DHCP address needs no config edit. In production the
  explicit `CORS_ORIGINS` allowlist is the only thing honoured.

An alternative for a USB-connected Android device is `adb reverse tcp:3002
tcp:3002` (and `tcp:3000` for the API), which lets the phone reach the app at
`http://localhost:3002` — already a secure context, no certificate needed.

## Managing the material catalogue

The materials collectors can choose from live in the database, not in the apps.
An administrator maintains them at **Dashboard → Materials**, or over the API.

### The one rule

A material **code** is part of the signed weigh-in payload, so it is hashed into
the Merkle root of every batch containing it. It cannot be renamed or deleted once a
collector has signed it — that would invalidate the audit report of every batch
containing it, and no migration can undo a Merkle root already handed to an
auditor as proof of a sealed batch's contents.

So the catalogue separates three things:

| Field | Changeable? | Notes |
|---|---|---|
| `code` | **Never** | `PET`. Signed, hashed into every batch's Merkle root. Append-only. |
| `name` | Freely | `Clear drink bottles`. Presentation only, never signed. |
| `active` | Freely | `false` retires it: hidden from capture, history untouched. |

### Add a material

```bash
curl -X POST https://<api>/materials -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"code":"PVC","name":"Pipe and profile",
       "description":"Rigid pipe, window profile. Resin code 3.","sortOrder":70}'
```

Codes are uppercased, 2–16 characters, letters digits `_` or `-`. Choose carefully:
this string is permanent from the first weigh-in that carries it.

### Retire one ("remove")

```bash
curl -X PATCH https://<api>/materials/PS -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"active": false}'
```

This is what "removing" a material means here, and it is almost always what you
want. The code disappears from the capture pickers within 15 minutes (sooner if a
phone reconnects), and every stored weigh-in and sealed batch carrying it keeps
verifying exactly as before. Reverse it with `{"active": true}`.

### Delete one outright

Only possible for a code nothing has ever used — a typo, in practice:

```bash
curl -X DELETE https://<api>/materials/PTE -H "authorization: Bearer $TOKEN"
```

If any event or batch carries the code, this returns **409** naming the counts and
telling you to retire it instead. That refusal is the intended behaviour, not an
obstacle to work around.

### What the devices do

The capture PWA and the Expo app fetch `GET /materials` and cache it, so:

- The picker renders instantly from cache, offline, with no spinner.
- A phone that has never reached the backend falls back to the six codes compiled
  into `@proofchain/shared`, and labels the list "default list — not yet synced".
- The cache is keyed by backend origin, so pointing a device at a different
  instance discards it rather than offering codes that instance may not have.
- Retiring the material a collector currently has selected moves their selection
  to the first available one on the next refresh.

A weigh-in signed against a since-retired code **still syncs**. That is
deliberate: a phone can hold a queue signed hours ago, and rejecting it would
destroy field work nobody can redo. Opening a *batch* with a retired code is
refused, because that is a live decision rather than history.

If you retire everything, the apps fall back to their built-in list rather than
show an empty picker — check **Dashboard → Materials** if collectors report codes
you thought you had removed.
