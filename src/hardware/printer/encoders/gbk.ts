import { utf8Encode } from './utf8';

export function encodeGbk(text: string): Uint8Array {
  try {
    const iconv = require('iconv-lite');
    return Uint8Array.from(iconv.encode(text, 'gbk') as Uint8Array);
  } catch {
    return utf8Encode(text);
  }
}
