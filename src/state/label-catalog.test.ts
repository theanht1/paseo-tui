import { expect, test } from "vitest";
import type {
  WorkspaceLabelChange,
  WorkspaceLabelCursor,
  WorkspaceLabelDefinition,
  WorkspaceLabelEdit,
  WorkspaceLabelList,
  WorkspaceLabelObserver,
  WorkspaceLabelPort,
} from "../connection/ports.js";
import {
  createLabelCatalog,
  labelDefinitions,
  mergeLabelCatalogs,
  workspaceLabelsView,
} from "./label-catalog.js";

const BUG: WorkspaceLabelDefinition = { name: "Bug", color: "red" };
const UI: WorkspaceLabelDefinition = { name: "ui", color: "sky" };
function list(
  labels: WorkspaceLabelDefinition[],
  sync: Partial<WorkspaceLabelList["sync"]> = {},
): WorkspaceLabelList {
  return {
    requestId: "r",
    labels,
    sync: {
      mode: "snapshot",
      generation: "g1",
      headSeq: 0,
      removals: [],
      ...sync,
    },
  };
}
class FakeLabels implements WorkspaceLabelPort {
  observer: WorkspaceLabelObserver | null = null;
  syncs: (WorkspaceLabelCursor | undefined)[] = [];
  next: WorkspaceLabelList | Error = list([]);
  assignError: Error | null = null;
  assigned: unknown[] = [];
  async list(sync?: WorkspaceLabelCursor) {
    this.syncs.push(sync);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
  observe(observer: WorkspaceLabelObserver) {
    this.observer = observer;
    return async () => {
      this.observer = null;
    };
  }
  async setAssignment(input: {
    workspaceId: string;
    label: WorkspaceLabelDefinition;
    assigned: boolean;
  }) {
    this.assigned.push(input);
    if (this.assignError) throw this.assignError;
    return [input.label.name];
  }
  editError: Error | null = null;
  edits: string[] = [];
  async update(input: WorkspaceLabelEdit) {
    this.edits.push(`update ${JSON.stringify(input)}`);
    if (this.editError) throw this.editError;
    return { name: input.newName ?? input.name, color: input.color ?? "red" };
  }
  async inspectDelete(name: string) {
    this.edits.push(`inspect ${name}`);
    if (this.editError) throw this.editError;
    return 2;
  }
  async delete(name: string) {
    this.edits.push(`delete ${name}`);
    if (this.editError) throw this.editError;
    return 2;
  }
  snapshot(payload: WorkspaceLabelList) {
    this.observer?.list(payload);
  }
  change(change: WorkspaceLabelChange) {
    this.observer?.change(change);
  }
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function labels(catalog: ReturnType<typeof createLabelCatalog>) {
  const snapshot = catalog.getSnapshot();
  return snapshot.kind === "ready" ? snapshot.labels : snapshot.kind;
}

test("a snapshot replaces the catalog; a changes listing removes and upserts", () => {
  const port = new FakeLabels();
  const catalog = createLabelCatalog(port);
  let notified = 0;
  catalog.subscribe(() => notified++);
  expect(catalog.getSnapshot()).toEqual({ kind: "loading" });
  port.snapshot(list([BUG, UI], { headSeq: 2 }));
  expect(labels(catalog)).toEqual([BUG, UI]);
  port.snapshot(list([UI], { headSeq: 3 }));
  expect(labels(catalog)).toEqual([UI]);
  port.snapshot(
    list([{ name: "BUG", color: "amber" }], {
      mode: "changes",
      headSeq: 5,
      removals: [{ name: "UI", seq: 4 }],
    }),
  );
  expect(labels(catalog)).toEqual([{ name: "BUG", color: "amber" }]);
  expect(notified).toBe(3);
});

test("applies changes in sequence and renames through previousName", () => {
  const port = new FakeLabels();
  const catalog = createLabelCatalog(port);
  port.snapshot(list([BUG, UI], { headSeq: 2 }));
  port.change({
    kind: "upsert",
    label: { name: "Defect", color: "red" },
    previousName: "bug",
    generation: "g1",
    seq: 3,
  });
  port.change({ kind: "remove", name: "UI", generation: "g1", seq: 4 });
  expect(labels(catalog)).toEqual([{ name: "Defect", color: "red" }]);
  expect(port.syncs).toEqual([]);
});

test("a gap or another generation re-lists from the cursor", async () => {
  const port = new FakeLabels();
  const catalog = createLabelCatalog(port);
  port.snapshot(list([BUG], { headSeq: 2 }));
  port.next = list([UI], { mode: "changes", headSeq: 4 });
  port.change({ kind: "upsert", label: UI, generation: "g1", seq: 4 });
  expect(labels(catalog)).toEqual([BUG]);
  await flush();
  expect(port.syncs).toEqual([{ generation: "g1", afterSeq: 2 }]);
  expect(labels(catalog)).toEqual([BUG, UI]);
  port.next = list([UI], { generation: "g2", headSeq: 1 });
  port.change({ kind: "remove", name: "ui", generation: "g2", seq: 5 });
  await flush();
  expect(port.syncs.at(-1)).toEqual({ generation: "g1", afterSeq: 4 });
  expect(labels(catalog)).toEqual([UI]);
});

test("a failed assignment re-lists and rethrows; a failed re-list keeps the labels", async () => {
  const port = new FakeLabels();
  const catalog = createLabelCatalog(port);
  port.snapshot(list([BUG], { headSeq: 1 }));
  expect(
    await catalog.setAssignment({
      workspaceId: "w",
      label: BUG,
      assigned: true,
    }),
  ).toEqual(["Bug"]);
  expect(port.syncs).toEqual([]);
  port.assignError = Error("Label limit reached");
  port.next = Error("offline");
  await expect(
    catalog.setAssignment({ workspaceId: "w", label: UI, assigned: true }),
  ).rejects.toThrow("Label limit reached");
  expect(port.syncs).toEqual([{ generation: "g1", afterSeq: 1 }]);
  expect(catalog.getSnapshot()).toEqual({
    kind: "ready",
    labels: [BUG],
    error: "offline",
  });
  port.next = list([], { mode: "changes", headSeq: 1 });
  await catalog.load();
  expect(catalog.getSnapshot()).toEqual({
    kind: "ready",
    labels: [BUG],
    error: null,
  });
});

test("a subscription that fails before any listing reports the error", async () => {
  const port = new FakeLabels();
  const catalog = createLabelCatalog(port);
  port.observer?.error(Error("denied"));
  expect(catalog.getSnapshot()).toEqual({ kind: "failed", error: "denied" });
  await catalog.close();
  expect(port.observer).toBeNull();
});

test("merges catalogs: the target host first, then by host id, sorted by name", () => {
  expect(
    mergeLabelCatalogs(
      [
        { hostId: "b", labels: [{ name: "bug", color: "pink" }, UI] },
        { hostId: "a", labels: [{ name: "BUG", color: "amber" }] },
        { hostId: "c", labels: [{ name: "Alpha", color: "teal" }, BUG] },
      ],
      "c",
    ),
  ).toEqual([{ name: "Alpha", color: "teal" }, BUG, UI]);
  expect(
    mergeLabelCatalogs([
      { hostId: "b", labels: [{ name: "bug", color: "pink" }] },
      { hostId: "a", labels: [{ name: "BUG", color: "amber" }] },
    ]),
  ).toEqual([{ name: "BUG", color: "amber" }]);
});

test("resolves a workspace's names against its host's catalog, skipping unknown ones", () => {
  expect(labelDefinitions([BUG, UI], ["UI", "missing", "bug"])).toEqual([
    UI,
    BUG,
  ]);
  expect(labelDefinitions([BUG], undefined)).toEqual([]);
});

test("the view is authoritative only when every expected host is online and has listed cleanly", () => {
  const ready = (
    list: WorkspaceLabelDefinition[],
    error: string | null = null,
  ) => ({
    kind: "ready" as const,
    labels: list,
    error,
  });
  const view = (
    hosts: Parameters<typeof workspaceLabelsView>[0]["hosts"],
    expected = hosts.map((host) => host.id),
  ) =>
    workspaceLabelsView({
      hosts,
      expected,
      hostOf: (id) => id.split(":")[0] ?? null,
    });
  const both = view([
    { id: "a", label: "A", online: true, state: ready([BUG]) },
    { id: "b", label: "B", online: true, state: ready([UI]) },
    { id: "c", label: "C", online: false, state: { kind: "unsupported" } },
  ]);
  expect(both.authoritative).toBe(true);
  expect(both.merged(null)).toEqual([BUG, UI]);
  expect(both.merged("b:w1")).toEqual([BUG, UI]);
  expect(both.host("b:w1")).toEqual(ready([UI]));
  expect(both.host("c:w1")).toEqual({ kind: "unsupported" });
  expect(both.supported).toBe(true);
  expect(
    view([
      { id: "a", label: "A", online: true, state: ready([BUG]) },
      { id: "b", label: "B", online: false, state: ready([UI]) },
    ]).authoritative,
  ).toBe(false);
  expect(
    view(
      [{ id: "a", label: "A", online: true, state: ready([BUG]) }],
      ["a", "b"],
    ).authoritative,
  ).toBe(false);
  expect(
    view([
      { id: "a", label: "A", online: true, state: ready([BUG]) },
      { id: "b", label: "B", online: true, state: ready([UI], "timeout") },
    ]).authoritative,
  ).toBe(false);
  expect(
    view([
      { id: "a", label: "A", online: true, state: ready([BUG]) },
      { id: "b", label: "B", online: true, state: { kind: "loading" } },
    ]).authoritative,
  ).toBe(false);
  const none = view([
    { id: "a", label: "A", online: true, state: { kind: "unsupported" } },
  ]);
  expect(none.authoritative).toBe(false);
  expect(none.supported).toBe(false);
});

test("edits and deletes through the port, re-listing after a failure", async () => {
  const port = new FakeLabels();
  const catalog = createLabelCatalog(port);
  port.snapshot(list([BUG], { headSeq: 1 }));
  expect(await catalog.update({ name: "Bug", newName: "bug" })).toEqual({
    name: "bug",
    color: "red",
  });
  expect(await catalog.inspectDelete("Bug")).toBe(2);
  expect(await catalog.delete("Bug")).toBe(2);
  expect(port.syncs).toEqual([]);
  port.editError = Error("A label with that name already exists");
  port.next = list([], { mode: "changes", headSeq: 1 });
  await expect(catalog.update({ name: "Bug", newName: "UI" })).rejects.toThrow(
    "already exists",
  );
  await expect(catalog.delete("Bug")).rejects.toThrow("already exists");
  expect(port.syncs).toEqual([
    { generation: "g1", afterSeq: 1 },
    { generation: "g1", afterSeq: 1 },
  ]);
});
