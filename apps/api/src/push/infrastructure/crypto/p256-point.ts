import { createECDH } from 'node:crypto';

/** True when the user agent key is a point of the P-256 curve (the ECDH computation refuses others). */
export function isOnCurveP256dh(p256dh: string): boolean {
  const point = Buffer.from(p256dh, 'base64url');
  if (point.length !== 65 || point[0] !== 0x04) return false;
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    ecdh.computeSecret(point);
    return true;
  } catch {
    // Node throws for a point that is not on the curve: that is exactly the answer being asked.
    return false;
  }
}
