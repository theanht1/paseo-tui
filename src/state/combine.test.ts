import { expect, it } from "vitest";
import { combineStores } from "./combine.js";
import { createEmitter } from "./emitter.js";

function value<T>(initial: T) {
  const emitter = createEmitter();
  let current = initial;
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => current,
    set(next: T) {
      current = next;
      emitter.notify();
    },
    listeners() {
      let count = 0;
      const stop = emitter.subscribe(() => count++);
      stop();
      return count;
    },
  };
}

it("combines every source's store, following sources as they come and go", () => {
  const a = value(1);
  const b = value(10);
  const sources = value<readonly { name: string; store: typeof a }[]>([
    { name: "a", store: a },
  ]);
  let merges = 0;
  const combined = combineStores({
    sources,
    store: (source) => source.store,
    merge(values) {
      merges++;
      return values.map(({ source, value: n }) => `${source.name}=${n}`);
    },
  });
  let changes = 0;
  const stop = combined.subscribe(() => changes++);
  expect(combined.getSnapshot()).toEqual(["a=1"]);
  expect(combined.getSnapshot()).toBe(combined.getSnapshot());
  expect(merges).toBe(1);
  a.set(2);
  expect(changes).toBe(1);
  expect(combined.getSnapshot()).toEqual(["a=2"]);
  sources.set([
    { name: "a", store: a },
    { name: "b", store: b },
  ]);
  expect(combined.getSnapshot()).toEqual(["a=2", "b=10"]);
  b.set(11);
  expect(combined.getSnapshot()).toEqual(["a=2", "b=11"]);
  expect(changes).toBe(3);
  sources.set([{ name: "b", store: b }]);
  a.set(3);
  expect(changes).toBe(4);
  expect(combined.getSnapshot()).toEqual(["b=11"]);
  stop();
  b.set(12);
  expect(changes).toBe(4);
});
