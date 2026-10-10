import { splitRunIntoWords, type PdfLine, type PdfTextItem } from './pdf-lines';

/** Width of one character of the monospaced fixture font, in points. */
export const CHAR_WIDTH = 6;
/** Character column where the right edge of the PESOS and DOLARES amounts sits. */
export const PESOS_END = 100;
export const DOLLARS_END = 122;

/** A line with the PESOS and DOLARES amounts right-aligned to their columns. */
export function columnsRow(left: string, pesos = '', dollars = ''): string {
  const first = left.padEnd(PESOS_END - pesos.length) + pesos;
  return dollars === '' ? first : first.padEnd(DOLLARS_END - dollars.length) + dollars;
}

/** Turns monospaced text rows into the lines `extractPdfLines` would return, top to bottom. */
export function monospacedLines(rows: readonly string[]): PdfLine[] {
  return rows.map((text, index) => {
    const run: PdfTextItem = {
      text,
      x: 0,
      xEnd: text.length * CHAR_WIDTH,
      y: 800 - index * 12,
    };
    return splitRunIntoWords(run);
  });
}

export const MACRO_HEADER_ROWS: readonly string[] = [
  'BANCO MACRO S.A.   VISA CLASSIC',
  'CIERRE ACTUAL: 24 Sep 26',
  'VENCIMIENTO  SALDO $  SALDO U$S  PAGO MIN.$  PAGO MIN.U$S',
  '02 Oct 26    29.913,15  0,00  8.995,00  -,--',
  'VTO. ANTERIOR 01 Sep 26',
  'SALDO ANTERIOR $ 29913,15 U$S 0,00',
  'CIERRE ANTERIOR 20 Ago 26',
  'PROXIMO CIERRE 22 Oct 26',
  'PROXIMO VTO. 02 Nov 26',
];

export const MACRO_DETAIL_ROWS: readonly string[] = [
  columnsRow('FECHA COMPROBANTE DETALLE DE TRANSACCION', 'PESOS', 'DOLARES'),
  columnsRow('SALDO ANTERIOR', '29.913,15', '0,00'),
  columnsRow('01.09.26 SU PAGO EN PESOS', '29.913,15-'),
  columnsRow('11.05.26 001973* BIDCOM Cuota 05/18', '29.883,27'),
  columnsRow('Tarjeta 0045 Total Consumos de PEREZ JUAN', '29.883,27', '0,00'),
  columnsRow('24.09.26 IMPUESTO DE SELLOS $', '29,88'),
  columnsRow('SALDO ACTUAL $', '29.913,15'),
  columnsRow('PAGO MINIMO $', '8.995,00'),
];

export const MACRO_FOOTER_ROWS: readonly string[] = [
  'Cuotas a vencer: Octubre/26   $29.883,27   Noviembre/26   $29.883,27',
  'DEBITAREMOS DE SU C.A. 1234567 LA SUMA DE $ 29913,15',
];

export function macroVisaLines(detail: readonly string[] = MACRO_DETAIL_ROWS): PdfLine[] {
  return monospacedLines([...MACRO_HEADER_ROWS, ...detail, ...MACRO_FOOTER_ROWS]);
}
