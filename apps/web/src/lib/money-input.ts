const MAX_INTEGER_DIGITS = 15;
const MAX_FRACTION_DIGITS = 2;

export interface MoneyInputOptions {
  locale: string;
  allowNegative?: boolean;
}

export interface MoneyInputResult {
  text: string;
  caret: number;
}

interface Separators {
  group: string;
  decimal: string;
}

export function separatorsOf(locale: string): Separators {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.8);
  return {
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
}

function groupDigits(digits: string, group: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, group);
}

/**
 * Re-formats what the user typed as a localized amount while they type: thousands separators are
 * inserted by the field, so "3000" shows as "3.000" (es) or "3,000" (en) and only the decimal
 * separator is typed. The other separator is never kept, so typing or pasting "1.500,00" in
 * Spanish gives the same result as typing "1500,00". The caret stays after the same significant
 * character, so editing in the middle does not jump to the end. The result is still plain text for
 * `parseAmountInput`; this never produces a number.
 */
export function formatMoneyInput(
  raw: string,
  caretPosition: number,
  { locale, allowNegative = false }: MoneyInputOptions,
): MoneyInputResult {
  const { group, decimal } = separatorsOf(locale);
  let negative = false;
  let integer = '';
  let fraction = '';
  let hasDecimal = false;
  // Significant characters (digits, the decimal mark, the sign) seen before the caret.
  let significantBeforeCaret = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    const beforeCaret = index < caretPosition;
    let counted = false;
    if (char === '-' && allowNegative && index === 0) {
      negative = true;
      counted = true;
    } else if (/\d/.test(char)) {
      if (hasDecimal) {
        if (fraction.length < MAX_FRACTION_DIGITS) {
          fraction += char;
          counted = true;
        }
      } else if (integer.length < MAX_INTEGER_DIGITS) {
        integer += char;
        counted = true;
      }
    } else if (!hasDecimal && char === decimal) {
      hasDecimal = true;
      counted = true;
    }
    if (counted && beforeCaret) significantBeforeCaret += 1;
  }

  integer = integer.replace(/^0+(?=\d)/, '');
  if (hasDecimal && integer === '') integer = '0';
  if (integer === '' && !hasDecimal) {
    return { text: negative ? '-' : '', caret: negative ? 1 : 0 };
  }

  const text = `${negative ? '-' : ''}${groupDigits(integer, group)}${hasDecimal ? decimal : ''}${fraction}`;

  // Where the caret goes: right after the same count of significant characters as before. A "0"
  // added in front of a lone decimal mark counts as one more.
  const added = hasDecimal && raw.replace(/\D/g, '') === '' ? 1 : 0;
  const target =
    significantBeforeCaret + (significantBeforeCaret > 0 || caretPosition > 0 ? added : 0);
  let seen = 0;
  let caret = target === 0 ? 0 : text.length;
  if (target > 0) {
    for (let index = 0; index < text.length; index += 1) {
      const char = text.charAt(index);
      if (char !== group) seen += 1;
      if (seen === target) {
        caret = index + 1;
        break;
      }
    }
  }
  return { text, caret };
}

/** Drops a trailing decimal mark ("3," or "3.") so what is left parses as a whole amount. */
export function trimTrailingDecimal(text: string, locale: string): string {
  const { decimal } = separatorsOf(locale);
  return text.endsWith(decimal) ? text.slice(0, -decimal.length) : text;
}
