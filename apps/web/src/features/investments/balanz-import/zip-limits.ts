import { BalanzParseError } from './balanz-types';

export const BALANZ_UNCOMPRESSED_MAX_BYTES = 10 * 1024 * 1024;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_ENTRY = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const END_OF_DIRECTORY_SIZE = 22;
const MAX_COMMENT = 0xffff;
const ZIP64_MARKER = 0xffffffff;

function endOfDirectory(view: DataView): number {
  const last = view.byteLength - END_OF_DIRECTORY_SIZE;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let at = last; at >= first; at -= 1) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) return at;
  }
  return -1;
}

/**
 * An `.xlsx` is a zip. Reads only its directory, never the compressed data, and rejects a file
 * that is not a zip or whose entries declare more than 10 MB uncompressed in total, before any
 * library decompresses it. A header that lies about its sizes is not caught here; the effect is
 * limited to the user's own tab (threat R-01).
 */
export function assertZipWithinLimits(buffer: ArrayBuffer): void {
  const notExcel = () => new BalanzParseError('notExcel');
  const view = new DataView(buffer);
  if (view.byteLength < END_OF_DIRECTORY_SIZE + 4 || view.getUint32(0, true) !== LOCAL_HEADER) {
    throw notExcel();
  }
  const end = endOfDirectory(view);
  if (end < 0) throw notExcel();

  const entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryStart = view.getUint32(end + 16, true);
  if (directoryStart + directorySize > view.byteLength) throw notExcel();

  let total = 0;
  let at = directoryStart;
  for (let entry = 0; entry < entries; entry += 1) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL_ENTRY) throw notExcel();
    const size = view.getUint32(at + 24, true);
    if (size === ZIP64_MARKER) throw new BalanzParseError('tooLarge');
    total += size;
    if (total > BALANZ_UNCOMPRESSED_MAX_BYTES) throw new BalanzParseError('tooLarge');
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
}
