/**
 * The theme tokens that leave CSS: the manifest and the `theme-color` meta only accept sRGB
 * colours, not `oklch()` or variables. Each value is the sRGB rendering of the token named next to
 * it in `globals.css`; `test/theme-colors.test.ts` fails if a token changes and these do not.
 */
export const THEME_COLORS = {
  /** `--background` in light. */
  lightBackground: '#f4f7fb',
  /** `--background` in dark. */
  darkBackground: '#090d16',
  /** `--primary` in light: the icon tile. */
  brand: '#4f46e5',
} as const;
