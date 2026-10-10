import {
  ArrowLeftRight,
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
  | 'cards'
  | 'recurring'
  | 'groups'
  | 'budgets'
  | 'goals'
  | 'settings'
  | 'profile'
  | 'security';

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
];

/** The settings block: the profile page stands for "Settings", security is its sibling. */
export const SETTINGS_ITEMS: readonly NavItem[] = [
  { href: '/settings/profile', labelKey: 'settings', icon: SlidersHorizontal },
  { href: '/settings/security', labelKey: 'security', icon: ShieldCheck },
];

/** What the bottom bar has no room for, so the More page lists it. */
export const MORE_LIST_ITEMS: readonly NavItem[] = [
  ACCOUNTS_ITEM,
  CARDS_ITEM,
  ...PLAN_ITEMS,
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
    desk: !MENU_ROOTS.includes(currentPath),
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
