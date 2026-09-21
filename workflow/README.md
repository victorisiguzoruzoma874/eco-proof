# ProofChain — Workflow

How the four apps in this monorepo fit together, who does what in each, and
exactly how a household waste pickup turns into credits in a user's wallet.

| Doc | What it covers |
| --- | --- |
| [01-system-map.md](01-system-map.md) | The four apps, the actors, who talks to whom, and the auth boundaries |
| [02-collection-workflow.md](02-collection-workflow.md) | The end-to-end flow: request → collect → weigh → QR → credit |
| [03-admin-oversight.md](03-admin-oversight.md) | What the admin/operator sees and controls across all three surfaces |
| [04-gaps.md](04-gaps.md) | The doorstep build: what was closed, the trust decision behind it, and what is still open |

## The one-paragraph version

A **user** (requester) signs into the Next.js **dashboard** and books a waste
pickup, optionally sharing a GPS pin. An **operator** assigns it to a
**collector**, whose **capture** PWA picks it up within 45 seconds and raises a
notification with a map link. The collector drives out, weighs the waste, signs
the weigh-in on the phone with an ed25519 key, and posts it — getting back an
8-character **redemption code**, rendered as a **QR on their own screen**. The
user scans it there and then; their wallet is credited
`weight (kg) × credits-per-kg rate`. When the material later reaches a **hub**
and is independently re-weighed, any difference is settled by an adjusting
ledger entry. Credits can be withdrawn as cash or spent in the rewards catalog.
The **admin** sits above all of it: rates, materials, hubs, collectors, users,
catalog, withdrawals.

A second path still exists for material that reaches the hub before anyone is
paid: the operator links a hub-verified weigh-in to the request, and the credit
is the hub's figure with nothing to reconcile.

## Reading the diagrams

Diagrams are Mermaid. They render in GitHub, VS Code (with a Mermaid
extension), and most Markdown viewers.

## Status of this document

It describes the system **as built** in this repo, read from the source. The
doorstep flow (device-signed job feed, collector-side QR, wallet reconciliation,
geolocation, camera scanner) is implemented; [04-gaps.md](04-gaps.md) records
the trust decision it rests on and what remains open.
