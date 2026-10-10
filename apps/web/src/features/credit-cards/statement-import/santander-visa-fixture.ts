import { splitRunIntoWords, type PdfLine } from './pdf-lines';

/** A text item as pdf.js reports it: the text and its horizontal extent. */
export type FixtureItem = readonly [text: string, x: number, xEnd: number];

/** Rows of items, top to bottom, turned into the lines `extractPdfLines` would return. */
export function itemRows(rows: readonly (readonly FixtureItem[])[]): PdfLine[] {
  return rows.map((items, index) =>
    items.flatMap(([text, x, xEnd]) => splitRunIntoWords({ text, x, xEnd, y: 800 - index * 14 })),
  );
}

const PURCHASE_HEADER: FixtureItem[] = [
  ['Fecha', 45, 72],
  ['Descripción', 104, 157],
  ['Cuota', 253, 280],
  ['Comprobante', 300, 363],
  ['Monto en pesos', 380, 454],
  ['Monto en dólares', 470, 551],
];

/** A synthetic "Resumen Visa" with the layout of the real one and invented values only. */
export const SANTANDER_ROWS: (readonly FixtureItem[])[] = [
  [['Resumen Visa', 40, 179]],
  [['Total a pagar', 42, 117]],
  [
    ['En pesos', 50, 99],
    ['En dólares', 230, 288],
    ['Mínimo a pagar', 410, 497],
  ],
  [
    ['$ 9.005,00', 50, 146],
    ['U$S 20,00', 230, 295],
    ['$ 500,00', 410, 486],
  ],
  [['Período', 42, 86]],
  [
    ['20/08/26', 60, 101],
    ['01/09/26', 148, 189],
    ['24/09/26', 234, 275],
    ['05/10/26', 320, 363],
    ['22/10/26', 406, 447],
    ['02/11/26', 481, 522],
  ],
  [['Pago anterior y devoluciones', 40, 206]],
  [
    ['Fecha', 45, 72],
    ['Descripción', 104, 157],
    ['Monto en pesos', 375, 449],
    ['Monto en dólares', 467, 548],
  ],
  [
    ['01/09/26', 45, 87],
    ['Saldo anterior', 104, 169],
    ['$ 100,00', 396, 455],
    ['U$S 5,00', 503, 549],
  ],
  [
    ['Su pago en pesos 100,00 tc1000,000', 104, 292],
    ['-$ 100,00', 392, 455],
    ['-U$S 5,00', 499, 549],
  ],
  [
    ['Saldo del resumen anterior', 53, 183],
    ['$ 0,00', 428, 456],
    ['U$S 0,00', 509, 550],
  ],
  [['Movimientos de Persona Ejemplo', 42, 218]],
  [['Visa crédito terminada en 1234', 42, 215]],
  PURCHASE_HEADER,
  [
    ['30/04/26', 45, 87],
    ['Tienda uno', 104, 160],
    ['5 de 6', 250, 278],
    ['000111', 300, 334],
    ['$ 7.339,97', 410, 458],
  ],
  [
    ['22/08/26', 45, 87],
    ['Servicio en dolares', 104, 239],
    ['000222', 300, 334],
    ['U$S 20,00', 504, 550],
  ],
  [
    ['25/08/26', 45, 87],
    ['Seguro de', 104, 150],
    ['000333', 300, 334],
    ['$ 1.642,08', 404, 458],
  ],
  [['vivi0000534455783-021-004', 104, 236]],
  [['Copia fiel de carácter informativo', 40, 194]],
  PURCHASE_HEADER,
  [
    ['07/09/26', 45, 87],
    ['Suscripcion uno', 104, 206],
    ['000444', 300, 334],
    ['$ 13,90', 404, 458],
  ],
  [
    ['Suscripcion dos', 104, 193],
    ['000555', 300, 334],
    ['$ 6,00', 410, 458],
  ],
  [
    ['Subtotal de Persona Ejemplo', 103, 228],
    ['$ 9.001,95', 389, 458],
    ['U$S 20,00', 503, 550],
  ],
  [['Impuestos, intereses y percepciones', 42, 250]],
  [
    ['Fecha', 45, 72],
    ['Descripción', 104, 157],
    ['Monto en pesos', 377, 451],
    ['Monto en dólares', 469, 550],
  ],
  [
    ['24/09/26', 45, 87],
    ['Impuesto de sellos $', 104, 200],
    ['$ 0,05', 423, 457],
  ],
  [
    ['Iibb percep-sant 3,00%( 100,00)', 104, 255],
    ['$ 3,00', 423, 457],
  ],
  [
    ['Total a pagar', 54, 116],
    ['$ 9.005,00', 391, 460],
    ['U$S 20,00', 503, 550],
  ],
  [
    ['Mínimo a pagar', 54, 129],
    ['$ 500,00', 406, 460],
  ],
];

export function santanderLines(
  rows: readonly (readonly FixtureItem[])[] = SANTANDER_ROWS,
): PdfLine[] {
  return itemRows(rows);
}
