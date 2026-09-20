import { act, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { useStoresHydrated, type PersistedStore } from '../hydration';

function fakeStore(initial: boolean) {
  let hydrated = initial;
  const listeners = new Set<() => void>();
  const store: PersistedStore = {
    persist: {
      hasHydrated: () => hydrated,
      onFinishHydration: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  return {
    store,
    finish() {
      hydrated = true;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}

function Probe({ stores }: { stores: readonly PersistedStore[] }) {
  return <Text testID="ready">{String(useStoresHydrated(stores))}</Text>;
}

describe('useStoresHydrated', () => {
  it('waits for every store and unsubscribes after unmount', async () => {
    const first = fakeStore(false);
    const second = fakeStore(false);
    const stores = [first.store, second.store] as const;
    const view = await render(<Probe stores={stores} />);

    expect(screen.getByTestId('ready').props.children).toBe('false');
    expect(first.listenerCount()).toBe(1);
    expect(second.listenerCount()).toBe(1);

    await act(async () => first.finish());
    expect(screen.getByTestId('ready').props.children).toBe('false');
    await act(async () => second.finish());
    expect(screen.getByTestId('ready').props.children).toBe('true');

    await act(async () => view.unmount());
    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBe(0);
  });

  it('is ready immediately when all stores already hydrated', async () => {
    const first = fakeStore(true);
    const second = fakeStore(true);
    await render(<Probe stores={[first.store, second.store]} />);
    expect(screen.getByTestId('ready').props.children).toBe('true');
    expect(first.listenerCount()).toBe(0);
  });
});
