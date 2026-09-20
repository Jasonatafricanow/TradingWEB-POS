// SHA-256（纯 TS，无依赖）。用途：员工 PIN 只以哈希落盘，不存明文。

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function utf8Bytes(str: string): number[] {
  const out: number[] = [];
  for (const ch of str) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256Bytes(bytes: number[]): string {
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push((bitLen / 2 ** (i * 8)) & 0xff);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array<number>(64);

  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

export function sha256Hex(message: string): string {
  return sha256Bytes(utf8Bytes(message));
}

export function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** HMAC-SHA256（key 为 hex 编码）；用于带密钥的完整性指纹。 */
export function hmacSha256Hex(keyHex: string, message: string): string {
  const blockSize = 64;
  let key = hexToBytes(keyHex);
  if (key.length > blockSize) key = hexToBytes(sha256Bytes(key));
  const padded = new Array(blockSize).fill(0);
  padded.splice(0, key.length, ...key);
  const inner = sha256Bytes([...padded.map((b) => b ^ 0x36), ...utf8Bytes(message)]);
  return sha256Bytes([...padded.map((b) => b ^ 0x5c), ...hexToBytes(inner)]);
}

// ---- 员工 PIN 加盐哈希（验收审计 P2 加固）----
// 落盘格式自描述：`sha256$<迭代次数>$<盐hex>$<摘要hex>`，便于日后调参且保持可验证。
// 安全说明：PIN 仅 4–6 位、键空间很小；加盐的首要价值是消除彩虹表预计算与"相同 PIN 同哈希"的等值泄露。
//   迭代是纯 JS 主线程可承受范围内的纵深防御——对如此小的键空间无法抵挡专用离线爆破，
//   因此真正的兜底仍是：持久化的连错锁定（在线爆破）、以及不泄露落盘存储。切勿据此声称"离线不可破"。
export const PIN_ITERATIONS = 1000;

let randCounter = 0;
function randHex(bytes: number): string {
  const g = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  const buf = new Uint8Array(bytes);
  if (g && typeof g.getRandomValues === 'function') {
    g.getRandomValues(buf);
  } else {
    // 无 CSPRNG 时兜底：盐无需保密，仅需唯一；混入时间/计数/Math.random 降低碰撞。
    let seed = (Date.now() ^ (randCounter++ << 16)) >>> 0;
    for (let i = 0; i < bytes; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      buf[i] = (seed ^ Math.floor(Math.random() * 256)) & 0xff;
    }
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 迭代加盐摘要（简易 PBKDF：每轮并入盐与 PIN，避免熵坍缩）。 */
function pinDigest(pin: string, salt: string, iterations: number): string {
  let h = sha256Hex(salt + pin);
  for (let i = 1; i < iterations; i++) h = sha256Hex(h + salt + pin);
  return h;
}

/** 定长比较，避免早退短路带来的时序侧信道（JS 无法完全恒定，仅尽力）。 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 生成落盘用的加盐 PIN 哈希串（含盐与迭代次数）。 */
export function hashPin(pin: string, salt: string = randHex(8), iterations: number = PIN_ITERATIONS): string {
  return `sha256$${iterations}$${salt}$${pinDigest(pin, salt, iterations)}`;
}

/**
 * 校验 PIN 是否匹配落盘哈希，兼容两种格式：
 *  - 新：`sha256$<iter>$<salt>$<digest>`（iter 与当前 PIN_ITERATIONS 不一致时 needsUpgrade=true，便于日后加大成本时自动重拉伸）
 *  - 旧（遗留）：裸 64 位 hex（无盐单次 SHA-256）——匹配成功时 needsUpgrade=true，调用方应就地升级为加盐格式。
 */
export function verifyPinHash(
  pin: string,
  stored: string | null | undefined
): { ok: boolean; needsUpgrade: boolean } {
  if (!stored) return { ok: false, needsUpgrade: false };
  if (stored.includes('$')) {
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'sha256') return { ok: false, needsUpgrade: false };
    const iterations = parseInt(parts[1], 10);
    const [, , salt, digest] = parts;
    if (!Number.isFinite(iterations) || iterations < 1) return { ok: false, needsUpgrade: false };
    const ok = timingSafeEqualHex(pinDigest(pin, salt, iterations), digest);
    return { ok, needsUpgrade: ok && iterations !== PIN_ITERATIONS };
  }
  // 遗留裸哈希：无盐单次 SHA-256
  const ok = timingSafeEqualHex(sha256Hex(pin), stored);
  return { ok, needsUpgrade: ok };
}
