import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { expect, test } from "vitest";
import {
  createProviderCatalogAdapter,
  type ProviderCatalogDaemon,
} from "./daemon-adapter.js";
import type { ProviderSnapshotEntry } from "./ports.js";

const CODEX: ProviderSnapshotEntry = {
  provider: "codex",
  status: "ready",
  enabled: true,
};
class FakeDaemon implements ProviderCatalogDaemon {
  observers: ((message: SessionOutboundMessage) => void)[] = [];
  released = 0;
  releaseError: Error | null = null;
  refreshed = 0;
  async getProvidersSnapshot() {
    return { entries: [CODEX] };
  }
  async refreshProvidersSnapshot() {
    this.refreshed++;
    return { acknowledged: true };
  }
  observeEvents(events: ["providers_snapshot_update"]) {
    expect(events).toEqual(["providers_snapshot_update"]);
    return {
      subscribe: (observer: {
        snapshot(): void;
        update(message: SessionOutboundMessage): void;
      }) => {
        this.observers.push((message) => observer.update(message));
        return () => {};
      },
      release: async () => {
        this.released++;
        if (this.releaseError) throw this.releaseError;
      },
    };
  }
  push(message: SessionOutboundMessage) {
    for (const observer of this.observers) observer(message);
  }
}

test("reads and refreshes the global provider snapshot", async () => {
  const daemon = new FakeDaemon();
  const port = createProviderCatalogAdapter(daemon);
  expect(await port.snapshot()).toEqual([CODEX]);
  await port.refresh();
  expect(daemon.refreshed).toBe(1);
});

test("observes global snapshot updates only and awaits the release", async () => {
  const daemon = new FakeDaemon();
  const port = createProviderCatalogAdapter(daemon);
  const seen: (readonly ProviderSnapshotEntry[])[] = [];
  const stop = port.observe((entries) => seen.push(entries));
  daemon.push({
    type: "providers_snapshot_update",
    payload: { entries: [CODEX], generatedAt: "now" },
  });
  daemon.push({
    type: "providers_snapshot_update",
    payload: { entries: [], cwd: "/repo", generatedAt: "now" },
  });
  expect(seen).toEqual([[CODEX]]);
  await stop();
  expect(daemon.released).toBe(1);
});

test("a failed release still resolves the stop, so closing goes on", async () => {
  const daemon = new FakeDaemon();
  daemon.releaseError = Error("Transport closed");
  const stop = createProviderCatalogAdapter(daemon).observe(() => {});
  await expect(stop()).resolves.toBeUndefined();
  expect(daemon.released).toBe(1);
});
