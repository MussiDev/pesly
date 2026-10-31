/**
 * The zones for the time zone select: the runtime's IANA list plus the saved value, which can be
 * one the runtime does not list (a zone stored as the device reported it at registration), so the
 * select always shows what is saved.
 */
export function timeZoneOptions(saved: string): string[] {
  // Older engines lack `supportedValuesOf`; the saved value alone keeps the form usable.
  const listed =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set([...listed, saved])].sort();
}

/**
 * The zones to offer first, above the full list: the saved one and the device's own, so most
 * people never scroll through hundreds of zones (Hick's law). Unknown or empty values are dropped.
 */
export function suggestedTimeZones(saved: string, device: string | undefined): string[] {
  return [...new Set([saved, device ?? ''])].filter((zone) => zone !== '');
}

/** The device's IANA zone, or `undefined` where the runtime does not report one. */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
