/**
 * Splits a text into comparable words: accents stripped, lower-cased, cut on anything that is not a
 * letter or a digit. The patterns are constants; no text from a note or a catalog ever becomes one.
 */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
}
