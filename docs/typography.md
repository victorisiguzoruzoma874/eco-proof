# Typography

**One type system across the ProofChain product surfaces.**

This document describes:

1. The three faces and the single job each one has
2. The rule that decides when text is set in a monospace
3. The shared type scale
4. How each surface loads the faces, and why they differ

## Why this exists

ProofChain has four frontends with four audiences: a landing page read by credit
buyers, an operator dashboard used for reconciliation, a requester app a
household opens on a phone, and a capture app a collector uses at a weighbridge.

Before this system they used seven typefaces between them, with no rule shared
across any two:

| Surface   | Display          | Text            | Machine        |
| --------- | ---------------- | --------------- | -------------- |
| operator  | Playfair Display | Instrument Sans | IBM Plex Mono  |
| requester | Manrope          | Manrope         | — none —       |
| capture   | — none —         | system default  | system default |
| landing   | Newsreader       | Public Sans     | JetBrains Mono |

The capture app had never chosen a face at all: it took whatever the handset
offered, which on the cheap Androids it actually runs on means a different
metric per device and a weight numeral that is a different width on every phone
in the fleet.

## The three faces

| Role    | Face          | Used for                                       |
| ------- | ------------- | ---------------------------------------------- |
| Display | Fraunces      | The wordmark and the page title. Nowhere else. |
| Text    | IBM Plex Sans | Everything else, every figure included.        |
| Machine | IBM Plex Mono | Machine strings only. See the rule below.      |

**Fraunces** carries a true optical-size axis, so it is redrawn for the size
rather than scaled to it — which is what lets one face hold a 54px page title
and a 20px wordmark without either going flabby or falling apart. Its remit is
still narrow: a wordmark and a page title, and nothing inside a table's
neighbourhood. Section headings are Plex Sans; a serif at 20px beside a ledger
reads as a magazine standfirst dropped into a spreadsheet.

Two of its personality axes are pinned off, once, in `--fraunces-axes`:

- `SOFT 0` — sharp terminals rather than rounded ones.
- `WONK 0` — the upright `g` and straight-legged `a`, not the swash forms.

Both defaults are charming and both are wrong here. This is a screen where an
auditor decides whether to believe a tonnage; the wonky alternates read as a
magazine having fun. The face keeps its warmth through optical sizing and its
slightly flared stems, which is as much personality as this product should
carry.

**IBM Plex Sans and IBM Plex Mono are siblings**, and that is the whole reason
for choosing Plex over a pair drawn by different hands. A Merkle root and the
weight beside it share a skeleton, proportions and rhythm, so a table row reads
as one instrument rather than as two fonts meeting. Plex was also commissioned
to give an engineering company a voice of its own: it reads as instrument, not
as app, which is the right register for a product whose argument is "check it
yourself".

One OpenType feature is forced on globally rather than per component:

- `tnum` — fixed-width digits, so a column of amounts lines up. This, not a
  change of typeface, is what holds a column.

Nothing else. Earlier revisions bought character-level disambiguation with
Inter's `zero` and `cv05` features; it is now structural instead. The strings
where telling 0 from O decides whether a batch reconciles are set in Plex Mono,
which draws them apart by design.

## The rule

> Monospace is for a string a person has to check against another copy,
> character by character. Everything else is set in the text face.

Hashes, Merkle roots, transaction ids, ledger sequences, public keys, redemption
codes and file paths are machine strings. A kilogram is not. Neither is a credit
balance, a table heading, a status badge, a caption, or a timestamp.

Until this revision the monospace was a system stack — `ui-monospace, SF Mono,
Menlo, Consolas`. That meant the most scrutinised text in the product, the text
a credit buyer compares against the Stellar ledger character by character,
rendered in a different typeface on every viewer's machine. It is now a chosen
face on every surface, the capture app and the phone app included.

This inverts what all four stylesheets used to do. Every one of them set mono on
labels — table heads, stat captions, status pills, section eyebrows — and mono
on labels is the loudest generic-admin-panel tell a product can have. It also
spent the one signal that should mean "check this carefully" on text nobody ever
needs to check. Eleven date cells were also in mono; a timestamp is read, not
collated.

## Capitals

Capitals are used in exactly two places:

- **The page eyebrow** — 12px / 600 / `0.05em`. Two or three words naming a
  queue, read once on arrival to confirm you are in the right place.
- **Table column heads** — 11px / 600 / `0.04em`. A fixed one- or two-word key a
  reader scans past rather than reads, and the flattened silhouette is what
  separates it from the data underneath.

Everywhere else is sentence case. Capitals flatten the ascender/descender
silhouette a reader identifies a word by, so a run of them down a card or a
sidebar reads slower at exactly the size where reading is already hardest.

## The scale

Every `font-size` in the operator stylesheet resolves to one of these.

```text
--text-3xs    0.6875rem   11px   table heads, badges
--text-2xs    0.75rem     12px   eyebrow, metadata, metric labels
--text-xs     0.8125rem   13px   nav, buttons, dense table body
--text-sm     0.875rem    14px   table body, form controls
--text-md     0.9375rem   15px   intro copy
--text-base   1rem        16px   body
--text-lg     1.125rem    18px
--text-xl     1.25rem     20px   section heading
--text-2xl    1.5rem      24px   large section heading
--text-metric 2rem        32px   metric figures

--text-display  clamp(2.375rem, 1.6rem + 2.6vw, 3.375rem)   38px → 54px
```

The page title is the only fluid size: 38px on a phone, 54px from about 1200px
up, reached by viewport rather than by a breakpoint step so it never lands
mid-word on an odd width.

Two sizes deliberately sit off the scale:

- The requester shell is 15px, not 16px. It is a phone-first reading surface and
  16px pushes the card copy to a second line too often.
- `--numeral` in the capture app is `clamp(3.5rem, 2rem + 12vw, 6rem)`. It is the
  only thing on that screen anyone is trying to read from a distance.

## Loading

| Surface   | Mechanism                         | Why                                    |
| --------- | --------------------------------- | -------------------------------------- |
| dashboard | `next/font/google`                | Self-hosted at build, no layout shift. |
| capture   | `@fontsource*` through Vite       | **Must not be remote.** See below.     |
| mobile    | `@expo-google-fonts` + `useFonts` | Bundled into the app binary.           |

### One trap worth knowing

`next/font` declares its CSS variables on the element that carries the generated
class — in this app, the wrapper `<div>` inside `<body>`. A custom property is
only visible to the element that declares it and its descendants, so a token
built on it must be declared in the same scope:

```css
/* Wrong: `--font-sans` is unresolvable here. */
:root  { --sans: var(--font-sans), ui-sans-serif, system-ui; }

/* Right: same element next/font writes to. */
.operator-root { --sans: var(--font-sans), ui-sans-serif, system-ui; }
```

The wrong version fails silently and badly. An unresolvable `var()` makes the
whole `font-family` declaration invalid at computed-value time, and an invalid
`font-family` falls back to the initial value — the browser's default serif. The
entire dashboard renders in Times, and every fallback in the stack is skipped,
because the stack itself never applies.

### Why capture bundles rather than links

The capture app is opened by a collector standing at a weighbridge with one bar
of signal or none, and its service worker (`apps/capture/public/sw.js`) only
cache-firsts same-origin `/assets/`. A `<link>` to a font CDN would render in
the fallback stack on exactly the days the app matters most, and because the
fallback has different metrics, the weight numerals would reflow after the fact.

Importing the faces in `apps/capture/src/main.ts` makes Vite emit content-hashed
`woff2` into `/assets/`, which the service worker already caches permanently and
correctly.

What is imported there is audited rather than taken wholesale, because every
unused cut is bytes a field phone caches forever:

- Latin subsets only — no Cyrillic, Greek or Vietnamese, and no `woff` fallback.
- Plex Sans at 400/500/600/700, checked against the `font-weight` values that
  actually appear in `styles.css`.
- Plex Mono at 400 only.
- Fraunces on its `wght` axis alone: no italic, no optical-size range, no
  `SOFT`/`WONK` alternates. On a metered SIM those axes are bytes spent on the
  two words of the wordmark.

### Why mobile names a family per weight

React Native will not synthesise a weight from a variable font the way a browser
does. Each weight is a separately registered family, and `fontWeight` on a
custom family is silently ignored on Android. So `src/theme.ts` exports a `font`
map and weight is chosen by picking a family; `fontWeight` appears nowhere in
that app. `App.tsx` holds the first frame until `useFonts` resolves, because a
swap after paint would reflow the weight numeral — the one thing on that screen
that must not move.

## The landing site

`proofchain-landing/` is **not** on this system yet. It runs Newsreader /
Archivo / JetBrains Mono from an earlier pass, and its 18 tracked-capital labels
were already converted to sentence case. Bringing it onto DM Serif Display and
Inter is a separate change: it is a persuasion surface with its own hero, its
own optical-size heading axis, and its own test suite that asserts against the
rendered page.

## Adding to a stylesheet

1. Use a scale token. Do not write a raw `rem` value.
2. Use `--sans` unless the content is the page title (`--serif`) or a machine
   string (`--mono`).
3. Numbers need no special handling — `tnum` is on globally. Right-align a
   column of them with `.num`.
4. Do not add `text-transform: uppercase` to a label. The two places capitals
   belong are listed above; anywhere else, rank with weight and colour.
