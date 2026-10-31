const NBSP = ' ';

/**
 * A formatted amount ("1.800.000,00 ARS") for narrow places such as KPI cards. The non-breaking
 * space before the currency code becomes a plain space, so a short line wraps there and moves the
 * code down, instead of `break-words` cutting through the number or the code (FEAT UX audit #2).
 */
export function wrappableMoney(text: string): string {
  const at = text.lastIndexOf(NBSP);
  return at === -1 ? text : `${text.slice(0, at)} ${text.slice(at + 1)}`;
}

export function MoneyText({ text }: { text: string }) {
  return <>{wrappableMoney(text)}</>;
}
