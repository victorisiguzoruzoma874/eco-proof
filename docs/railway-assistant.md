# Railway backend and DeepSeek assistant

The expanded tools from commit `2c431e7` were deployed on 2026-10-07 and verified
live on the Railway backend and Vercel dashboard. Deployment ID:
`012cf055-4abd-4732-aa74-d96cb11798b0`. Both extended e2e flags below passed;
see the widget's `VERIFICATION.md` for the exact checks and remaining limits.

The existing `proofchain-backend` project / `proofchain-api` production service
was successfully configured and deployed on 2026-10-06. Its public origin is
`https://proofchain-api-production.up.railway.app`. The existing Vercel dashboard
already points to this backend; a live browser check verified authenticated
streaming and a click-gated wallet-navigation task through the session bridge.
Run `node e2e/assistant-live.mjs` for a live check using a temporary requester,
which the script deletes afterward. It requires Railway login and production
database access; it does not submit any payment.

Set `ASSISTANT_TEST_WORKFLOWS=1` for additional host-form tests, and
`ASSISTANT_TEST_NEW_TOOLS=1` to verify a real new-tool response and claim-code
prefill. `ASSISTANT_TEST_DASHBOARD` can target a local production build instead
of Vercel. Tests create no pickup, redemption or withdrawal records and remove
their temporary requester and wallet.

Deploy the backend from the repository root. The root `railway.json` builds only
the backend workspace (its prebuild also builds shared types), starts the compiled
Nest application, and checks `/health`. Do not set the service root to
`apps/backend`: this npm workspace needs the root lockfile and shared package.

Use the existing production database and JWT secret when moving an existing
backend. A new empty database will not contain your accounts, wallet balances or
orders. A different JWT secret will invalidate existing sessions. Do not replace
these settings with development defaults.

Set these variables in the Railway backend service:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Existing production PostgreSQL connection, kept secret |
| `JWT_SECRET` | Existing production JWT signing secret, kept secret |
| `DEEPSEEK_API_KEY` | Provider API key, kept secret |
| `DEEPSEEK_MODEL` | `deepseek-flash` |
| `CORS_ORIGINS` | Approved dashboard and capture application origins |
| `TRUST_PROXY` | Set to the verified proxy topology for this service |

Railway supplies `PORT`; the server binds on `0.0.0.0`. Preserve existing photo
object-storage settings and other backend variables. Uploaded photos require
persistent storage or the existing S3-compatible configuration. Migrations run
on boot by default, as in the current backend; keep the service at one replica.

For a secret supplied from a local secure prompt, Railway supports stdin:

```sh
railway variable set DEEPSEEK_API_KEY --stdin --service proofchain-api --skip-deploys
railway variable set DEEPSEEK_MODEL=deepseek-flash --service proofchain-api --skip-deploys
railway up --service proofchain-api --detach
```

Do not put actual secrets in commands, tracked files, screenshots or chat. Use
Railway's Variables UI or a secure stdin workflow. Review and deploy staged
variable changes before checking connectivity.

Generate a Railway public HTTPS domain for the backend. In the existing Vercel
dashboard, set server-side `BACKEND_URL` to that origin and redeploy. Preserve
the same-origin `/api/v1/assistant` endpoint: it forwards the httpOnly requester
session to Railway. The provider key belongs on Railway, never in public frontend
variables. Update other clients' backend origins only if the entire backend is
being migrated; do not retire the existing backend before verification.

Verification after deployment:

1. `/health` reports `status: ok` and `database: up`.
2. Unauthenticated assistant requests return 401.
3. A signed-in requester receives a complete streamed reply.
4. Balance and transaction tools match that user's existing wallet.
5. Navigation buttons wait for a click and open only allowlisted screens.
6. Withdrawal review prefills the existing form, submitting nothing until the
   user explicitly submits it.

Deployment readiness does not prove DeepSeek connectivity. Provider errors,
account credit/model access and real tool calls must be verified separately.

References: [Railway shared monorepos](https://docs.railway.com/deployments/monorepo),
[Railway variables](https://docs.railway.com/variables),
[Railway CLI login](https://docs.railway.com/cli/login).
