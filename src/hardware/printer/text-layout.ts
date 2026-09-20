function isWide(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
  );
}

export function visualWidth(s: string): number {
  let width = 0;
  for (const ch of s) width += isWide(ch) ? 2 : 1;
  return width;
}

export function padEndVisual(s: string, width: number): string {
  const currentWidth = visualWidth(s);
  return currentWidth >= width ? s : s + ' '.repeat(width - currentWidth);
}

export function wrapVisual(s: string, width: number): string[] {
  const output: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const ch of s) {
    const charWidth = isWide(ch) ? 2 : 1;
    if (currentWidth + charWidth > width && current) {
      output.push(current);
      current = ch;
      currentWidth = charWidth;
    } else {
      current += ch;
      currentWidth += charWidth;
    }
  }
  if (current) output.push(current);
  return output.length ? output : [''];
}
