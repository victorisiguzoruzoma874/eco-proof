# Sign-up for collectors and operators — design

Date: 2026-11-15
Status: awaiting owner approval

## Intent

The owner wants people to be able to join the product on their own, as either a
**collector** or an **operator**, so that each person's details are captured
correctly at the door instead of being typed in later by an admin or operator.

Today nobody in these two groups can sign up:

- Operator accounts (`users` table) are created only by an admin through
  `POST /users` (`apps/backend/src/users/users.controller.ts`). There is no
  dashboard screen for it.
- Collectors (`collectors` table) have no login. An operator or admin creates
  the record (`POST /collectors`) and then pairs the collector's phone.
- Only requesters self-register (`/requester/signup`).

## Goals

1. A public sign-up page, linked from the operator sign-in page, where a person
   chooses Collector or Operator and submits their details.
2. Every sign-up is stored as a pending request. Nothing is usable until a staff
   member approves it.
3. Staff can see pending sign-ups in the dashboard and approve or reject each.
4. Approval creates the real record (an operator user, or a collector) from the
   submitted details, with no retyping.

## Non-goals

- A signed-in area or password for collectors. They still work through a phone
  paired by an operator.
- Email or SMS notifications. The build has no message delivery.
- Signing up as auditor or admin. Those stay admin-created.
- Adding name/phone columns to `users`, or a hub column to `collectors`.
- Changes to the mobile app, the capture app, the landing site, the requester
  area, or the staff assistant's tools.
- A general "manage users" dashboard screen.

## Anti-goals (failure even if it works)

- A person who has only signed up can sign in, record a weigh-in, be paired to
  a device, or appear in the collectors list.
- A password or password hash is ever returned by any endpoint or shown in the
  dashboard.
- The sign-up endpoint can be used to flood the database or to hammer argon2
  without a rate limit.

## Constraints

- Schema changes go through a reviewed TypeORM migration; `synchronize` is off.
- The backend `ValidationPipe` uses `forbidNonWhitelisted`, so the page must
  send exactly the fields the DTO declares for the chosen role.
- `users.email` and `collectors.phone` are unique.
- The page uses the operator dashboard's existing visual system
  (`apps/dashboard/src/app/(operator)/globals.css`): paper ground, ink borders,
  lime accent, hard shadow, existing type scale. No new fonts or colours.
- No all-caps or monospace labels (see `docs/typography.md`).

## Approaches considered

**A. Separate sign-up requests table (chosen).** A new `signup_requests` table
holds every submission with a status. Approval creates the real `users` or
`collectors` row in the same transaction. Trade-off: one new table, one new
module, and an approval screen. In return the real tables only ever contain
people who were approved, the applicant's full details (name, phone, chosen hub)
have a home without altering `users` or `collectors`, and rejected requests
remain as a record.

**B. Create the real row immediately, marked inactive.** Smaller. But `users`
has no name or phone column, `collectors` has no hub, every existing list would
need to hide pending rows, and "inactive" would mean both "never approved" and
"deactivated later". One missed filter exposes an unapproved person, which is
the first anti-goal.

**C. Invite codes.** An admin issues a code; whoever holds it signs up straight
in. Dropped: the owner wants anyone to be able to join, not only invitees.

The owner speaks in outcomes and left the build approach to the designer. A is
the designer's call, for the reasons above.

## Decided with the owner

- One sign-up, with a choice of Collector or Operator.
- Layout: **option C from the mockups** — a split page. Left: a lime welcome
  panel explaining the product and both roles. Right: the form, with a
  Collector / Operator switch above the fields. On a narrow screen the panel
  stacks above the form. Mockup:
  `.superpowers/brainstorm/1765-1794731922/content/signup-layouts.html`.
- The sign-in page gains one line under the button: "New here? Create an
  account", linking to the sign-up page.

## Designer's calls (the owner was shown these and did not object; not explicitly agreed)

- **Sign-ups wait for approval.** The owner was offered instant access and did
  not choose it. Operators and collectors create the records that become
  payouts, so approval stays.
- **Collectors do not set a password.**
- **Fields.**
  - Collector: full name, phone, hub (chosen from the public hub directory,
    `GET /hubs/directory`).
  - Operator: full name, email, phone, password.
- **Who approves.** Admins approve or reject any request. Operators may approve
  or reject collector requests only, matching their existing right to create
  collectors. Auditors see nothing here.
- **Where the extra details live.** An operator's name and phone, and a
  collector's chosen hub, stay on the sign-up request, which keeps a link to the
  record it created.

## How it behaves

### Sign-up page

- Route `/signup` in the operator dashboard app, reachable signed out, the same
  way `/login` is.
- Welcome panel copy:
  - Heading: "Join ProofChain"
  - "Collectors bring in materials and get paid by weight."
  - "Operators weigh, record and manage collections at a hub."
  - "Every account is reviewed before it goes live."
- The switch defaults to Collector. Changing it swaps the field set. Labels:
  "Full name", "Phone number", "Your hub", "Email", "Password". Button: "Create
  account". Below: "Already have an account? Sign in".
- Phone follows the existing rule (`^\+?[0-9]{7,15}$`), placeholder
  `+2348012345678`. Password follows the existing minimum
  (`PASSWORD_MIN_LENGTH`) and 200 maximum.
- On success the person sees a confirmation in the same style: "Thanks,
  {first name}. Your details are saved and your account is waiting for
  approval. Operators can sign in once approved. Collectors will be paired to a
  phone at their hub." with a "Back to sign in" link.
- On a validation or conflict error the page shows the message and keeps the
  chosen role selected. Entered values other than the password should survive
  where practical.

### Backend

- New table `signup_requests`: id, role (`collector` | `operator`), name,
  phone, email (operators), passwordHash (operators; argon2id via
  `AuthService.hashPassword`), hubId (collectors), status (`pending` |
  `approved` | `rejected` | `expired`), createdAt, decidedAt, decidedByUserId,
  createdUserId, createdCollectorId.
- `POST /signups` — public. Protection against flooding (designer's call,
  settled after review):
  - A per-IP limit with the existing `@RateLimit` guard. The dashboard posts
    through a server action, so page sign-ups share the dashboard server's
    address; set the limit generously enough that ordinary use is never locked
    out (the builder picks the numbers). Note that requester registration has
    no limit today, so it is not a benchmark.
  - A ceiling on the total number of pending requests (configurable, default
    500). At the ceiling the endpoint refuses new sign-ups with "Sign-ups are
    paused for the moment. Please try again later." This is what bounds
    database growth and argon2 work when someone calls the backend directly
    from many addresses.
  - Forwarding the visitor's real address from the dashboard is not part of
    this work.
- Pending requests expire (designer's call, settled after review): a request
  still pending 14 days after submission counts as `expired`. It no longer
  blocks its email or phone, no longer counts toward the ceiling, drops off the
  pending list, cannot be approved, and has its hash cleared. This stops a
  stranger from locking someone out indefinitely by signing up with their email
  or phone. A newer sign-up never replaces an older pending one, because that
  would let a stranger overwrite a genuine request's password. The conflict
  message does reveal that an email or phone is already known; that matches
  requester registration today and is accepted.
- `POST /signups` validates per role. Rejects
  with a conflict when:
  - operator: the email already belongs to a user, or to a pending request;
  - collector: the phone already belongs to a collector, or to a pending
    request;
  - collector: the hub does not exist.
  Returns only id, role, name and status.
- `GET /signups?status=pending` — admin sees all; operator sees collector
  requests only. Never includes passwordHash.
- `POST /signups/:id/approve` and `POST /signups/:id/reject` — same role rule.
  Both fail with a conflict if the request is no longer pending.
  - Approve operator: in one transaction create an active `users` row with
    role `operator`, the request's email (lower-cased) and stored hash; mark the
    request approved and record who decided and the new user id. Then clear the
    hash from the request.
  - Approve collector: in one transaction create a `collectors` row (name,
    phone, kycLevel `none`); mark the request approved with the new collector
    id.
  - If the email or phone was taken between sign-up and approval, approval
    fails with a clear conflict message and the request stays pending.
  - Reject: mark rejected, record who decided, clear any hash. A rejected
    person may sign up again.

### Dashboard

- New page `/signups`, "Pending sign-ups", in the operator nav for admins and
  operators. A table: name, role, phone, email or hub, when submitted, with
  Approve and Reject on each row, using the existing table, button, badge and
  empty-state components. Reject asks for confirmation.
- Empty state: "No sign-ups are waiting."
- After approving a collector, the row's success message points to the
  Collectors page, where the phone is paired as today.
- Sign-in page: add the "New here? Create an account" line. When sign-in fails,
  extend the existing message with: "If you signed up recently, your account
  may still be waiting for approval." The backend's generic
  "invalid credentials" response is unchanged.

## Testing

- Backend unit tests in the existing style (`apps/backend/test`), covering:
  each role's happy path; every conflict above; approve creating exactly one
  real record; approval and rejection of a non-pending request; operator
  forbidden from deciding operator requests; auditor forbidden entirely;
  passwordHash absent from every response; the pending ceiling; a 14-day-old
  pending request no longer blocking or approvable; a pending operator cannot sign in
  and an approved one can.
- A migration test in the style of the existing ones.
- An end-to-end pass in a browser: sign up as each role, see the confirmation,
  approve as admin, sign in as the new operator, see the new collector in the
  Collectors list.

## Left to the builder

- Module and file layout in the backend, and the exact DTO shape (one DTO with
  conditional validation, or two).
- Whether the role switch is a small client component or a server-rendered
  link pair (`/signup?role=operator`).
- Whether the welcome panel reuses the login mascot or background art.
- Exact rate-limit numbers, table column types and index choices.
- Where the nav item sits and whether it shows a pending count.
- Adding `.superpowers/` to `.gitignore`.
