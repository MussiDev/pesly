/**
 * What an amount reads after one key of the on-screen keypad. `current` is the field's text as the
 * money input formatted it (thousands separators included); the money input reformats the result,
 * so only digits, one decimal separator and deletion are decided here.
 */
export function applyKey(current: string, key: string, decimal: string): string {
  const thousands = decimal === ',' ? '.' : ',';
  if (key === 'backspace') {
    let next = current.slice(0, -1);
    // A thousands separator alone at the end would be reformatted back: drop it with the digit.
    if (next.endsWith(thousands)) next = next.slice(0, -1);
    return next;
  }
  if (key === decimal) {
    if (current.includes(decimal)) return current;
    return `${current === '' ? '0' : current}${decimal}`;
  }
  return `${current}${key}`;
}

/** Writes `value` into `input` the way typing would, so the money input and the form hear it. */
export function writeLikeTyping(input: HTMLInputElement, value: string): void {
  // The prototype's setter, not `input.value =`: React tracks the instance's own value property.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- applied to `input` with Reflect.apply
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter !== undefined) Reflect.apply(setter, input, [value]);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.setSelectionRange(input.value.length, input.value.length);
}
