import { render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { Text } from 'react-native';

describe('React Native test renderer', () => {
  it('renders a native component through the shared harness', async () => {
    await render(<Text>POS ready</Text>);

    expect(screen.getByText('POS ready')).toBeTruthy();
  });

  it('provides native storage and network mocks', async () => {
    await AsyncStorage.setItem('operator', 'staff-1');

    expect(await AsyncStorage.getItem('operator')).toBe('staff-1');
    expect(jest.isMockFunction(globalThis.fetch)).toBe(true);
  });

  it('clears native storage between tests', async () => {
    expect(await AsyncStorage.getItem('operator')).toBeNull();
  });
});
