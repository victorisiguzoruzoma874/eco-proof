# Serving ProofChain so the camera and offline queue work

Everything in this directory exists because of one browser rule: **the camera and
service workers require a secure context** — HTTPS, or `localhost`. A phone
opening the capture app at `http://192.168.1.20:3002` is an insecure origin, so
the camera is refused and the service worker never registers, which takes the
offline queue with it. Nothing in the application code can lift that.

There are three ways to serve this, for three different situations. Pick by what
you are actually doing.

---

## 1. Developing on this machine

```bash
npm run dev:capture          # http://localhost:3002
```

`localhost` is already a secure context, so the camera and service worker work
with no certificates at all. This is why HTTPS is opt-in rather than the default.

---

## 2. Testing on a real phone over wifi

This is the case that looks broken and isn't.

```bash
npm run dev:capture:https    # https://<your-lan-ip>:3002
```

Then **in the app, set Backend URL to `https://<your-lan-ip>:3002/api`** — not
`http://<your-lan-ip>:3000`.

That second step is the one everybody misses. Serving the page over HTTPS creates
a new problem behind the first: a secure page may not `fetch()` a plain-HTTP
endpoint, so pointing at the backend directly is blocked as mixed content. The
camera starts working and every request fails instead. `apps/capture/vite.config.ts`
runs a dev proxy at `/api` so the phone talks to exactly one origin over TLS and
Vite forwards to the backend server-side, where scheme mixing is nobody's
business.

The certificate is self-signed, so the phone shows a warning once. Accept it.

**Known limits of this mode:** `vite dev` and `vite preview` serve that proxy;
`vite build` does not. And a click-through certificate warning on every
collector's phone is acceptable for a test, not for a rollout — for that, see
below.

---

## 3. Production

The backend deploys to Render (see `../render.yaml`) and the capture and
dashboard apps deploy to Vercel — both terminate TLS for you, so each app is a
secure context on its own without any self-hosted edge in front of them.

There is no bundled reverse-proxy/TLS stack in this repository. If you're
self-hosting on your own box instead of using those platforms, you'll need to
terminate TLS yourself (e.g. Caddy or nginx in front of the built `dist/`
output for capture, and reverse-proxying the backend and dashboard) — the
`TRUST_PROXY` env var on the backend exists for exactly that case (see
`apps/backend`'s config for how many proxy hops to trust).

### If you have no public DNS

For a pilot on a closed network, [`mkcert`](https://github.com/FiloSottile/mkcert)
issues a certificate from a local CA you install once on each phone. That gets a
real secure context with no warning and no internet, at the cost of provisioning
the root certificate onto every device.

---

## What this does *not* fix

HTTPS makes the camera and the service worker **possible**, not the network
**reliable**. A field link drops, and a phone can spend a whole shift with no
signal at all.

The capture app handles that separately: every weigh-in is signed on the spot and
queued in IndexedDB, then synced whenever a connection appears. See
`apps/capture/src/lib/queue.ts`.

So: **HTTPS is the fix for the secure context. The offline queue is the fix for
no signal.** They are not alternatives.
