# Typography

**One type system across the ProofChain product surfaces.**

This document describes:

1. The two faces and the job each one has
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

## The two faces

| Role    | Face          | Used for                                       |
| ------- | ------------- | ---------------------------------------------- |
| Display | Poppins       | The wordmark and the page title.                |
| Text    | Poppins       | Everything else, every figure included.        |
| Machine | IBM Plex Mono | Machine strings only. See the rule below.      |

**Poppins** carries display and text alike. Display and text used to be two
faces — Fraunces over IBM Plex Sans — and collapsing them to one moves the
entire burden of hierarchy onto weight, size and space. A page title is 600 at
fluid 38→54 against body copy at 400; there is no change of voice underneath
it, so that gap has to be defended in the stylesheet rather than assumed. A
section heading that creeps upward now costs the page title its force.

The display role survives as a token (`--display`, `--rq-display`) even though
it resolves to the same family. Every rule that means "this is a title" still
says so, which makes reintroducing a second display face a one-line change
rather than a hunt through the sheet.

**IBM Plex Mono did not move.** It is the one face that stayed when everything
around it became Poppins, for a functional reason: Poppins has no monospace
cut, and machine strings are the strings a person transcribes character by
character. A Merkle root compared against a ledger by eye, a device public key,
an eight-character redemption code read off a collector's phone at a doorstep —
a proportional face is the wrong tool for all of them.

The cost is that the sans and the mono are no longer siblings. Plex Sans and
Plex Mono were drawn by the same hand, so a hash and the weight beside it used
to share a skeleton; now they are two families meeting in a table row. That is
a deliberate trade — legibility of the transcribed string beats the harmony of
the row.

One OpenType feature is forced on globally rather than per component:

- `tnum` — fixed-width digits, so a column of amounts lines up.

### Known gap: Poppins has no tabular figures

`tnum` is currently a **no-op**. Poppins ships no `tnum` feature, and its
figures are proportional rather than uniform — measured from
`@fontsource/poppins` latin-400:

| Digit | Advance width |
| ----- | ------------- |
| `1`   | 320           |
| `7`   | 546           |
| `0`   | 628           |
| `6`   | 635           |

A `1` is roughly half the width of a `0`, so anything relying on digits holding
their column no longer does. Two places feel it:

- **The capture weight readout** (`--numeral`, up to 6rem). It updates live as
  the scale settles, so the number visibly shifts sideways between readings.
  This is the worse of the two — it is the one thing that screen is arranged
  around reading.
- **Dashboard amount columns.** These are right-aligned by CSS, so the right
  edge still lines up; what drifts is the position of digits and separators
  within the column.

The `font-variant-numeric: tabular-nums` declarations are left in place. They
are correct, cost nothing, and start working the moment the face gains the
feature or is swapped.

Three ways out, none yet taken:

1. **Accept it.** Right-aligned columns still align; only the live readout
   genuinely misbehaves.
2. **Set the figures that must align in Plex Mono.** It is already loaded in
   both apps and is genuinely tabular. Costs the "a weight is a quantity, not a
   machine string" distinction this system was built on.
3. **Use a geometric sans that ships `tnum`** — Inter, DM Sans and Manrope all
   do, and all sit in the same register as Poppins.

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
- Poppins at 400/500/600/700, checked against the `font-weight` values that
  actually appear in `styles.css`.
- Plex Mono at 400 only.

Collapsing display and text into one family removed a whole face from this
bundle — on a metered SIM, the wordmark no longer costs its own download.

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
