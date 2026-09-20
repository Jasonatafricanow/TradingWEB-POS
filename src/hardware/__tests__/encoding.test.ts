import { describe, expect, it } from 'vitest';
import { encodeGbk } from '../printer/encoders/gbk';
import { utf8Encode } from '../printer/encoders/utf8';

describe('printer encoders', () => {
  it('encodes ASCII as UTF-8 bytes', () => {
    expect(Array.from(utf8Encode('A'))).toEqual([65]);
  });

  it('encodes Chinese text as GBK bytes', () => {
    expect(Array.from(encodeGbk('中文'))).toEqual([0xd6, 0xd0, 0xce, 0xc4]);
  });
});
