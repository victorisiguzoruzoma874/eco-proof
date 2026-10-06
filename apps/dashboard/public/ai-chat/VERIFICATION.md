# Verification — 2026-10-06

## Railway activation — subsequent live checks

The `proofchain-api` production service was deployed successfully to
`https://proofchain-api-production.up.railway.app` (deployment
`8a5e87ab-0230-438d-9c9e-283f1f1808f6`). Existing database and JWT settings were
preserved. DeepSeek credentials were configured as server-side Railway variables.

- A real DeepSeek `deepseek-flash` completion returned HTTP 200.
- Railway `/health` reported `status: ok` and `database: up`.
- Unauthenticated assistant requests returned 401.
- `node e2e/assistant-live.mjs` passed: a temporary zero-balance requester received
  a live tool-backed balance answer; the deployed Vercel widget used its httpOnly
  session bridge to receive a live streamed reply and offer a wallet button.
- The wallet did not open until the button was clicked. The host callback then
  confirmed the wallet screen opened.
- The temporary requester and its empty wallet were deleted afterward. No
  payment or withdrawal was submitted, and existing accounts were not changed.

These checks supersede the earlier pre-activation live-provider limitations
below. Withdrawal review/submission and original layered artwork remain subject
to the earlier limitations. The live check uses a temporary account, not the
user's own financial records. The backend is now active; its deployment and the
provider were both checked rather than inferred from compilation.

## Executed automated checks

- `node e2e/robot-widget.mjs`: PASS in Chromium. Original PNG loads; flat fallback is explicit; tracking is clamped and viewport-relative; distant positions remain distinct; capture tracking crosses propagation-stopping controls; exit returns neutral; click/Enter/Space/Escape and focus restoration work; chat controls do not toggle the launcher; mobile/tablet containment, touch-only behavior and reduced motion pass. Mocked JSON/plain/SSE responses, split CRLF, safe text rendering, HTTP retry, stream interruption rejection, click-gated actions, multiple instances and removal cleanup pass. No browser runtime errors.
- Synthetic SVG layer fixtures: PASS for separate head/body/eye transforms and eye-only animation cleanup. These fixtures test the component engine, **not** visual layer quality of the supplied robot. Original art remains flattened with no blink/eye animation.
- `npm test -w @proofchain/backend -- --run test/assistant.test.ts test/assistant-controller.test.ts`: **11 tests PASS**. Covers payload/system/tool injection rejection, message limits, identity isolation, amount/precision/record limits, unsupported tools and external navigation, per-user throttling, absent/expired/operator/disabled-account sessions, fragmented Unicode provider streams, interrupted responses, backend tool/activity/action events, bounded tool rounds, safe errors, disconnect cancellation, missing-key refusal and 45-second timeout (fake timers).
- `npm run build -w @proofchain/backend`: PASS.
- `npm run build -w @proofchain/dashboard`: PASS. Includes production compilation and type validation of the session bridge, wrapper and withdrawal prefill.
- `git diff --check`: PASS.
- Generated `robot-widget-preview.png` was inspected: dark panel and transparent full robot remain visible and separated.

The Windows sandbox initially prevented Vitest/esbuild from reading its config; the authorized test rerun with filesystem access passed. No test changed application balances or sent money.

## Not live-verified

- DeepSeek account/model access, provider latency, live tool facts and deployed streaming infrastructure. Provider calls in tests are mocked. Official current API/model documentation was checked; no live API call or production activation is claimed.
- Full requester session-cookie-to-Nest integration against a running database, withdrawal form navigation/prefill and explicit final submission. These have compiled successfully and the component/action and server authorization paths have automated coverage, but require a staging end-to-end check.
- Exact independent head/eye artwork and alignment: no clean source layers were available. The unchanged flattened PNG intentionally uses whole-image tilt.
- Real hybrid input hardware, physical mobile keyboards/safe areas and assistive technology announcements. Automated touch/reduced-motion/viewport/focus tests are not physical-device audits.
- Transfers, arbitrary recipients, swaps and conversion payments do not exist in this ProofChain integration. They are unsupported; recipient lookup races are not applicable.

## Review flow evidence

`prepare_withdrawal` only reads a session-scoped wallet and returns a validated action; it never invokes a write service. The browser waits for a click and host callback. The callback routes to the existing wallet form; `reviewAmount` only sets a validated input default and does not invoke `withdrawAction`. A new input key ensures changed review amounts refresh the prefill. The form continues to require explicit submission and normal backend validation. The callback only reports opening after it observes the requested route and matching form value.

## Operational limits

Per-user throttling is in memory per backend process; use a shared store before scaling horizontally. Proxy buffering must be disabled for SSE. Configure `DEEPSEEK_API_KEY` exclusively on the server and confirm `DEEPSEEK_MODEL` using your account's model list. Existing session/JWT configuration remains required. Changes are local; no commit, push or deployment was performed.
