import { describe, expect, it } from 'vitest';
import {
  compareViolationCounts,
  scanSourceText,
  type LiteralViolation,
} from '../../../scripts/i18n-hardcoded';

describe('mobile hard-coded user-text scanner', () => {
  it('finds React Native text, accessibility labels, and alert copy but not logs', () => {
    const source = `
      export function Demo() {
        console.log('developer log');
        const item = { title: 'Menu item' };
        Alert.alert('Warning', 'Try again');
        return <Text
          accessibilityLabel="Checkout"
          accessibilityState={{ selected: true }}
          style={true ? "active" : "inactive"}
        >结账</Text>;
      }
    `;
    const violations = scanSourceText('app/demo.tsx', source);

    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'jsx-text', literal: '结账' }),
      expect.objectContaining({ category: 'visible-attribute', literal: 'Checkout' }),
      expect.objectContaining({ category: 'visible-attribute', literal: 'Menu item' }),
      expect.objectContaining({ category: 'alert', literal: 'Warning' }),
      expect.objectContaining({ category: 'alert', literal: 'Try again' }),
    ]));
    const literals = violations.map((violation) => violation.literal);
    expect(literals).not.toContain('developer log');
    expect(literals).not.toContain('active');
    expect(literals).not.toContain('inactive');
  });

  it('allows baseline removals and blocks new or duplicated violations', () => {
    const baseline: LiteralViolation[] = [
      { file: 'app/a.tsx', category: 'jsx-text', literal: 'Legacy' },
      { file: 'app/a.tsx', category: 'jsx-text', literal: 'Duplicate' },
    ];
    const current: LiteralViolation[] = [
      { file: 'app/a.tsx', category: 'jsx-text', literal: 'Duplicate' },
      { file: 'app/a.tsx', category: 'jsx-text', literal: 'Duplicate' },
      { file: 'app/b.tsx', category: 'alert', literal: 'New warning' },
    ];

    expect(compareViolationCounts(current, baseline)).toEqual([
      { file: 'app/a.tsx', category: 'jsx-text', literal: 'Duplicate', count: 1 },
      { file: 'app/b.tsx', category: 'alert', literal: 'New warning', count: 1 },
    ]);
  });

  it('follows const bindings and logical expressions at visible sinks', () => {
    const violations = scanSourceText(
      'app/demo.tsx',
      `const label = 'Checkout';
       const warning = 'New warning';
       export const Demo = () => <Text>{true && label}</Text>;
       Alert.alert(warning);`,
    );

    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'jsx-expression', literal: 'Checkout' }),
      expect.objectContaining({ category: 'alert', literal: 'New warning' }),
    ]));
  });

  it('resolves shadowed constants in lexical scope and scans description properties', () => {
    const violations = scanSourceText(
      'app/shadowed.tsx',
      `const label = 'Outer label';
       const item = { description: 'Delete this order?' };
       function Inner() {
         const label = 'Inner label';
         return <Text>{label}</Text>;
       }
       function Outer() { return <Text>{label}</Text>; }`,
    );
    const literals = violations.map(({ literal }) => literal);

    expect(literals).toEqual(expect.arrayContaining([
      'Outer label',
      'Inner label',
      'Delete this order?',
    ]));
  });
});
