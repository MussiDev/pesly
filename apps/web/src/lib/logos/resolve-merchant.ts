import { MERCHANT_CATALOG, type MerchantEntry } from './merchant-catalog';
import { tokenize } from './normalize';

interface Candidate {
  entry: MerchantEntry;
  words: readonly string[];
  /** Characters across all words: the second criterion when two keywords have as many words. */
  size: number;
  /** Position in the catalog: the last criterion. */
  order: number;
}

/** Whether `needle` appears in `haystack` as a contiguous run of whole words. */
function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
}

/** More words win, then more characters, then the entry listed first. */
function isBetter(candidate: Candidate, current: Candidate): boolean {
  if (candidate.words.length !== current.words.length) {
    return candidate.words.length > current.words.length;
  }
  if (candidate.size !== current.size) return candidate.size > current.size;
  return candidate.order < current.order;
}

/**
 * Builds a resolver over a catalog. The note is untrusted text: it is only tokenized and compared,
 * never turned into a pattern, a path or markup, so matching is linear in the note's length times
 * the number of keywords.
 */
export function createMerchantResolver(catalog: readonly MerchantEntry[]) {
  const candidates: Candidate[] = catalog.flatMap((entry, order) =>
    entry.keywords.flatMap((keyword) => {
      const words = tokenize(keyword);
      return words.length === 0 ? [] : [{ entry, words, size: words.join('').length, order }];
    }),
  );

  return (note: string | null | undefined): MerchantEntry | undefined => {
    if (note === null || note === undefined) return undefined;
    const words = tokenize(note);
    let best: Candidate | undefined;
    for (const candidate of candidates) {
      if (!containsRun(words, candidate.words)) continue;
      if (best === undefined || isBetter(candidate, best)) best = candidate;
    }
    return best?.entry;
  };
}

/** The entry a movement note names, or `undefined` when it names none. */
export const resolveMerchant = createMerchantResolver(MERCHANT_CATALOG);
