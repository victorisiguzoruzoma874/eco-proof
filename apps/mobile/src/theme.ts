/**
 * Field-first visual language.
 *
 * This app is used outdoors, one-handed, often in direct sun and sometimes in
 * gloves. That drives every choice here: near-black ground with high-contrast
 * type for sunlight legibility, oversized touch targets, and status colours that
 * stay distinguishable for the most common forms of colour blindness — status is
 * never signalled by hue alone, always with a label beside it.
 */

export const colors = {
  ground: "#0B0F0E",
  surface: "#141A18",
  surfaceRaised: "#1D2422",
  border: "#2A3330",

  text: "#F2F5F4",
  textMuted: "#9BA8A4",
  textFaint: "#66736F",

  // Recovered-material green: the product's one saturated accent.
  accent: "#38E08A",
  accentPressed: "#26B76D",
  onAccent: "#062315",

  queued: "#F2B950",
  synced: "#38E08A",
  rejected: "#FF6B6B",
  syncing: "#5AB9F2",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
} as const;

/**
 * The three faces the whole product uses — see `docs/typography.md`.
 *
 * React Native will not synthesise a weight from a variable font the way a
 * browser does: each weight is a separately registered family, and setting
 * `fontWeight` on a custom family is silently ignored on Android. So weight is
 * chosen by picking a family here, and `fontWeight` appears nowhere in this app.
 *
 * The names are the keys `App.tsx` registers with `useFonts`; nothing renders
 * until that resolves, so a style referencing one of these is never applied to
 * an unloaded family.
 */
export const font = {
  regular: "IBMPlexSans_400Regular",
  medium: "IBMPlexSans_500Medium",
  semibold: "IBMPlexSans_600SemiBold",
  bold: "IBMPlexSans_700Bold",
  /* The wordmark and nothing else. There is no editorial writing on a screen
     someone is holding beside a scale. */
  display: "Fraunces_600SemiBold",
  /*
   * Machine strings: a lookup code, a device key. This used to be
   * `Platform.select({ ios: "Menlo", android: "monospace" })` — two different
   * typefaces depending on the handset, for the one string a collector has to
   * transcribe exactly. Plex Mono is the same face the dashboard and the
   * capture app now use, so a code looks identical wherever it is read.
   */
  mono: "IBMPlexMono_400Regular",
} as const;

export const type = {
  display: { fontFamily: font.bold, fontSize: 56 },
  title: { fontFamily: font.bold, fontSize: 24 },
  body: { fontFamily: font.regular, fontSize: 16 },
  label: { fontFamily: font.semibold, fontSize: 13, letterSpacing: 0.8 },
  mono: { fontFamily: font.mono, fontSize: 12 },
} as const;

export const statusColor: Record<string, string> = {
  queued: colors.queued,
  syncing: colors.syncing,
  synced: colors.synced,
  rejected: colors.rejected,
};
