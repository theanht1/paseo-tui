import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
import { expect, test } from "vitest";
import type { WorkspaceLabelEdit } from "../../connection/ports.js";
import { createEmitter } from "../../state/emitter.js";
import {
  type AssignmentInput,
  type HostLabelState,
  type HostLabels,
  type WorkspaceLabels,
  workspaceLabelsView,
} from "../../state/label-catalog.js";
import { sessionLabelFilterMemory } from "../layout/label-filter-memory.js";
import type { WorkspaceRow } from "../workspace/workspaces.js";
import {
  labelCommands,
  labelErrorMessage,
  labelFilterStep,
  manageLabelsStep,
  workspaceLabelsStep,
} from "./label-commands.js";
import type { CommandItem, CommandStep } from "./registry.js";

const BUG: WorkspaceLabelDefinition = { name: "Bug", color: "red" };
const UI: WorkspaceLabelDefinition = { name: "ui", color: "sky" };
function deferred() {
  let resolve: (names: readonly string[]) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<readonly string[]>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
class FakeLabels implements WorkspaceLabels {
  emitter = createEmitter();
  state: HostLabelState = { kind: "ready", labels: [UI, BUG], error: null };
  calls: AssignmentInput[] = [];
  answers: ReturnType<typeof deferred>[] = [];
  /** Other hosts beside "h"; "h" is the workspace's host. */
  others: HostLabels[] = [];
  edits: string[] = [];
  editError: Error | null = null;
  getSnapshot() {
    return workspaceLabelsView({
      hosts: [
        { id: "h", label: "local", online: true, state: this.state },
        ...this.others,
      ],
      expected: ["h", ...this.others.map((host) => host.id)],
      hostOf: () => "h",
    });
  }
  async update(hostId: string, input: WorkspaceLabelEdit) {
    this.edits.push(`${hostId} update ${JSON.stringify(input)}`);
    if (this.editError) throw this.editError;
    return { name: input.newName ?? input.name, color: input.color ?? "red" };
  }
  async inspectDelete(hostId: string, name: string) {
    this.edits.push(`${hostId} inspect ${name}`);
    if (this.editError) throw this.editError;
    return name === "ui" ? 1 : 2;
  }
  async delete(hostId: string, name: string) {
    this.edits.push(`${hostId} delete ${name}`);
    return 2;
  }
  async reload(hostId: string) {
    this.edits.push(`${hostId} reload`);
  }
  subscribe = this.emitter.subscribe;
  setAssignment(input: AssignmentInput) {
    this.calls.push(input);
    const answer = deferred();
    this.answers.push(answer);
    return answer.promise;
  }
}
function rows(initial: string[] = ["Bug"]) {
  const emitter = createEmitter();
  let row: WorkspaceRow = {
    id: "w",
    projectId: "p",
    projectRootPath: "/p",
    activityAt: null,
    statusEnteredAt: null,
    workspaceDirectory: "/p/w",
    name: "w",
    labels: initial,
  };
  return {
    row: () => row,
    subscribe: emitter.subscribe,
    set(labels: string[]) {
      row = { ...row, labels };
      emitter.notify();
    },
  };
}
async function list(step: CommandStep | undefined | string) {
  if (typeof step !== "object" || step.kind !== "choice")
    throw Error("expected a choice step");
  return step.items();
}
function titles(items: readonly CommandItem[]) {
  return items.map((item) =>
    item.subtitle ? `${item.title} · ${item.subtitle}` : item.title,
  );
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("toggles the workspace's labels, staying open with one request per label", async () => {
  const labels = new FakeLabels();
  const directory = rows();
  const errors: string[] = [];
  const step = workspaceLabelsStep({
    labels,
    workspaceId: "w",
    row: directory.row,
    subscribeRows: directory.subscribe,
    report: (text) => errors.push(text),
  });
  let changes = 0;
  if (typeof step !== "object" || step.kind !== "choice")
    throw Error("expected a choice step");
  step.subscribe?.(() => changes++);
  expect(titles(await list(step))).toEqual([
    "✓ Bug · red",
    "  ui · sky",
    "New label…",
  ]);
  const ui = (await list(step))[1];
  expect(ui?.run()).toBe(step);
  expect(ui?.run()).toBe(step);
  expect(labels.calls).toEqual([
    { workspaceId: "w", label: UI, assigned: true },
  ]);
  expect(titles(await list(step))[1]).toBe("  ui · saving…");
  labels.answers[0]?.resolve(["Bug", "ui"]);
  await flush();
  expect(titles(await list(step)).slice(0, 2)).toEqual([
    "✓ Bug · red",
    "✓ ui · sky",
  ]);
  directory.set(["ui"]);
  expect(titles(await list(step)).slice(0, 2)).toEqual([
    "  Bug · red",
    "✓ ui · sky",
  ]);
  (await list(step))[1]?.run();
  labels.answers[1]?.reject(Error("ui is offline"));
  await flush();
  expect(errors).toEqual(["ui is offline"]);
  expect(titles(await list(step))[1]).toBe("✓ ui · sky");
  expect(changes).toBeGreaterThan(0);
});

test("New label… asks a name, then a color (violet first), and assigns it", async () => {
  const labels = new FakeLabels();
  const directory = rows([]);
  const step = workspaceLabelsStep({
    labels,
    workspaceId: "w",
    row: directory.row,
    subscribeRows: directory.subscribe,
    report() {},
  });
  const create = (await list(step)).at(-1)?.run();
  if (create?.kind !== "input") throw Error("expected an input");
  expect(create.required).toBe("Name");
  const colors = await list(create.submit("  Blocked "));
  expect(titles(colors).slice(0, 2)).toEqual(["violet · default", "sky"]);
  expect(colors[1]?.run()).toBeUndefined();
  expect(create.submit("BUG")).toBeUndefined();
  expect(labels.calls).toEqual([
    {
      workspaceId: "w",
      label: { name: "Blocked", color: "sky" },
      assigned: true,
    },
    { workspaceId: "w", label: BUG, assigned: true },
  ]);
});

test("the filter toggles labels and Unlabelled, and clears", async () => {
  const labels = new FakeLabels();
  const filter = sessionLabelFilterMemory();
  filter.set(["gone"]);
  const step = labelFilterStep({ labels, filter, workspaceId: null });
  expect(titles(await list(step))).toEqual([
    "  Unlabelled",
    "  Bug",
    "  ui",
    "✓ gone",
    "Clear filter",
  ]);
  const items = await list(step);
  expect(items[0]?.run()).toBe(step);
  expect(items[1]?.run()).toBe(step);
  expect(filter.getSnapshot()).toEqual(["gone", "", "bug"]);
  expect((await list(step)).at(-1)?.run()).toBeUndefined();
  expect(filter.getSnapshot()).toEqual([]);
  expect(titles(await list(step))[0]).toBe("  Unlabelled");
});

test("hosts without labels get an update-the-daemon message instead of a step", () => {
  const labels = new FakeLabels();
  labels.state = { kind: "unsupported" };
  const directory = rows();
  const reported: string[] = [];
  const deps = {
    labels,
    workspaceId: "w",
    row: directory.row,
    subscribeRows: directory.subscribe,
    report: (text: string) => reported.push(text),
  };
  expect(workspaceLabelsStep(deps)).toBe(
    "Update the Paseo daemon to use workspace labels (workspaceLabels)",
  );
  const filter = sessionLabelFilterMemory();
  expect(labelFilterStep({ labels, filter, workspaceId: null })).toBe(
    "Update the Paseo daemon to use workspace labels (workspaceLabels)",
  );
  const items = labelCommands({ ...deps, filter, workspace: null });
  expect(items.map((item) => item.title)).toEqual([
    "Filter by label…",
    "Manage labels…",
  ]);
  expect(items[0]?.run()).toBeUndefined();
  expect(reported).toEqual([
    "Update the Paseo daemon to use workspace labels (workspaceLabels)",
  ]);
});

function rpcError(message: string, code: string) {
  return Object.assign(
    Error(`${message} requestType=workspace.label.update.request code=${code}`),
    { requestType: "workspace.label.update.request", code },
  );
}
async function pick(step: CommandStep | string | undefined, title: string) {
  const item = (await list(step)).find((entry) => entry.title === title);
  if (!item) throw Error(`missing ${title}`);
  return item;
}
function manage(labels: FakeLabels, reported: string[] = []) {
  return manageLabelsStep({ labels, report: (text) => reported.push(text) });
}

test("Rename sends only the new name, allows a case-only change and refuses an unchanged or empty one", async () => {
  const labels = new FakeLabels();
  const step = manage(labels);
  expect(titles(await list(step))).toEqual(["Bug · red", "ui · sky"]);
  const actions = (await pick(step, "Bug")).run();
  expect(titles(await list(actions))).toEqual([
    "Rename…",
    "Recolor…",
    "Delete…",
  ]);
  const rename = (await pick(actions, "Rename…")).run();
  if (rename?.kind !== "input") throw Error("expected an input");
  expect(rename.initial).toBe("Bug");
  expect(rename.validate?.("  Bug ")).toBe("Name is unchanged");
  expect(rename.validate?.(" \t ")).toBe("Name is required");
  expect(rename.validate?.("bug")).toBeNull();
  expect(rename.submit("  Bug ")).toBe(rename);
  expect(rename.submit(" \t ")).toBe(rename);
  expect(labels.edits).toEqual([]);
  expect(rename.submit(" bug ")).toBeUndefined();
  await flush();
  expect(labels.edits).toEqual(['h update {"name":"Bug","newName":"bug"}']);
});

test("Recolor sends only the color and does nothing for the current one", async () => {
  const labels = new FakeLabels();
  const actions = (await pick(manage(labels), "Bug")).run();
  const recolor = (await pick(actions, "Recolor…")).run();
  expect(titles(await list(recolor)).slice(7, 9)).toEqual([
    "red · current",
    "amber",
  ]);
  expect((await pick(recolor, "red")).run()).toBe(recolor);
  expect((await pick(recolor, "amber")).run()).toBeUndefined();
  await flush();
  expect(labels.edits).toEqual(['h update {"name":"Bug","color":"amber"}']);
});

async function confirmation(step: CommandStep | undefined) {
  if (step?.kind !== "confirm" || !step.prepare)
    throw Error("expected a prepared confirmation");
  return { step, text: await step.prepare() };
}
test("Delete counts first, then asks to confirm (y) with the count, then deletes", async () => {
  const labels = new FakeLabels();
  const actions = (await pick(manage(labels), "Bug")).run();
  const step = (await pick(actions, "Delete…")).run();
  expect(labels.edits).toEqual([]);
  const { step: confirm, text } = await confirmation(step);
  expect(text).toBe("Delete label Bug? Removes it from 2 workspaces");
  expect(labels.edits).toEqual(["h inspect Bug"]);
  confirm.confirm();
  await flush();
  expect(labels.edits.at(-1)).toBe("h delete Bug");
  const ui = (await pick(manage(labels), "ui")).run();
  expect((await confirmation((await pick(ui, "Delete…")).run())).text).toBe(
    "Delete label ui? Removes it from 1 workspace",
  );
});

test("failures show the daemon's message without its request suffix", async () => {
  expect(
    labelErrorMessage(rpcError("Label not found", "label_not_found")),
  ).toBe("Label not found");
  expect(labelErrorMessage("boom")).toBe("boom");
  const labels = new FakeLabels();
  const reported: string[] = [];
  const actions = (await pick(manage(labels, reported), "Bug")).run();
  const rename = (await pick(actions, "Rename…")).run();
  if (rename?.kind !== "input") throw Error("expected an input");
  labels.editError = rpcError(
    "A label with that name already exists",
    "label_name_taken",
  );
  rename.submit("UI");
  await flush();
  expect(reported).toEqual(['A label named "UI" already exists on local']);
  labels.editError = rpcError("Label not found", "label_not_found");
  const confirm = (await pick(actions, "Delete…")).run();
  if (confirm?.kind !== "confirm" || !confirm.prepare)
    throw Error("expected a prepared confirmation");
  await expect(confirm.prepare()).rejects.toThrow(/^Label not found$/);
});

test("shows a failed listing instead of loading forever, and Enter lists again", async () => {
  const labels = new FakeLabels();
  labels.state = { kind: "failed", error: "timeout" };
  const step = manage(labels);
  expect(titles(await list(step))).toEqual([
    "Labels unavailable on local: timeout · Enter lists again",
  ]);
  expect((await pick(step, "Labels unavailable on local: timeout")).run()).toBe(
    step,
  );
  expect(labels.edits).toEqual(["h reload"]);
  labels.state = { kind: "loading" };
  expect(titles(await list(step))).toEqual(["Loading labels…"]);
  labels.state = { kind: "ready", labels: [BUG], error: null };
  expect(titles(await list(step))).toEqual(["Bug · red"]);
});

test("with labels on several hosts it asks whose labels to manage", async () => {
  const labels = new FakeLabels();
  labels.others = [
    {
      id: "b",
      label: "Build",
      online: false,
      state: {
        kind: "ready",
        labels: [{ name: "ops", color: "teal" }],
        error: null,
      },
    },
    { id: "c", label: "Old", online: true, state: { kind: "unsupported" } },
  ];
  const step = manage(labels);
  expect(titles(await list(step))).toEqual(["local", "Build · offline"]);
  const build = (await pick(step, "Build")).run();
  expect(titles(await list(build))).toEqual(["ops · teal"]);
  const recolor = (
    await pick((await pick(build, "ops")).run(), "Recolor…")
  ).run();
  (await pick(recolor, "sky")).run();
  await flush();
  expect(labels.edits).toEqual(['b update {"name":"ops","color":"sky"}']);
});

test("Manage labels… is offered with labels, and explains an old daemon otherwise", () => {
  const labels = new FakeLabels();
  const directory = rows();
  const filter = sessionLabelFilterMemory();
  const reported: string[] = [];
  const context = {
    labels,
    filter,
    workspace: null,
    row: directory.row,
    subscribeRows: directory.subscribe,
    report: (text: string) => reported.push(text),
  };
  expect(labelCommands(context).map((item) => item.title)).toEqual([
    "Filter by label…",
    "Manage labels…",
  ]);
  labels.state = { kind: "unsupported" };
  expect(labelCommands(context).at(-1)?.run()).toBeUndefined();
  expect(reported).toEqual([
    "Update the Paseo daemon to use workspace labels (workspaceLabels)",
  ]);
});
