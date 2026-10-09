import { describe, expect, it } from 'vitest';
import { extractPdfLines } from './extract-pdf-lines';
import { MACRO_DETAIL_ROWS, MACRO_FOOTER_ROWS, MACRO_HEADER_ROWS } from './macro-visa-fixture';
import { parsePdfStatementLines } from './parse-statement-pdf';
import { StatementParseError } from './statement-types';

/** A one-page PDF with the rows in 10 pt Courier (6 pt per character), one text run per row. */
function textPdf(rows: readonly string[]): ArrayBuffer {
  const escape = (text: string) =>
    text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = [
    'BT /F1 10 Tf 12 TL',
    ...rows.map((row, index) => `1 0 0 1 0 ${800 - index * 12} Tm (${escape(row)}) Tj`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 820] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new TextEncoder().encode(pdf);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

// The legacy build runs in Node without a bundled worker file; the app loads the regular build.
async function nodePdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

describe('extractPdfLines', () => {
  it('extracts a real text PDF into lines that parse as a Macro statement', async () => {
    const rows = [...MACRO_HEADER_ROWS, ...MACRO_DETAIL_ROWS, ...MACRO_FOOTER_ROWS];
    const lines = await extractPdfLines(textPdf(rows), await nodePdfJs());
    expect(lines.map((line) => line.map((word) => word.text).join(' '))[1]).toBe(
      'CIERRE ACTUAL: 24 Sep 26',
    );
    const statement = parsePdfStatementLines(lines);
    expect(statement).toMatchObject({
      closingDate: '2026-09-24',
      dueDate: '2026-10-02',
      cardEnding: '0045',
      totals: { ARS: '2991315', USD: null },
    });
    expect(statement.lines.map((line) => [line.kind, line.amount])).toEqual([
      ['payment', '-2991315'],
      ['purchase', '2988327'],
      ['fee', '2988'],
    ]);
  });

  it('returns no lines for a PDF page without text', async () => {
    const lines = await extractPdfLines(textPdf([]), await nodePdfJs());
    expect(lines).toEqual([]);
  });

  it('reports bytes that are not a PDF as unreadable', async () => {
    const bytes = new TextEncoder().encode('not a pdf').buffer;
    await expect(extractPdfLines(bytes, await nodePdfJs())).rejects.toMatchObject({
      code: 'unreadable',
    });
    await expect(extractPdfLines(bytes, await nodePdfJs())).rejects.toBeInstanceOf(
      StatementParseError,
    );
  });

  describe('encrypted files', () => {
    type Loader = Parameters<typeof extractPdfLines>[1];
    const failingWith = (error: unknown, seen: unknown[] = []): Loader => ({
      getDocument: ((params: unknown) => {
        seen.push(params);
        return { promise: Promise.reject(error) };
      }) as unknown as NonNullable<Loader>['getDocument'],
    });
    const passwordError = (code: number) =>
      Object.assign(new Error('x'), { name: 'PasswordException', code });
    const data = new TextEncoder().encode('%PDF').buffer;

    it('asks for a password when pdf.js needs one', async () => {
      await expect(extractPdfLines(data, failingWith(passwordError(1)))).rejects.toMatchObject({
        code: 'passwordRequired',
      });
    });

    it('reports an incorrect password', async () => {
      await expect(
        extractPdfLines(data, failingWith(passwordError(2)), 'nope'),
      ).rejects.toMatchObject({ code: 'wrongPassword' });
    });

    it('hands the password to pdf.js and only when there is one', async () => {
      const seen: unknown[] = [];
      await extractPdfLines(data, failingWith(passwordError(2), seen), 'secret').catch(() => null);
      await extractPdfLines(data, failingWith(passwordError(1), seen)).catch(() => null);
      expect(seen[0]).toMatchObject({ password: 'secret' });
      expect(seen[1]).not.toHaveProperty('password');
    });

    it('treats any other failure as unreadable', async () => {
      await expect(extractPdfLines(data, failingWith(new Error('boom')))).rejects.toMatchObject({
        code: 'unreadable',
      });
      await expect(extractPdfLines(data, failingWith(passwordError(9)))).rejects.toMatchObject({
        code: 'unreadable',
      });
    });
  });
});
