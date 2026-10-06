# Reusable robot assistant

Dependency-free Shadow DOM widget, original transparent robot asset, standalone demo, Next/React integration and authenticated NestJS DeepSeek backend. Default placement is left, size 104px (80px on mobile unless configured). ASK AI sits beneath the robot; the navy nonmodal panel is separate from the launcher.

## Install and configure

From the repository root:

```sh
npm ci
npm run build -w @proofchain/backend
npm run build -w @proofchain/dashboard
npm run dev:dashboard
```

Open `http://localhost:3001/ai-chat/demo.html` for the local demo. Omit `endpoint` for explicitly labeled sample replies. Failed configured backends never fall back to demos.

Set backend variables through server secret configuration or an ignored local `.env`:

```dotenv
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
```

Set dashboard `BACKEND_URL` to the existing backend origin. Requester pages use `/api/v1/assistant` by default. Operator pages use demo mode because they have a separate authorization boundary. `NEXT_PUBLIC_ASSISTANT_ENDPOINT` optionally overrides the public URL; never put a secret there. The Next session bridge reads the existing httpOnly requester cookie server-side, checks Origin, and forwards the application JWT. Nest verifies the JWT and rechecks the active requester. Browser code receives neither the JWT nor provider key. The standalone demo does not create a session.

## Embed on another website

Copy this entire directory to your public assets:

```html
<script type="module" src="/ai-chat/robot-chat.js"></script>
<robot-chat animated placement="left" size="104" accent="#42e5f5"
  robot-src="/ai-chat/robot.png" assistant-name="App Assistant"
  greeting="Hi! How can I help?" endpoint="/api/v1/assistant"
  offset-x="18" offset-y="104" z-index="1000"></robot-chat>
```

Classic `<script src="/ai-chat/widget.js" defer></script>` and `<proofchain-chat>` also work. Copying the widget does not grant backend access: provide your own authenticated endpoint/session bridge. Mount outside transformed ancestors so fixed placement uses the viewport.

Attributes update in place: `robot-src`, `body-src`, `head-src`, `eyes-src`, `size`, `placement` (left/right), `offset-x`, `offset-y`, `accent`, `greeting`, `assistant-name`, `endpoint`, `z-index`. Size is clamped to 48?220px. Motion is enabled by default; `animated` is a compatibility attribute. Reduced motion takes precedence. Each instance owns history, requests and motion. Removal aborts requests and releases listeners, observers, timers and animations.

Instance hooks:

```js
const widget = document.querySelector('robot-chat');
widget.requestAssistant = (url, init) => fetch(url, {
  ...init, credentials: 'same-origin' // application session, never provider keys
});
widget.performAction = async action => {
  // Validate your allowlist, use your router/UI, await actual opening confirmation.
  throw new Error('Connect application actions first.');
};
```

The working React wrapper is `src/app/RobotAssistant.tsx`. It uses Next routing, the session bridge, offsets above bottom controls and validated callbacks; it waits for screen/form confirmation before reporting success. It keeps the widget mounted during route changes.

## Character and animation

`robot.png` is preserved unchanged. It is flattened, so the bundled character uses honest **whole-image tilt and float**, without independent eyes or blinking. No generated replacement or rough masks are shipped. Clean, visually verified original layers are still needed for independent animation of this exact artwork.

For a custom complete layer set, supply equally sized transparent canvases with identical registration:

1. `body-src`: torso, full arms and neck only.
2. `head-src`: shell, ears, screen and smile, with only eyes/glow removed and reconstructed cleanly.
3. `eyes-src`: eyes only at the original coordinates.

All layers must load and match dimensions before the fallback is hidden. Verify alignment visually; dimensions alone do not prove artwork correctness. Eye-only scale blinking closes/reopens over 200ms every 3.5?7 seconds. Head rotation and eye displacement compose separately with shared registration; the body stays steady within its idle float. Legacy `blink-src` is accepted but unnecessary.

Capture-phase tracking works across page controls that stop propagation. Viewport-scaled tanh distinguishes distant positions. Head pitch/yaw stay below 6/8 degrees, lean below 2 degrees, eyes below 6px. Elapsed-time requestAnimationFrame smoothing follows scroll, resize and placement updates. Exit/blur returns neutral. Touch-only devices retain tap; hybrid devices allow mouse tracking. Reduced motion disables tracking, float, blink and transitions. Panel placement uses the visual viewport and safe areas; history scrolls.

## Secure backend and application tools

`apps/backend/src/assistant/` contains validation, provider adapter, tools and route. The server owns its system prompt. Only exact user/assistant `{role,content}` records are accepted. Limits: 30 messages, 4000 characters each, 24000 total, 12 requests per requester per minute, 45 seconds per request, four provider rounds, eight tool executions and 256KiB provider output. Disconnects abort provider fetches. Public errors never include internal diagnostics or credentials. Rate limits are per-process; multi-instance deployments need a shared limiter store.

| Tool | Behavior |
| --- | --- |
| get_balance | Signed-in requester's live credits and held withdrawals |
| get_transactions | Latest 1?10 requester wallet transactions |
| get_orders | Latest 1?10 requester pickup orders |
| get_prices | Current credits-per-kg rates, by material/hub |
| open_screen | Offer dashboard/wallet/history/rewards/request button |
| prepare_withdrawal | Validate finite positive credits, 3-digit precision, max 1000000, and available balance; offer review only |

Identity comes only from the authenticated session. Arguments reject extra keys, user IDs and external destinations. No arbitrary URLs, SQL, filesystem, shell, admin or secret tools exist. Activity reflects actual tool attempts; tool errors are reported honestly. Returned text is untrusted data.

A withdrawal button waits for a click, opens the existing wallet form with a validated `reviewAmount`, and never calls a payment endpoint. The wallet reloads balance and retains normal form/backend validation and explicit user submission. ProofChain has no recipient-transfer, swap or crypto conversion service; those are explicitly unsupported. Stale-recipient lookup tests are not applicable here.

## Transport and replacing the provider

POST `/api/v1/assistant` with `{"messages":[{"role":"user","content":"Hello"}]}`. UTF-8 SSE contract:

```text
data: {"delta":"Hello"}

data: {"activity":"Checking an application request?"}

data: {"action":{"kind":"navigate","target":"wallet"},"label":"Open wallet"}

data: [DONE]

```

Errors: `data: {"error":"The assistant service is unavailable. Please retry."}`. The parser handles fragmented Unicode, split CRLF, completion markers and interruptions. Incomplete answers/actions are removed. Retry preserves the user turn. Legacy typed SSE, JSON `{message}` and plain text also work. Text and labels use `textContent`, never model HTML. Actions enable only after successful completion.

Replace `deepseek.ts` to substitute a provider, preserving cancellation, bounded output and function-call validation. DeepSeek official documentation checked on 2026-10-06 lists `deepseek-flash` and `deepseek-v4-pro`; default model is configurable `deepseek-flash`, with thinking disabled for this tool loop. Confirm availability in your provider account before deploying.

- [Chat API](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Model list](https://api-docs.deepseek.com/api/list-models/)
- [Models and pricing](https://api-docs.deepseek.com/quick_start/pricing)

## Verification

See `VERIFICATION.md`. Run from the root:

```sh
node e2e/robot-widget.mjs
npm test -w @proofchain/backend -- --run test/assistant.test.ts test/assistant-controller.test.ts
npm run build -w @proofchain/backend
npm run build -w @proofchain/dashboard
```

No live provider connectivity or deployment activation is claimed. Configure the server key and test an actual requester session, live tools, review prefilling and explicit form submission in staging before activation.
