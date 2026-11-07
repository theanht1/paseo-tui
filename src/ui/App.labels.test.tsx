import { expect, it } from "vitest";
import type {
  WorkspaceLabelCursor,
  WorkspaceLabelDefinition,
  WorkspaceLabelEdit,
  WorkspaceLabelList,
  WorkspaceLabelObserver,
  WorkspaceLabelPort,
} from "../connection/ports.js";
import {
  createLabelCatalog,
  type LabelCatalog,
  type LabelCatalogSnapshot,
  type WorkspaceLabels,
  type WorkspaceLabelsSnapshot,
  workspaceLabelsView,
} from "../state/label-catalog.js";
import { rowText, settle, setup } from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";
import { sessionLabelFilterMemory } from "./layout/label-filter-memory.js";

class FakeLabelPort implements WorkspaceLabelPort {
  observer: WorkspaceLabelObserver | null = null;
  assigned: string[] = [];
  async list(_sync?: WorkspaceLabelCursor): Promise<WorkspaceLabelList> {
    throw Error("unexpected list");
  }
  observe(observer: WorkspaceLabelObserver) {
    this.observer = observer;
    return async () => {};
  }
  async setAssignment(input: {
    workspaceId: string;
    label: WorkspaceLabelDefinition;
    assigned: boolean;
  }) {
    this.assigned.push(
      `${input.workspaceId} ${input.assigned ? "+" : "-"}${input.label.name} ${input.label.color}`,
    );
    return [];
  }
  async update(input: WorkspaceLabelEdit) {
    this.assigned.push(`update ${JSON.stringify(input)}`);
    return { name: input.newName ?? input.name, color: input.color ?? "red" };
  }
  deleteCount = 0;
  deleted: string[] = [];
  async inspectDelete() {
    return this.deleteCount;
  }
  async delete(name: string) {
    this.deleted.push(name);
    return this.deleteCount;
  }
}
/** One host's catalog as the window's label store. */
function oneHost(catalog: LabelCatalog): WorkspaceLabels {
  let cached: {
    state: LabelCatalogSnapshot;
    view: WorkspaceLabelsSnapshot;
  } | null = null;
  return {
    subscribe: catalog.subscribe,
    getSnapshot() {
      const state = catalog.getSnapshot();
      if (cached?.state !== state)
        cached = {
          state,
          view: workspaceLabelsView({
            hosts: [{ id: "h", label: "local", online: true, state }],
            expected: ["h"],
            hostOf: () => "h",
          }),
        };
      return cached.view;
    },
    setAssignment: (input) => catalog.setAssignment(input),
    update: (_host, input) => catalog.update(input),
    inspectDelete: (_host, name) => catalog.inspectDelete(name),
    delete: (_host, name) => catalog.delete(name),
    reload: () => catalog.load(),
  };
}
const workspaces = [
  agent("alpha", {
    title: "alpha agent",
    cwd: "/repo/one",
    workspaceId: "one",
  }),
  agent("beta", { title: "beta agent", cwd: "/repo/two", workspaceId: "two" }),
];
async function labelled(initialFilter: readonly string[] = []) {
  const port = new FakeLabelPort();
  const catalog = createLabelCatalog(port);
  port.observer?.list({
    requestId: "r",
    labels: [
      { name: "Bug", color: "red" },
      { name: "UI", color: "sky" },
    ],
    sync: { mode: "snapshot", generation: "g", headSeq: 1, removals: [] },
  });
  const filter = sessionLabelFilterMemory();
  filter.set(initialFilter);
  const result = await setup(
    workspaces,
    24,
    true,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { labels: oneHost(catalog), labelFilter: filter },
  );
  result.updateWorkspace("one", { labels: ["Bug", "unknown"] });
  await settle();
  return { ...result, port, filter };
}
async function press(
  app: { stdin: { write(input: string): void } },
  keys: string[],
) {
  for (const key of keys) {
    app.stdin.write(key);
    await settle();
  }
}

it("shows a workspace's labels at the end of its row, skipping unknown names", async () => {
  const { test } = await labelled();
  const row = rowText(test, "workspace:one");
  expect(row).toContain("●Bug");
  expect(row).not.toContain("unknown");
  expect(rowText(test, "workspace:two")).not.toContain("●");
});

it("L toggles labels in a list that stays open, and New label… picks a color", async () => {
  const { app, port } = await labelled();
  await press(app, ["L"]);
  expect(app.lastFrame()).toContain("Labels");
  expect(app.lastFrame()).toContain("✓ Bug");
  await press(app, ["\r"]);
  await press(app, ["\u001b[B", "\r"]);
  expect(port.assigned).toEqual(["one -Bug red", "one +UI sky"]);
  expect(app.lastFrame()).toContain("New label…");
  await press(app, ["\u001b[B", "\r", "Blocked", "\r", "\r"]);
  expect(port.assigned.at(-1)).toBe("one +Blocked violet");
  expect(app.lastFrame()).not.toContain("New label…");
});

it("filters the sidebar by label from the Command Center and notes it in the status bar", async () => {
  const { app, test, filter } = await labelled();
  await press(app, [":", "filter by label", "\r"]);
  expect(app.lastFrame()).toContain("Unlabelled");
  await press(app, ["\u001b[B", "\r"]);
  expect(filter.getSnapshot()).toEqual(["bug"]);
  await press(app, ["\u001b"]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  expect(test.renderer.root.findDescendantById("workspace:two")).toBeFalsy();
  expect(rowText(test, "workspace:one")).toContain("●Bug");
  expect(app.lastFrame()).toContain("filter: Bug");
});

it("drops filter keys of deleted labels once the catalog is listed", async () => {
  const { filter, test } = await labelled(["gone", "bug"]);
  expect(filter.getSnapshot()).toEqual(["bug"]);
  expect(test.renderer.root.findDescendantById("workspace:two")).toBeFalsy();
});

it("moves the cursor's actions to a visible row when the filter hides its workspace", async () => {
  const { app } = await labelled();
  await press(app, ["j", "\r"]);
  expect(app.lastFrame()).toContain("hello beta");
  await press(app, [":", "filter by label", "\r", "\u001b[B", "\r"]);
  for (let step = 0; step < 2; step++) {
    await press(app, ["\u001b"]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
  }
  await press(app, ["\t", "L"]);
  expect(app.lastFrame()).toContain("✓ Bug");
  await press(app, ["\u001b"]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  await press(app, ["\r"]);
  expect(app.lastFrame()).toContain("hello alpha");
});

it("renames a label from Manage labels… in the Command Center", async () => {
  const { app, port } = await labelled();
  await press(app, [":", "manage labels", "\r"]);
  expect(app.lastFrame()).toContain("UI");
  await press(app, ["\r", "\r", " Fix", "\r"]);
  expect(port.assigned).toEqual(['update {"name":"Bug","newName":"Bug Fix"}']);
});

it("deletes a label only on y after the count, never on Enter", async () => {
  const { app, port } = await labelled();
  port.deleteCount = 2;
  await press(app, [":", "manage labels", "\r", "\r"]);
  await press(app, ["\u001b[B", "\u001b[B", "\r"]);
  expect(app.lastFrame()).toContain(
    "Delete label Bug? Removes it from 2 workspaces",
  );
  await press(app, ["\r", "\r"]);
  expect(port.deleted).toEqual([]);
  await press(app, ["y"]);
  expect(port.deleted).toEqual(["Bug"]);
});

it("says why an unchanged label name is not saved", async () => {
  const { app, port } = await labelled();
  await press(app, [":", "manage labels", "\r", "\r", "\r", "\r"]);
  expect(app.lastFrame()).toContain("Name is unchanged");
  expect(port.assigned).toEqual([]);
});

it("refuses sidebar moves while a label filter is active", async () => {
  const { app, filter, test } = await labelled(["bug"]);
  const y = (id: string) =>
    test.renderer.root.findDescendantById(`workspace:${id}`)?.y ?? -1;
  await press(app, ["J"]);
  expect(app.lastFrame()).toContain("Clear the label filter to reorder");
  await press(app, ["\u001b"]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  await press(app, ["}"]);
  expect(app.lastFrame()).toContain("Clear the label filter to reorder");
  filter.set([]);
  await settle();
  expect(y("one")).toBeLessThan(y("two"));
  await press(app, ["J"]);
  expect(y("one")).toBeGreaterThan(y("two"));
});

it("right-clicks a workspace row, opens Labels… for that workspace and toggles a label", async () => {
  const { app, test, port } = await labelled();
  const row = test.renderer.root.findDescendantById("workspace:two");
  if (!row) throw Error("Missing workspace");
  await test.mockMouse.click(row.x + 2, row.y, 2);
  await settle();
  const labels = test.renderer.root.findDescendantById("context-labels");
  if (!labels) throw Error("Missing Labels… menu row");
  await test.mockMouse.click(labels.x + 2, labels.y);
  await settle();
  expect(app.lastFrame()).toContain("Labels");
  expect(app.lastFrame()).not.toContain("✓ Bug");
  await press(app, ["\r"]);
  expect(port.assigned).toEqual(["two +Bug red"]);
});

it("opens Labels… from the context menu with l", async () => {
  const { app, test, port } = await labelled();
  const row = test.renderer.root.findDescendantById("workspace:two");
  if (!row) throw Error("Missing workspace");
  await test.mockMouse.click(row.x + 2, row.y, 2);
  await settle();
  await press(app, ["l", "\u001b[B", "\r"]);
  expect(port.assigned).toEqual(["two +UI sky"]);
});
