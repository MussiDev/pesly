import type * as PdfJsModule from 'pdfjs-dist';
import {
  groupItemsIntoLines,
  splitRunIntoWords,
  type PdfLine,
  type PdfTextItem,
} from './pdf-lines';
import { StatementParseError } from './statement-types';

type PdfJs = typeof PdfJsModule;

/** pdf.js is loaded on demand so it never weighs on the other pages. */
async function loadPdfJs(): Promise<PdfJs> {
  const pdfjs = await import('pdfjs-dist');
  // The worker is a bundled asset served from the app's own origin (allowed by `worker-src 'self'`).
  if (pdfjs.GlobalWorkerOptions.workerSrc === '') {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  }
  return pdfjs;
}

/**
 * Reads every page's text and returns it as lines of positioned words, page after page. `pdfjs`
 * can be injected (the tests pass the Node build, which needs no worker file).
 */
export async function extractPdfLines(
  data: ArrayBuffer,
  pdfjs?: Pick<PdfJs, 'getDocument'>,
): Promise<PdfLine[]> {
  try {
    const lib = pdfjs ?? (await loadPdfJs());
    const task = lib.getDocument({
      // pdf.js 6 has no eval-based code paths, so there is no `isEvalSupported` switch to turn off.
      data: new Uint8Array(data),
    });
    const document = await task.promise;
    const lines: PdfLine[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const raw of content.items) {
        if (!('str' in raw)) continue;
        // pdf.js types the transform matrix as `any[]`; indexes 4 and 5 are the translation.
        const transform: unknown[] = raw.transform;
        const x = Number(transform[4]);
        const y = Number(transform[5]);
        items.push(...splitRunIntoWords({ text: raw.str, x, xEnd: x + raw.width, y }));
      }
      lines.push(...groupItemsIntoLines(items));
    }
    await task.destroy();
    return lines;
  } catch {
    throw new StatementParseError('unreadable');
  }
}
