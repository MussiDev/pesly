/** One word of a PDF page with its position, in PDF user space (y grows upwards). */
export interface PdfTextItem {
  text: string;
  x: number;
  xEnd: number;
  y: number;
}

/** The words that share a baseline, sorted left to right. */
export type PdfLine = PdfTextItem[];

/** Items whose baselines differ by at most this many points belong to the same line. */
export const LINE_Y_TOLERANCE = 2.5;

/**
 * Splits one text run into words. Mainframe-style statements are often emitted as a single run per
 * line with runs of spaces for the columns; the x of each word is then interpolated over the
 * run's width, which is exact for a monospaced font.
 */
export function splitRunIntoWords(run: PdfTextItem): PdfTextItem[] {
  const length = run.text.length;
  if (length === 0) return [];
  const width = run.xEnd - run.x;
  const words: PdfTextItem[] = [];
  for (const match of run.text.matchAll(/\S+/g)) {
    const start = match.index;
    words.push({
      text: match[0],
      x: run.x + (width * start) / length,
      xEnd: run.x + (width * (start + match[0].length)) / length,
      y: run.y,
    });
  }
  return words;
}

/**
 * Groups items into lines by baseline (top of the page first) and sorts each line by x. Pure, so
 * the fragile part of reading a PDF can be tested without pdf.js.
 */
export function groupItemsIntoLines(
  items: readonly PdfTextItem[],
  tolerance: number = LINE_Y_TOLERANCE,
): PdfLine[] {
  const sorted = items.filter((item) => item.text.trim() !== '').sort((a, b) => b.y - a.y);
  const lines: { y: number; items: PdfTextItem[] }[] = [];
  for (const item of sorted) {
    const current = lines.at(-1);
    if (current !== undefined && Math.abs(current.y - item.y) <= tolerance) {
      current.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  return lines.map((line) => line.items.sort((a, b) => a.x - b.x));
}

export function lineText(line: PdfLine): string {
  return line.map((item) => item.text).join(' ');
}
