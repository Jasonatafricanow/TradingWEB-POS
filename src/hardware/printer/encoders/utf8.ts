export function utf8Encode(str: string): Uint8Array {
  const output: number[] = [];
  for (const ch of str) {
    const codePoint = ch.codePointAt(0)!;
    if (codePoint < 0x80) output.push(codePoint);
    else if (codePoint < 0x800) {
      output.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      output.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      output.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(output);
}
