import {
  ArrowLeftRight,
  Bell,
  BellRing,
  CreditCard,
  Ellipsis,
  House,
  Landmark,
  Repeat,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Target,
  TrendingUp,
  Users,
  ChartLine,
  ChartPie,
  type LucideIcon,
} from 'lucide-react';

/** Keys of `app.nav.*` in the message catalogs. */
export type NavLabelKey =
  | 'home'
  | 'accounts'
  | 'movements'
  | 'investments'
  | 'more'
  | 'categories'
  | 'reports'
  | 'cards'
  | 'recurring'
  | 'groups'
  | 'budgets'
  | 'goals'
  | 'settings'
  | 'notices'
  | 'profile'
  | 'security'
  | 'notificationSettings';

export interface NavItem {
  /** A route without the locale; the next-intl `Link` adds it. Never built from user input. */
  href: string;
  labelKey: NavLabelKey;
  icon: LucideIcon;
}

export const HOME_ITEM: NavItem = { href: '/', labelKey: 'home', icon: House };
export const ACCOUNTS_ITEM: NavItem = { href: '/accounts', labelKey: 'accounts', icon: Landmark };
export const MOVEMENTS_ITEM: NavItem = {
  href: '/movements',
  labelKey: 'movements',
  icon: ArrowLeftRight,
};
export const INVESTMENTS_ITEM: NavItem = {
  href: '/investments',
  labelKey: 'investments',
  icon: TrendingUp,
};
export const CARDS_ITEM: NavItem = { href: '/cards', labelKey: 'cards', icon: CreditCard };
export const GROUPS_ITEM: NavItem = { href: '/groups', labelKey: 'groups', icon: Users };
export const NOTICES_ITEM: NavItem = { href: '/notices', labelKey: 'notices', icon: Bell };
export const MORE_ITEM: NavItem = { href: '/more', labelKey: 'more', icon: Ellipsis };

/** The first block of the side menu, in the order of the design. */
export const PRIMARY_ITEMS: readonly NavItem[] = [
  HOME_ITEM,
  MOVEMENTS_ITEM,
  ACCOUNTS_ITEM,
  CARDS_ITEM,
  GROUPS_ITEM,
];

/** The "plan ahead" block of the side menu. */
export const PLAN_ITEMS: readonly NavItem[] = [
  { href: '/budgets', labelKey: 'budgets', icon: ChartPie },
  { href: '/goals', labelKey: 'goals', icon: Target },
  { href: '/recurring', labelKey: 'recurring', icon: Repeat },
  INVESTMENTS_ITEM,
  { href: '/categories', labelKey: 'categories', icon: Tags },
  { href: '/reports', labelKey: 'reports', icon: ChartLine },
];

/** The settings block: the profile page stands for "Settings", security is its sibling. */
export const SETTINGS_ITEMS: readonly NavItem[] = [
  { href: '/settings/profile', labelKey: 'settings', icon: SlidersHorizontal },
  { href: '/settings/security', labelKey: 'security', icon: ShieldCheck },
  { href: '/settings/notifications', labelKey: 'notificationSettings', icon: BellRing },
];

/** What the bottom bar has no room for, so the More page lists it. */
export const MORE_LIST_ITEMS: readonly NavItem[] = [
  ACCOUNTS_ITEM,
  CARDS_ITEM,
  ...PLAN_ITEMS,
  NOTICES_ITEM,
  ...SETTINGS_ITEMS,
];

export const ADD_MOVEMENT_HREF = '/movements/new';

/** The pages the bottom bar reaches directly: on a phone nothing sits "above" them to go back to. */
const BOTTOM_ROOTS: readonly string[] = ['/', '/movements', '/groups', '/more'];

/** Every page the side menu reaches directly. */
const MENU_ROOTS: readonly string[] = [
  ...PRIMARY_ITEMS,
  ...PLAN_ITEMS,
  ...SETTINGS_ITEMS,
  MORE_ITEM,
].map((item) => item.href);

/**
 * Where a back button is wanted: below the desk breakpoint on every page but the bottom bar's own,
 * and from it only on pages the side menu does not already list.
 */
export function backButtonVisibility(currentPath: string | undefined): {
  compact: boolean;
  desk: boolean;
} {
  if (currentPath === undefined) return { compact: false, desk: false };
  return {
    compact: !BOTTOM_ROOTS.includes(currentPath),
    desk: !MENU_ROOTS.includes(currentPath) && !currentPath.startsWith('/reports/'),
  };
}

/**
 * The bottom bar has no room for the destinations the More page lists, so on small screens "More"
 * stands for them: it is current on its own page and on every page it lists.
 */
export function isActiveInBottomNav(item: NavItem, currentPath: string | undefined): boolean {
  if (item.href !== MORE_ITEM.href) return isActivePath(item.href, currentPath);
  return [MORE_ITEM, ...MORE_LIST_ITEMS].some((entry) => isActivePath(entry.href, currentPath));
}

/** A destination is current on its own path and on the pages below it, never on a mere prefix. */
export function isActivePath(href: string, currentPath: string | undefined): boolean {
  if (currentPath === undefined) return false;
  if (href === '/') return currentPath === '/';
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

/** Keys of `app.topBar.parents.*`: the pages a back link can name besides the menu's own. */
export type ParentLabelKey = NavLabelKey | 'group' | 'card' | 'budget' | 'goal' | 'settlements';

export interface ParentRoute {
  /** A route without the locale, built only from the current path's own segments. */
  href: string;
  labelKey: ParentLabelKey;
}

/** The More page lists these, so it is where they go back to. */
const MORE_CHILDREN = new Set([
  'accounts',
  'cards',
  'budgets',
  'goals',
  'recurring',
  'investments',
  'categories',
  'reports',
  'notices',
  'settings',
]);

/** Sections whose detail pages (`/<section>/<id>[/…]`) are named by the singular label. */
const DETAIL_LABELS: Partial<Record<string, ParentLabelKey>> = {
  cards: 'card',
  budgets: 'budget',
  goals: 'goal',
  groups: 'group',
};

/**
 * The page above the current one, as NorteAR's "‹ Parent" link: a fixed place, not the browser
 * history, so it never leads out of the app or back into a form. None on the bottom bar's pages.
 */
export function parentRoute(currentPath: string | undefined): ParentRoute | undefined {
  if (currentPath === undefined || BOTTOM_ROOTS.includes(currentPath)) return undefined;
  const parts = currentPath.split('/').filter(Boolean);
  const [section, second, third] = parts;
  if (section === undefined) return undefined;
  const sectionLabel: ParentLabelKey =
    [GROUPS_ITEM, ...MORE_LIST_ITEMS].find((item) => item.href === `/${section}`)?.labelKey ??
    'more';

  if (parts.length === 1) {
    return MORE_CHILDREN.has(section)
      ? { href: '/more', labelKey: 'more' }
      : { href: '/', labelKey: 'home' };
  }
  // The reports tabs and the settings pages are listed by More themselves.
  if (section === 'reports' || section === 'settings') return { href: '/more', labelKey: 'more' };
  // `/categories/spending` is opened from the home ring.
  if (section === 'categories') return { href: '/', labelKey: 'home' };
  if (section === 'movements') return { href: '/movements', labelKey: 'movements' };

  const detail = DETAIL_LABELS[section];
  const isDetailId = second !== undefined && !['new', 'join', 'claim', 'shares'].includes(second);
  if (parts.length === 2 || !isDetailId || detail === undefined) {
    return { href: `/${section}`, labelKey: sectionLabel };
  }
  // Below a detail page: the settlement editor and the consolidation go back to the payments list.
  if (section === 'groups' && third === 'settlements' && parts.length > 3) {
    return { href: `/groups/${second}/settlements`, labelKey: 'settlements' };
  }
  return { href: `/${section}/${second}`, labelKey: detail };
}
