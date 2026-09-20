import AsyncStorage from '@react-native-async-storage/async-storage';
import { describe, expect, it, vi } from 'vitest';

describe('shared React Native test setup', () => {
  it('provides an in-memory AsyncStorage implementation', async () => {
    await AsyncStorage.setItem('operator', 'staff-1');

    expect(await AsyncStorage.getItem('operator')).toBe('staff-1');

    await AsyncStorage.removeItem('operator');
    expect(await AsyncStorage.getItem('operator')).toBeNull();
  });

  it('clears AsyncStorage state between tests', async () => {
    expect(await AsyncStorage.getItem('operator')).toBeNull();
  });

  it('provides a resettable fetch mock', () => {
    expect(globalThis.fetch).toBeTypeOf('function');
    expect(vi.isMockFunction(globalThis.fetch)).toBe(true);
  });
});
