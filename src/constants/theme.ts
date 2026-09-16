/**
 * Shared "vibrant & bold" visual language — gradients, radii, soft coloured
 * shadows. Introduced 2026-07, started on the Route tab as a preview before
 * extending to the rest of the app.
 */
export const GRADIENT = {
  /** Deep-to-bright green — headers, summary cards, primary buttons. */
  primary: ['#1f5c3f', '#4a9d70'] as const,
  /** Orange — trail/scenic accents, matching the map's trail colour. */
  accent: ['#ef6c00', '#ffab40'] as const,
  /** Red — destructive actions. */
  danger: ['#c0392b', '#e5695c'] as const,
};

export const RADIUS = { sm: 10, md: 16, lg: 20, xl: 28 };

/**
 * The shared palette settled on while redesigning the Route tab (light
 * surfaces, small green accents). Reused across every screen so they read as
 * one app — see [[visual-redesign-vibrant-bold]] memory.
 */
export const COLORS = {
  /** App background — a barely-there green-tinted off-white. */
  bg: '#f3f7f4',
  surface: '#ffffff',
  /** Deep / mid / bright green — the three accent greens (match GRADIENT.primary). */
  greenDeep: '#1f5c3f',
  green: '#2f6f4f',
  greenBright: '#4a9d70',
  /** Soft green tint for icon-chip backgrounds. */
  greenTint: '#eaf5ee',
  /** A clearly-green wash for the top nav bar — noticeably more saturated
   *  than `greenTint`/`bg` so it reads as green at a glance, not just an
   *  off-white blend (an earlier, paler attempt at this still read as white). */
  headerTint: '#a9d9bd',
  /** Warm orange echoing the map trail (#ef6c00) — for trail/scenic accents. */
  trail: '#ef6c00',
  trailSoft: '#f0b485',
  /** Soft orange wash, the `greenTint` equivalent for trail-accented chips. */
  trailTint: '#fdeee2',
  ink: '#1c1c1e',
  /** Muted grey-green for secondary/label text. */
  muted: '#8a978d',
  danger: '#c0392b',
} as const;

/** A soft, colour-tinted shadow (instead of plain black) for a "floating"
 *  card feel that matches the accent it sits near. */
export function coloredShadow(color: string, opacity = 0.18) {
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  } as const;
}
