import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { MORE_LIST_ITEMS, SETTINGS_ITEMS } from '../src/features/shell/nav-items';

function leaves(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('notifications catalog and navigation (FR-19)', () => {
  it('holds the same notifications keys in both languages, all non-empty', () => {
    const esKeys = leaves(es.notifications).sort();
    const enKeys = leaves(en.notifications).sort();

    expect(esKeys.length).toBeGreaterThan(10);
    expect(esKeys).toEqual(enKeys);
    expect(es.notifications.title).not.toBe(en.notifications.title);
  });

  it('labels the menu entry in both languages', () => {
    expect(es.app.nav.notificationSettings).toBeTruthy();
    expect(en.app.nav.notificationSettings).toBeTruthy();
  });

  it('lists the notifications settings entry in the side menu and in the More page', () => {
    const entry = SETTINGS_ITEMS.find((item) => item.href === '/settings/notifications');

    expect(entry?.labelKey).toBe('notificationSettings');
    expect(MORE_LIST_ITEMS.map((item) => item.href)).toContain('/settings/notifications');
  });

  it('has no hardcoded user-facing text in the feature or the page', () => {
    const root = join(__dirname, '..', 'src');
    const files = [
      ...sourceFiles(join(root, 'features', 'notifications')),
      join(root, 'app', '[locale]', '(app)', 'settings', 'notifications', 'page.tsx'),
    ];

    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // JSX text between tags that holds a letter, and quoted copy in user-facing attributes.
      expect(text.match(/>[^<>{}\n]*\p{L}[^<>{}\n]*</gu), file).toBeNull();
      expect(text.match(/\b(?:aria-label|title|placeholder|alt)="[^"]*\p{L}/u), file).toBeNull();
    }
  });
});
