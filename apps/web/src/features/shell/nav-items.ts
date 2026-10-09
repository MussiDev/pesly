import {
  ArrowLeftRight,
  CreditCard,
  Ellipsis,
  House,
  Landmark,
  Repeat,
  ShieldCheck,
  Tags,
  UserRound,
  Wallet,
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
  icon: Wallet,
};
export const MORE_ITEM: NavItem = { href: '/more', labelKey: 'more', icon: Ellipsis };

/** The main destinations of the top navigation; the bottom bar keeps three of them plus "More". */
export const PRIMARY_ITEMS: readonly NavItem[] = [
  HOME_ITEM,
  ACCOUNTS_ITEM,
  MOVEMENTS_ITEM,
  INVESTMENTS_ITEM,
];

/** What "More" holds on small screens and the top navigation shows directly. */
export const SECONDARY_ITEMS: readonly NavItem[] = [
  { href: '/categories', labelKey: 'categories', icon: Tags },
  { href: '/cards', labelKey: 'cards', icon: CreditCard },
  { href: '/recurring', labelKey: 'recurring', icon: Repeat },
  { href: '/settings/profile', labelKey: 'profile', icon: UserRound },
  { href: '/settings/security', labelKey: 'security', icon: ShieldCheck },
];

/** What the More page lists: Accounts has no room in the bottom bar, then the secondary ones. */
export const MORE_LIST_ITEMS: readonly NavItem[] = [ACCOUNTS_ITEM, ...SECONDARY_ITEMS];

export const ADD_MOVEMENT_HREF = '/movements/new';

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
