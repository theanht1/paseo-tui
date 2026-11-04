export function createEmitter() {
  const listeners = new Set<() => void>();
  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  function notify() {
    for (const listener of listeners) listener();
  }
  function clear() {
    listeners.clear();
  }
  return { subscribe, notify, clear };
}
