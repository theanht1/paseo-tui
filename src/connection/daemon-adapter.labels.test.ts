import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { expect, test } from "vitest";
import {
  createWorkspaceLabelAdapter,
  type WorkspaceLabelDaemon,
} from "./daemon-adapter.js";
import type {
  WorkspaceLabelChange,
  WorkspaceLabelCursor,
  WorkspaceLabelList,
} from "./ports.js";

const LIST: WorkspaceLabelList = {
  requestId: "r1",
  labels: [{ name: "Bug", color: "red" }],
  sync: { mode: "snapshot", generation: "g1", headSeq: 3, removals: [] },
};
class FakeDaemon implements WorkspaceLabelDaemon {
  constructor(private features: { workspaceLabels?: boolean } = {}) {}
  syncs: (WorkspaceLabelCursor | undefined)[] = [];
  assignments: unknown[] = [];
  released = 0;
  releaseError: Error | null = null;
  observer: {
    snapshot(payload: WorkspaceLabelList): void;
    update(message: SessionOutboundMessage): void;
    error?(error: unknown): void;
  } | null = null;
  getLastServerInfoMessage() {
    return { features: this.features };
  }
  async listWorkspaceLabels(options?: { sync?: WorkspaceLabelCursor }) {
    this.syncs.push(options?.sync);
    return LIST;
  }
  observeWorkspaceLabels() {
    return {
      subscribe: (observer: NonNullable<FakeDaemon["observer"]>) => {
        this.observer = observer;
        return () => {
          this.observer = null;
        };
      },
      release: async () => {
        this.released++;
        if (this.releaseError) throw this.releaseError;
      },
    };
  }
  edits: unknown[] = [];
  async updateWorkspaceLabel(options: unknown) {
    this.edits.push(["update", options]);
    return {
      requestId: "r3",
      label: { name: "Defect", color: "red" as const },
      affectedWorkspaceCount: 2,
    };
  }
  async inspectWorkspaceLabelDelete(options: unknown) {
    this.edits.push(["inspect", options]);
    return { requestId: "r4", affectedWorkspaceCount: 3 };
  }
  async deleteWorkspaceLabel(options: unknown) {
    this.edits.push(["delete", options]);
    return { requestId: "r5", affectedWorkspaceCount: 3 };
  }
  async setWorkspaceLabel(options: unknown) {
    this.assignments.push(options);
    return {
      requestId: "r2",
      label: { name: "Bug", color: "red" as const },
      workspaceLabels: ["Bug"],
    };
  }
}

test("is null when the daemon lacks workspaceLabels", () => {
  expect(createWorkspaceLabelAdapter(new FakeDaemon())).toBeNull();
  expect(
    createWorkspaceLabelAdapter(new FakeDaemon({ workspaceLabels: false })),
  ).toBeNull();
});

test("lists with a sync cursor, assigns, and observes catalog changes only", async () => {
  const daemon = new FakeDaemon({ workspaceLabels: true });
  const port = createWorkspaceLabelAdapter(daemon);
  if (!port) throw Error("expected a port");
  expect(await port.list()).toBe(LIST);
  await port.list({ generation: "g1", afterSeq: 3 });
  expect(daemon.syncs).toEqual([undefined, { generation: "g1", afterSeq: 3 }]);
  expect(
    await port.setAssignment({
      workspaceId: "w1",
      label: { name: "Bug", color: "red" },
      assigned: true,
    }),
  ).toEqual(["Bug"]);
  expect(daemon.assignments).toEqual([
    { workspaceId: "w1", label: { name: "Bug", color: "red" }, assigned: true },
  ]);

  const lists: WorkspaceLabelList[] = [];
  const changes: WorkspaceLabelChange[] = [];
  const errors: unknown[] = [];
  const stop = port.observe({
    list: (payload) => lists.push(payload),
    change: (change) => changes.push(change),
    error: (error) => errors.push(error),
  });
  const change: WorkspaceLabelChange = {
    kind: "remove",
    name: "Bug",
    generation: "g1",
    seq: 4,
  };
  daemon.observer?.snapshot(LIST);
  daemon.observer?.update({ type: "workspace.label.update", payload: change });
  daemon.observer?.update({
    type: "providers_snapshot_update",
    payload: { entries: [], generatedAt: "now" },
  });
  daemon.observer?.error?.(Error("boom"));
  expect(lists).toEqual([LIST]);
  expect(changes).toEqual([change]);
  expect(errors).toEqual([Error("boom")]);
  await stop();
  expect(daemon.observer).toBeNull();
  expect(daemon.released).toBe(1);
});

test("a failed release still stops the observation, so closing goes on", async () => {
  const daemon = new FakeDaemon({ workspaceLabels: true });
  daemon.releaseError = Error("Transport closed");
  const port = createWorkspaceLabelAdapter(daemon);
  if (!port) throw Error("expected a port");
  const stop = port.observe({ list() {}, change() {}, error() {} });
  await expect(stop()).resolves.toBeUndefined();
  expect(daemon.observer).toBeNull();
  expect(daemon.released).toBe(1);
});

test("edits, inspects and deletes a label by name, sending only the changed fields", async () => {
  const daemon = new FakeDaemon({ workspaceLabels: true });
  const port = createWorkspaceLabelAdapter(daemon);
  if (!port) throw Error("expected a port");
  expect(await port.update({ name: "Bug", newName: "Defect" })).toEqual({
    name: "Defect",
    color: "red",
  });
  await port.update({ name: "Bug", color: "amber" });
  expect(await port.inspectDelete("Bug")).toBe(3);
  expect(await port.delete("Bug")).toBe(3);
  expect(daemon.edits).toEqual([
    ["update", { name: "Bug", newName: "Defect" }],
    ["update", { name: "Bug", color: "amber" }],
    ["inspect", { name: "Bug" }],
    ["delete", { name: "Bug" }],
  ]);
});
