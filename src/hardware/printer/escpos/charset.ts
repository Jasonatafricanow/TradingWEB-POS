// 文本编码与列宽工具。
// 热敏小票机打中文需 GBK（iconv-lite，纯 JS）；新机型 UTF-8 模式可切换。
// CJK 字符按 2 列计宽，保证左右对齐的行在 58/80mm 纸上不错位。

export { utf8Encode } from '../encoders/utf8';
export { padEndVisual, visualWidth, wrapVisual } from '../text-layout';

/** Uint8Array -> base64（BLE 写特征值用），不依赖 Buffer/btoa */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}
