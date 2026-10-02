/** The `YYYY-MM-DD` of an instant in an IANA zone; an unknown zone raises RangeError. */
export function localDateOf(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string): string => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined || value === '') {
      throw new Error(`Intl date formatting is missing the ${type} part for zone ${timeZone}`);
    }
    return value;
  };
  return `${part('year').padStart(4, '0')}-${part('month').padStart(2, '0')}-${part('day').padStart(2, '0')}`;
}

function isLeapYear(year: bigint): boolean {
  return (year % 4n === 0n && year % 100n !== 0n) || year % 400n === 0n;
}

function daysInMonth(year: bigint, month: bigint): bigint {
  if (month === 2n) return isLeapYear(year) ? 29n : 28n;
  return month === 4n || month === 6n || month === 9n || month === 11n ? 30n : 31n;
}

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day before a `YYYY-MM-DD` date; any other shape raises RangeError. */
export function previousDate(date: string): string {
  if (!DATE_TEXT.test(date)) {
    throw new RangeError(`previousDate expects a YYYY-MM-DD date, got ${JSON.stringify(date)}`);
  }
  const [yearText = '', monthText = '', dayText = ''] = date.split('-');
  let year = BigInt(yearText);
  let month = BigInt(monthText);
  let day = BigInt(dayText) - 1n;

  if (day === 0n) {
    month -= 1n;
    if (month === 0n) {
      month = 12n;
      year -= 1n;
    }
    day = daysInMonth(year, month);
  }

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}
