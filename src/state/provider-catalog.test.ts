import { expect, test } from "vitest";
import type {
  ProviderCatalogPort,
  ProviderSnapshotEntry,
} from "../connection/ports.js";
import { at } from "../test/at.js";
import { createProviderCatalog } from "./provider-catalog.js";

type ProviderEntry = ProviderSnapshotEntry;
function entry(
  provider: string,
  status: ProviderEntry["status"] = "ready",
): ProviderEntry {
  return { provider, status, enabled: true, label: provider };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
class FakeProviders implements ProviderCatalogPort {
  snapshots: ReturnType<typeof deferred<readonly ProviderEntry[]>>[] = [];
  handlers = new Set<(entries: readonly ProviderEntry[]) => void>();
  refreshes = 0;
  snapshot() {
    const next = deferred<readonly ProviderEntry[]>();
    this.snapshots.push(next);
    return next.promise;
  }
  observe(handler: (entries: readonly ProviderEntry[]) => void) {
    this.handlers.add(handler);
    return async () => {
      this.handlers.delete(handler);
    };
  }
  async refresh() {
    this.refreshes++;
  }
  answer(index: number, entries: ProviderEntry[]) {
    at(this.snapshots, index).resolve(entries);
  }
  push(entries: ProviderEntry[]) {
    for (const handler of this.handlers) handler(entries);
  }
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("loads the snapshot once at start and notifies when it is ready", async () => {
  const api = new FakeProviders();
  const catalog = createProviderCatalog(api);
  let notified = 0;
  catalog.subscribe(() => notified++);
  expect(catalog.getSnapshot()).toEqual({ kind: "loading" });
  expect(api.snapshots).toHaveLength(1);
  api.answer(0, [entry("codex")]);
  await flush();
  expect(catalog.getSnapshot()).toEqual({
    kind: "ready",
    entries: [entry("codex")],
  });
  expect(notified).toBe(1);
  expect(await catalog.entries()).toEqual([entry("codex")]);
  expect(api.snapshots).toHaveLength(1);
  await catalog.close();
});

test("entries() waits for the first load", async () => {
  const api = new FakeProviders();
  const catalog = createProviderCatalog(api);
  let listed: readonly ProviderEntry[] | null = null;
  void catalog.entries().then((entries) => {
    listed = entries;
  });
  await flush();
  expect(listed).toBeNull();
  api.answer(0, [entry("claude")]);
  await flush();
  expect(listed).toEqual([entry("claude")]);
  await catalog.close();
});

test("applies pushed updates", async () => {
  const api = new FakeProviders();
  const catalog = createProviderCatalog(api);
  api.answer(0, [entry("codex", "loading")]);
  await flush();
  api.push([entry("codex")]);
  expect(catalog.getSnapshot()).toEqual({
    kind: "ready",
    entries: [entry("codex")],
  });
  await catalog.close();
});

test("an update that arrives during the load wins over the older response", async () => {
  const api = new FakeProviders();
  const catalog = createProviderCatalog(api);
  api.push([entry("codex")]);
  api.answer(0, [entry("codex", "loading")]);
  await flush();
  expect(catalog.getSnapshot()).toEqual({
    kind: "ready",
    entries: [entry("codex")],
  });
  await catalog.close();
});

test("keeps an unchanged provider's entry object across updates", async () => {
  const api = new FakeProviders();
  const catalog = createProviderCatalog(api);
  api.answer(0, [entry("codex"), entry("claude", "loading")]);
  const [codex] = await catalog.entries();
  api.push([entry("codex"), entry("claude")]);
  const [next, claude] = await catalog.entries();
  expect(next).toBe(codex);
  expect(claude).toEqual(entry("claude"));
  await catalog.close();
});

test("a failed load is an error that the next entries() call retries", async () => {
  const api = new FakeProviders();
  const catalog = createProviderCatalog(api);
  at(api.snapshots, 0).reject(new Error("offline"));
  await flush();
  expect(catalog.getSnapshot()).toEqual({ kind: "error", message: "offline" });
  const listed = catalog.entries();
  expect(api.snapshots).toHaveLength(2);
  api.answer(1, [entry("codex")]);
  expect(await listed).toEqual([entry("codex")]);
  await catalog.close();
});

test("entries() rejects with the load error", async () => {
  const api = new FakeProviders();
  const catalog = createProviderCatalog(api);
  at(api.snapshots, 0).reject(new Error("offline"));
  await flush();
  const listed = catalog.entries();
  at(api.snapshots, 1).reject(new Error("still offline"));
  await expect(listed).rejects.toThrow("still offline");
  await catalog.close();
});

test("load() refetches, e.g. after a reconnect", async () => {
  const api = new FakeProviders();
  const catalog = createProviderCatalog(api);
  api.answer(0, [entry("codex")]);
  await flush();
  const reload = catalog.load();
  api.answer(1, [entry("codex"), entry("claude")]);
  await reload;
  expect(await catalog.entries()).toEqual([entry("codex"), entry("claude")]);
  await catalog.close();
});

test("refresh() asks the daemon to rediscover providers", async () => {
  const api = new FakeProviders();
  const catalog = createProviderCatalog(api);
  await catalog.refresh();
  expect(api.refreshes).toBe(1);
  await catalog.close();
});

test("close() stops listening for updates and waits for the release", async () => {
  const api = new FakeProviders();
  const catalog = createProviderCatalog(api);
  expect(api.handlers.size).toBe(1);
  await catalog.close();
  expect(api.handlers.size).toBe(0);
});
