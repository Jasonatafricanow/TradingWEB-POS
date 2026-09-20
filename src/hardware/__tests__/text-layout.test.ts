import { describe, expect, it } from 'vitest';
import { padEndVisual, visualWidth, wrapVisual } from '../printer/text-layout';

describe('printer text layout', () => {
  it('counts CJK characters as two columns', () => {
    expect(visualWidth('中文A')).toBe(5);
  });

  it('wraps text by visual width', () => {
    expect(wrapVisual('中文AB', 4)).toEqual(['中文', 'AB']);
  });

  it('pads using visual columns', () => {
    expect(padEndVisual('中A', 5)).toBe('中A  ');
  });
});
