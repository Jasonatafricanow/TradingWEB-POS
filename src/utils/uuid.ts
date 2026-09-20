import { sha256Hex } from './hash';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let uuidSequence = 0;

function uuidFromDigest(digest: string, version: 4 | 5): string {
  const bytes = digest.slice(0, 32).split('').map((value) => value.toLowerCase());
  bytes[12] = version.toString(16);
  bytes[16] = ((parseInt(bytes[16], 16) & 0x3) | 0x8).toString(16);
  const hex = bytes.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isRfc4122Uuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Deterministic RFC4122-compatible UUID for persisted legacy-record migration. */
export function stableUuidFromSeed(seed: string): string {
  return uuidFromDigest(sha256Hex(seed), 5);
}

/** Local UUID generated without depending on a native crypto provider. */
export function createLocalUuid(): string {
  uuidSequence += 1;
  return uuidFromDigest(sha256Hex(`${Date.now()}|${uuidSequence}|${Math.random()}`), 4);
}
