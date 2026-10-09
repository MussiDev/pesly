import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Catalog = { [key: string]: string | Catalog };

function load(locale: string): Catalog {
  const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}

function recurringOf(locale: string): Catalog {
  const section = load(locale)['recurring'];
  if (section === undefined || typeof section === 'string') throw new Error('missing namespace');
  return section;
}

describe('recurring catalogs (AC-19)', () => {
  it('has every status label in Spanish and English', () => {
    const statuses = [
      'scheduled',
      'pending',
      'overdue',
      'confirmed',
      'skipped',
      'paused',
      'active',
    ];
    for (const locale of ['es', 'en']) {
      const status = recurringOf(locale)['status'] as Catalog;
      for (const key of statuses) expect(typeof status[key]).toBe('string');
    }
    const es = recurringOf('es')['status'] as Catalog;
    expect(es['overdue']).toBe('Vencido');
    expect(es['skipped']).toBe('Omitido');
  });

  it('has the three frequencies, the seven weekdays and every action in both languages', () => {
    for (const locale of ['es', 'en']) {
      const section = recurringOf(locale);
      expect(Object.keys(section['frequency'] as Catalog).sort()).toEqual(
        ['label', 'monthly', 'weekly', 'yearly'].sort(),
      );
      for (const day of ['0', '1', '2', '3', '4', '5', '6']) {
        expect(typeof (section['weekday'] as Catalog)[day]).toBe('string');
      }
      for (const action of ['create', 'edit', 'pause', 'resume', 'delete', 'confirm', 'skip']) {
        expect(typeof (section['actions'] as Catalog)[action]).toBe('string');
      }
    }
  });

  it('has the navigation label in both languages', () => {
    for (const locale of ['es', 'en']) {
      const nav = ((load(locale)['app'] as Catalog)['nav'] as Catalog)['recurring'];
      expect(typeof nav).toBe('string');
    }
  });
});
