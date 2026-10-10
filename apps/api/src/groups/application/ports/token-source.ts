export interface IssuedToken {
  /** Returned to the caller once; never stored. */
  raw: string;
  /** What the database keeps (SHA-256 hex). */
  hash: string;
}

export interface TokenSource {
  generate(): IssuedToken;
  /** Hash of a raw token received from a caller. */
  hash(raw: string): string;
}
