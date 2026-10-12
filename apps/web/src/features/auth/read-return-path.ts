import { safeReturnPath } from './return-path';

/** The report route the address asks to return to, when it is one of the allowed ones. */
export function readReturnPath(): string | undefined {
  return safeReturnPath(new URL(window.location.href).searchParams.get('next'));
}
