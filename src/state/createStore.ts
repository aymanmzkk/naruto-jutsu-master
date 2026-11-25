import { useRef, useSyncExternalStore } from 'react';

/**
 * Minimal external store (no dependencies). High-frequency systems (tracker,
 * microphone, 3D engine) write here; React components subscribe with a
 * selector so only the parts of the UI that changed re-render.
 */
export interface Store<T> {
  get: () => T;
  set: (partial: Partial<T> | ((s: T) => Partial<T>)) => void;
  subscribe: (fn: () => void) => () => void;
  reset: () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (partial) => {
      const patch = typeof partial === 'function' ? partial(state) : partial;
      let changed = false;
      for (const k in patch) {
        if (!Object.is((state as Record<string, unknown>)[k], (patch as Record<string, unknown>)[k])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    reset: () => {
      state = initial;
      listeners.forEach((l) => l());
    },
  };
}

export function useStore<T extends object, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

/** Like useStore, for selectors returning a fresh object: re-renders only when a field changes. */
export function useStoreShallow<T extends object, S extends Record<string, unknown>>(store: Store<T>, selector: (s: T) => S): S {
  const cache = useRef<S | null>(null);
  const get = () => {
    const next = selector(store.get());
    if (cache.current && shallowEqual(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  };
  return useSyncExternalStore(store.subscribe, get, get);
}
