/**
 * The school's brand colour, as CSS custom properties.
 *
 * `school_settings.theme_color` already exists and already colours every report card, receipt and
 * statement. This carries the same value into the interface, so a school's screens and its printed
 * documents match — which is the whole point of letting them choose one.
 *
 * Written as custom properties rather than compiled into the stylesheet because this is a
 * multi-tenant deployment: one build serves every school, and each one repaints at runtime. It is
 * the same mechanism OpenMRS uses for `--brand-01`.
 *
 * Three shades, matching their roles:
 *   --brand-01  the colour itself      — the header, primary buttons
 *   --brand-02  darker                 — hover and active states
 *   --brand-03  lighter                — accents, the underline beneath a section title
 */

interface Hsl {
  h: number;
  s: number;
  l: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** #rgb or #rrggbb to HSL. Returns null for anything that is not a hex colour. */
const hexToHsl = (hex: string): Hsl | null => {
  const value = String(hex || '').trim().replace('#', '');
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l: l * 100 };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;

  return { h: h * 60, s: s * 100, l: l * 100 };
};

const hsl = ({ h, s, l }: Hsl) => `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`;

/**
 * Is this colour dark enough to carry white text?
 *
 * The header puts white text and icons on --brand-01. A school that picks a pale yellow would get
 * white on near-white, so the shell falls back to Carbon's dark chrome rather than rendering
 * something unreadable. Relative luminance, per WCAG.
 */
export const needsLightText = (hex: string): boolean => {
  const value = String(hex || '').trim().replace('#', '');
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return true;

  const channel = (pair: string) => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  const luminance =
    0.2126 * channel(full.slice(0, 2)) +
    0.7152 * channel(full.slice(2, 4)) +
    0.0722 * channel(full.slice(4, 6));

  // Contrast against white beats contrast against black below this point.
  return luminance < 0.45;
};

/**
 * The lightness a brand colour must reach to be legible on a dark ground.
 *
 * A school that picks a deep navy gets a primary button that all but disappears against g100's
 * #161616 — the colour is correct, the contrast is not. Rather than refusing the choice or
 * substituting a different hue, the same colour is lifted until it separates from the background,
 * which keeps it recognisably the school's own.
 */
const DARK_MODE_MIN_LIGHTNESS = 55;

/**
 * Puts the school's colour on the document. Called whenever the settings load or change.
 *
 * `dark` matters because the three shades are not theme-independent. On a light page the hover
 * state is a *darker* step towards the background's opposite; on a dark page that same step moves
 * the colour towards the background and reads as the button switching off. The direction inverts,
 * and the base colour needs a floor under it.
 */
export const applyBrand = (themeColor: string, dark = false) => {
  if (typeof document === 'undefined') return;

  const base = hexToHsl(themeColor);
  const root = document.documentElement;

  if (!base) {
    // An unset or malformed colour leaves the stylesheet's own fallbacks in place rather than
    // painting the app an accidental colour.
    root.style.removeProperty('--brand-01');
    root.style.removeProperty('--brand-02');
    root.style.removeProperty('--brand-03');
    root.style.removeProperty('--brand-contrast');
    return;
  }

  const primary = dark ? { ...base, l: clamp(Math.max(base.l, DARK_MODE_MIN_LIGHTNESS), 0, 100) } : base;

  // Hover steps away from the page, not always downwards: lighter still on a dark ground, darker on
  // a light one. And --brand-03, the accent under a section title, steps the other way from hover
  // so the two never collapse into the same colour.
  const hoverStep = dark ? 8 : -10;
  const accentStep = dark ? -12 : 12;

  root.style.setProperty('--brand-01', hsl(primary));
  root.style.setProperty('--brand-02', hsl({ ...primary, l: clamp(primary.l + hoverStep, 0, 100) }));
  root.style.setProperty('--brand-03', hsl({ ...primary, l: clamp(primary.l + accentStep, 0, 100) }));
  // Contrast is measured against the shade actually painted, which after the floor above may not be
  // the colour the school entered.
  root.style.setProperty('--brand-contrast', primary.l < 55 ? '#ffffff' : '#161616');
};
