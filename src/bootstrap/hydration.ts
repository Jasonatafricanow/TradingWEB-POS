import { useCallback, useEffect, useState } from 'react';

export interface PersistedStore {
  persist: {
    hasHydrated(): boolean;
    onFinishHydration(listener: () => void): () => void;
  };
}

export function useStoresHydrated(stores: readonly PersistedStore[]): boolean {
  const allReady = useCallback(
    () => stores.every((store) => store.persist.hasHydrated()),
    [stores],
  );
  const [ready, setReady] = useState(allReady);

  useEffect(() => {
    if (allReady()) {
      setReady(true);
      return;
    }
    const unsubscribers = stores.map((store) => store.persist.onFinishHydration(() => {
      if (allReady()) setReady(true);
    }));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [allReady, stores]);

  return ready;
}
