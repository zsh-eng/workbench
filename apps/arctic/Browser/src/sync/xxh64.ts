// XXH64 with seed 0, as the shared API names files: "xxh64:" and 16 hex digits.
// The server hashes every upload again and refuses a mismatch.
const P1 = 0x9e3779b185ebca87n;
const P2 = 0xc2b2ae3d27d4eb4fn;
const P3 = 0x165667b19e3779f9n;
const P4 = 0x85ebca77c2b2ae63n;
const P5 = 0x27d4eb2f165667c5n;
const MASK = 0xffffffffffffffffn;

const rotl = (x: bigint, r: bigint) => ((x << r) | (x >> (64n - r))) & MASK;
const round = (acc: bigint, input: bigint) =>
  (rotl((acc + input * P2) & MASK, 31n) * P1) & MASK;
const merge = (acc: bigint, value: bigint) =>
  ((acc ^ round(0n, value)) * P1 + P4) & MASK;

export function xxh64(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.byteLength;
  let offset = 0;
  let hash: bigint;
  if (length >= 32) {
    let v1 = (P1 + P2) & MASK;
    let v2 = P2;
    let v3 = 0n;
    let v4 = (MASK + 1n - P1) & MASK;
    for (; offset + 32 <= length; offset += 32) {
      v1 = round(v1, view.getBigUint64(offset, true));
      v2 = round(v2, view.getBigUint64(offset + 8, true));
      v3 = round(v3, view.getBigUint64(offset + 16, true));
      v4 = round(v4, view.getBigUint64(offset + 24, true));
    }
    hash = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & MASK;
    hash = merge(merge(merge(merge(hash, v1), v2), v3), v4);
  } else hash = P5;
  hash = (hash + BigInt(length)) & MASK;
  for (; offset + 8 <= length; offset += 8) {
    hash ^= round(0n, view.getBigUint64(offset, true));
    hash = (rotl(hash, 27n) * P1 + P4) & MASK;
  }
  if (offset + 4 <= length) {
    hash ^= (BigInt(view.getUint32(offset, true)) * P1) & MASK;
    hash = (rotl(hash, 23n) * P2 + P3) & MASK;
    offset += 4;
  }
  for (; offset < length; offset++) {
    hash ^= (BigInt(bytes[offset]!) * P5) & MASK;
    hash = (rotl(hash, 11n) * P1) & MASK;
  }
  hash ^= hash >> 33n;
  hash = (hash * P2) & MASK;
  hash ^= hash >> 29n;
  hash = (hash * P3) & MASK;
  hash ^= hash >> 32n;
  return `xxh64:${hash.toString(16).padStart(16, "0")}`;
}
