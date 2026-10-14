# Staff assistant: role-scoped tools with confirmed admin actions

Date: 2026-10-14 · Status: approved design, pending spec review

## Goal

The ProofChain assistant currently works only on `/requester/*` pages, signed in
with the requester token. Extend it to every staff page of the dashboard
(batches, weigh-ins, reweigh, payouts, requests, withdrawals, collectors,
materials, rates, catalog) so staff can read and operate the application by
chat.

Success criteria:

- The assistant can do exactly what the signed-in staff account can do through
  the API — never more.
- Admin-only changes require the account to be an admin **and** a human click
  on a Confirm button that the model cannot press.
- The requester assistant is unchanged.

Out of scope: the collector capture app (device-key signed, no chat widget);
user deletion, password resets and device revocation (stay manual).

## Architecture

New, separate staff path. Requester code is not touched beyond the widget's
endpoint selection.

```
browser widget ──► Next /api/v1/assistant/staff          (staff cookie → Bearer)
                       └─► backend POST /api/v1/assistant/staff        (JwtAuthGuard)
               ──► Next /api/v1/assistant/staff/confirm/:id
                       └─► backend POST /api/v1/assistant/staff/confirm/:id
```

Backend, in `apps/backend/src/assistant/`:

| File | Responsibility |
|---|---|
| `staff-tools.ts` | `STAFF_TOOLS` definitions tagged with `tier: 'read' \| 'operate' \| 'admin'`; `toolsFor(role)`; `StaffAssistantTools.execute(name, input, actor)` calling existing services |
| `pending.ts` | `PendingAdminOps`: in-memory, single-use, 5-minute, actor-bound store of prepared admin operations |
| `staff-policy.ts` | `STAFF_SYSTEM` prompt |
| `staff.controller.ts` | chat endpoint (same streaming loop as requester) + confirm endpoint |
| `contracts.ts` | add `dtoArgs(Class, input)` — validates tool input with the same class-validator DTOs and options as the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`) |

The chat streaming loop in `assistant.module.ts` is extracted to a shared
function `runChat(...)` used by both controllers, so limits, tool budget and
error handling stay identical.

## Role → tool mapping

`toolsFor(role)` decides which tools are sent to the model; `execute` checks
the tier again against the actor's current role (from the `JwtAuthGuard`,
which reads the role row on every request), so an invented tool name is still
refused.

| Tier | Roles | Tools |
|---|---|---|
| read | admin, operator, auditor | `get_capabilities`, `list_batches`, `get_batch`, `list_events`, `get_event`, `list_payouts`, `get_payout`, `list_hubs`, `list_materials`, `list_credit_rates`, `get_batch_report` |
| read (ops) | admin, operator | `list_requests`, `list_withdrawals`, `list_collectors`, `list_devices`, `list_reward_orders`, `list_material_rates`, `list_custody` |
| operate | admin, operator | `create_batch`, `add_batch_events`, `remove_batch_event`, `seal_batch`, `advance_batch_status`, `record_custody_transfer`, `record_reweigh`, `assign_request`, `fulfill_request`, `cancel_request`, `mark_withdrawal_paid`, `reject_withdrawal`, `create_payout`, `mark_payout_paid`, `fulfill_reward_order`, `create_collector`, `enrol_device`, `open_screen` |
| admin (confirm) | admin | `create_hub`, `create_material`, `update_material`, `create_material_rate`, `create_credit_rate`, `create_catalog_item`, `list_users`, `create_user`, `update_user` |

`list_users` is a read but admin-only, so it is in the admin tier yet executes
directly (no confirmation). All other admin-tier tools are mutations and go
through confirmation. Operate-tier tools execute directly, like the existing
requester mutations. `open_screen` offers navigation to staff routes only.

Every mutating service call that already accepts an actor id (reweigh,
mark-paid, fulfil, user update) receives the staff user's id from the token.

## Admin confirmation flow

1. Model calls an admin mutation tool. `execute` validates the input with the
   DTO, loads enough context for a readable summary (e.g. hub name), and calls
   `pending.create({ actorId, tool, args, summary })` → id (random UUID),
   expiry now + 5 min. **No service is called.**
2. Tool result: `{ action: { kind: 'confirm-admin', id }, label: summary, status: 'Awaiting admin confirmation; nothing changed yet.' }`.
   The existing action channel streams it to the widget as a button.
3. Clicking it, the dashboard `performAction` POSTs to the Next confirm route,
   which forwards with the staff cookie.
4. Backend confirm endpoint (`JwtAuthGuard`, `@Roles('admin')`): `pending.take(id, actorId)`
   removes the entry and returns it only if it exists, is unexpired and belongs
   to the same actor; otherwise 404. Then it executes the stored operation and
   returns `{ summary, result }`.
5. The widget shows the confirmation result.

The model has no tool for confirming. Pending ops live in process memory
(capped at 200, expired entries swept on access): a restart drops them and the
admin asks again. Acceptable while the API runs a single Railway instance.

## Dashboard

- `app/api/v1/assistant/staff/route.ts` and `.../staff/confirm/[id]/route.ts`:
  same origin and size checks as the requester route; use `TOKEN_COOKIE`.
- `RobotAssistant.tsx`: `/requester/*` → requester endpoint; any other path
  except `/login` → staff endpoint.
- `assistant-actions.ts`: add `{ kind: 'confirm-admin'; id: uuid }` and staff
  navigation targets (`STAFF_SCREENS`). `performAction` handles `confirm-admin`
  by POSTing to the confirm route and returning the summary or the error.

## Errors and limits

Same as the requester assistant: per-user rate limit, 4 rounds / 8 tool calls,
45 s timeout, tool errors returned as safe messages (`ToolInputError` and
Nest `HttpException` messages are surfaced; anything else becomes a generic
failure). Confirm endpoint errors: 401 not signed in, 403 not admin, 404
missing/expired/foreign/used.

## Testing

- `toolsFor` per role returns exactly the tiers above.
- `execute` refuses admin and operate tools for an auditor and admin tools for
  an operator, even when called directly with the name.
- Admin mutation via `execute` creates a pending op and calls no service.
- `PendingAdminOps`: rejects other actor, expiry, reuse; cap holds.
- Confirm endpoint executes the stored op once and only for an admin.
- `dtoArgs` rejects unknown keys and invalid values.
- Existing requester assistant tests keep passing; dashboard typecheck/build.
