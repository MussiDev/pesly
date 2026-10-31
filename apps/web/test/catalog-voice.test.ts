import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Catalog = { [key: string]: string | Catalog };

function flatten(catalog: Catalog, prefix = ''): [string, string][] {
  return Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : flatten(value, `${prefix}${key}.`),
  );
}

/** Second-person forms of tuteo; the Spanish catalog speaks in voseo everywhere (decision L6). */
const TUTEO = new Set([
  'tienes',
  'puedes',
  'necesitas',
  'eres',
  'tú',
  'ingresa',
  'elige',
  'revisa',
  'vuelve',
  'inténtalo',
  'intenta',
  'escribe',
  'agrega',
  'usa',
  'crea',
  'cámbiala',
]);

/** Keys whose third-person verb reads like tuteo out of context ("se usa", "crea dos cuentas"). */
function offenders(entries: readonly [string, string][]): string[] {
  return entries
    .filter(([, value]) => {
      const words = value.toLowerCase().split(/[^a-záéíóúñ]+/);
      // "se usa" and "{ticker} ya usa" are third person, not an instruction to the user.
      return words.some(
        (word, index) => TUTEO.has(word) && !['se', 'ya'].includes(words[index - 1] ?? ''),
      );
    })
    .map(([key]) => key);
}

const es = JSON.parse(
  readFileSync(new URL('../messages/es.json', import.meta.url), 'utf8'),
) as Catalog;

describe('Spanish catalog voice', () => {
  it('speaks in voseo in every string, as an Argentine product (L6, Jakob: the local register)', () => {
    expect(offenders(flatten(es))).toEqual([]);
  });

  it('error: a tuteo string is reported, a third-person "se usa" is not', () => {
    expect(
      offenders([
        ['a', 'Ingresa el monto.'],
        ['b', 'Se usa el último día.'],
        ['c', 'Ingresá el monto.'],
      ]),
    ).toEqual(['a']);
  });
});
