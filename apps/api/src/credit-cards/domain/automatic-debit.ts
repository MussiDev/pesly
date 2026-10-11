import type { CreditCard, DebitLink, Statement } from './credit-card';
import type { Currency } from './statement-payment';

/** The local time of day from which a statement counts as due on its due date (PRD 10e FR-02). */
export const AUTOMATIC_DEBIT_DUE_TIME = '06:00';

const CURRENCIES: readonly Currency[] = ['ARS', 'USD'];

/** The key of a statement and currency inside one card's settled set. */
export function settledKey(period: string, currency: Currency): string {
  return `${period}|${currency}`;
}

const SHA256_K = Uint32Array.from(
  `428a2f98 71374491 b5c0fbcf e9b5dba5 3956c25b 59f111f1 923f82a4 ab1c5ed5
   d807aa98 12835b01 243185be 550c7dc3 72be5d74 80deb1fe 9bdc06a7 c19bf174
   e49b69c1 efbe4786 0fc19dc6 240ca1cc 2de92c6f 4a7484aa 5cb0a9dc 76f988da
   983e5152 a831c66d b00327c8 bf597fc7 c6e00bf3 d5a79147 06ca6351 14292967
   27b70a85 2e1b2138 4d2c6dfc 53380d13 650a7354 766a0abb 81c2c92e 92722c85
   a2bfe8a1 a81a664b c24b8b70 c76c51a3 d192e819 d6990624 f40e3585 106aa070
   19a4c116 1e376c08 2748774c 34b0bcb5 391c0cb3 4ed8aa4a 5b9cca4f 682e6ff3
   748f82ee 78a5636f 84c87814 8cc70208 90befffa a4506ceb bef9a3f7 c67178f2`
    .split(/\s+/)
    .map((word) => parseInt(word, 16)),
);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/**
 * SHA-256 of a UTF-8 string, in pure TypeScript because the domain may not import Node built-ins.
 * Only used to derive an id, never for secrets.
 */
function sha256(text: string): Uint8Array {
  const message = new TextEncoder().encode(text);
  const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((message.length * 8) / 0x100000000));
  view.setUint32(padded.length - 4, (message.length * 8) >>> 0);
  const h = Uint32Array.of(
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  );
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, hh = 0] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + choice + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((value, i) => {
      h[i] = ((h[i] ?? 0) + value) >>> 0;
    });
  }
  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  h.forEach((value, i) => {
    out.setUint32(i * 4, value);
  });
  return digest;
}

/**
 * The id of the transfer of one (card, period, currency): a SHA-256 of the key shaped as a UUID
 * (version nibble 8, variant 10), so a retry after a crash records the same movement (spec D2).
 */
export function automaticDebitMovementId(
  cardId: string,
  period: string,
  currency: Currency,
): string {
  const bytes = sha256(`pesly:automatic-debit:${cardId}:${period}:${currency}`).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export interface DebitCandidate {
  statement: Statement;
  currency: Currency;
  link: DebitLink;
}

/**
 * The (statement, currency) pairs to debit, oldest due date first: due on or before `lastDue`, on
 * or after the day that currency's debit account was linked, with a debit account and not settled
 * yet (spec D3).
 */
export function debitCandidates(input: {
  statements: readonly Statement[];
  debitAccounts: CreditCard['debitAccounts'];
  settled: ReadonlySet<string>;
  lastDue: string;
}): DebitCandidate[] {
  const ordered = [...input.statements].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.period.localeCompare(b.period),
  );
  const candidates: DebitCandidate[] = [];
  for (const statement of ordered) {
    for (const currency of CURRENCIES) {
      const link = input.debitAccounts[currency];
      if (!link) continue;
      if (statement.dueDate > input.lastDue || statement.dueDate < link.linkedOn) continue;
      if (input.settled.has(settledKey(statement.period, currency))) continue;
      candidates.push({ statement, currency, link });
    }
  }
  return candidates;
}

/** What is left to pay of a statement in one currency; never negative. */
export function unpaidRemainder(total: bigint, paid: bigint): bigint {
  return total > paid ? total - paid : 0n;
}
