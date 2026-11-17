import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { expect, it } from "vitest";
import {
  agents,
  FakeHistory,
  rowText,
  settle,
  settleUntil,
  setup,
} from "../test/app-harness.js";
import { at } from "../test/at.js";
import { agent, NO_PROJECT_ACTIONS } from "../test/fixtures.js";
import type { AppProps } from "./App.js";

/** 400 rows: an old prompt mentioning the needle, then filler, then a recent mention. */
function longChat(): AgentTimelineItem[] {
  return [
    { type: "user_message", text: "ancient needle question" },
    ...Array.from(
      { length: 398 },
      (_, index): AgentTimelineItem => ({
        type: "assistant_message",
        text: `filler ${index}\n`,
      }),
    ),
    { type: "user_message", text: "recent needle question" },
  ];
}
async function searchFor(
  app: Awaited<ReturnType<typeof setup>>["app"],
  query: string,
) {
  for (const key of ["\r", "/", query, "\r"]) {
    app.stdin.write(key);
    await settle();
  }
}

it("finds matches outside the loaded window and pages back to them with n", async () => {
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    () => longChat(),
    () => ({ tail: 50, search: true }),
  );
  await searchFor(app, "needle");
  await settleUntil(app.lastFrame, "match 2/2");
  expect(app.lastFrame()).toContain("recent needle question");
  app.stdin.write("n");
  await settleUntil(app.lastFrame, "ancient needle question");
  expect(app.lastFrame()).toContain("match 1/2");
  app.stdin.write("N");
  await settleUntil(app.lastFrame, "recent needle question");
  expect(app.lastFrame()).toContain("match 2/2");
});

it("jumps to the newest daemon match when nothing loaded matches", async () => {
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    () => longChat(),
    () => ({ tail: 50, search: true }),
  );
  await searchFor(app, "ancient");
  await settleUntil(app.lastFrame, "ancient needle question");
  expect(app.lastFrame()).toContain("match 1/1");
});

it("searches only loaded rows when the daemon lacks agentHistorySearch", async () => {
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    () => longChat(),
    () => ({ tail: 50, search: false }),
  );
  await searchFor(app, "ancient");
  expect(app.lastFrame()).toContain("no match");
});

const archivedAgent = agent("old", {
  title: "Old one",
  cwd: "/repo/one",
  workspaceId: "one",
  createdAt: "2026-10-31T00:00:00Z",
  archivedAt: "2026-11-04T00:00:00Z",
});
async function openHistory(
  history: FakeHistory,
  agentId: string,
  extra: Partial<AppProps> = {},
) {
  const harness = await setup(
    agents,
    30,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { history, ...extra },
  );
  const { app, test } = harness;
  app.stdin.write("H");
  await settleUntil(app.lastFrame, "History");
  const row = `command:history:${agentId}`;
  for (let i = 0; i < 100 && !test.renderer.root.findDescendantById(row); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
  }
  app.stdin.write("\r");
  await settle();
  return harness;
}

it("H opens History and Enter opens a live session in its workspace", async () => {
  const active: (string | null)[] = [];
  const history = new FakeHistory([
    { agent: at(agents, 2), projectName: "Repo", workspaceName: null },
  ]);
  const { app, test } = await openHistory(history, "gamma", {
    onActiveWorkspace: (id) => active.push(id),
  });
  await settleUntil(app.lastFrame, "hello gamma");
  expect(app.lastFrame()).toContain("hello gamma");
  expect(active.at(-1)).toBe("two");
  expect(rowText(test, "pane-tabs:0")).toContain("Gamma agent");
  expect(rowText(test, "pane-tabs:0")).not.toContain("Alpha agent");
});

it("archived session opens view-only", async () => {
  const history = new FakeHistory([
    { agent: archivedAgent, projectName: "Repo", workspaceName: null },
  ]);
  const { app, ports } = await openHistory(history, "old");
  await settleUntil(app.lastFrame, "hello old");
  expect(app.lastFrame()).toContain("This agent is archived · u Unarchive");
  for (const key of ["i", "x", "y", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain(
    "This agent is archived; press u to unarchive",
  );
  expect(ports.get("old")?.sent).toEqual([]);
});

it("opens a session whose workspace is gone in the focused pane", async () => {
  const lost = { ...archivedAgent, id: "lost", workspaceId: "gone" };
  const history = new FakeHistory([
    { agent: lost, projectName: null, workspaceName: "fix-login" },
  ]);
  history.recovery = {
    kind: "unavailable",
    message: "The worktree directory no longer exists",
  };
  const { app } = await openHistory(history, "lost");
  await settleUntil(app.lastFrame, "hello lost");
  await settleUntil(app.lastFrame, "The worktree directory no longer exists");
  expect(app.lastFrame()).toContain("Workspace archived");
  expect(app.lastFrame()).not.toContain("u Restore");
  expect(history.inspected).toEqual(["lost"]);
});

it("opens an archived workspace's session apart from the active workspaces", async () => {
  const lost = { ...archivedAgent, id: "lost", workspaceId: "gone" };
  const history = new FakeHistory([
    { agent: lost, projectName: null, workspaceName: "fix-login" },
  ]);
  history.recovery = { kind: "recoverable", name: "fix-login", branch: null };
  const active: (string | null)[] = [];
  const { app, test } = await openHistory(history, "lost", {
    onActiveWorkspace: (id) => active.push(id),
  });
  await settleUntil(app.lastFrame, "u Restore");
  expect(active.at(-1)).toBeNull();
  expect(rowText(test, "pane-tabs:0")).toContain("Old one");
  expect(rowText(test, "pane-tabs:0")).not.toContain("Alpha agent");
  expect(rowText(test, "pane-tabs:0")).not.toContain("Beta agent");
  for (const id of ["one", "two"])
    expect(rowText(test, `workspace:${id}`)).not.toContain("›");
  for (const key of ["Z", "Q", "y"]) {
    app.stdin.write(key);
    await settle();
  }
  await settle();
  expect(active.at(-1)).toBe("one");
  expect(rowText(test, "pane-tabs:0")).toContain("Alpha agent");
  expect(rowText(test, "workspace:one")).toContain("›");
});

it("opens an archived workspace's session in its own single pane", async () => {
  const lost = { ...archivedAgent, id: "lost", workspaceId: "gone" };
  const history = new FakeHistory([
    { agent: lost, projectName: null, workspaceName: "fix-login" },
  ]);
  const { app, test } = await setup(
    agents,
    30,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { history },
  );
  for (const key of ["\r", "\u0002", "%"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(test.renderer.root.findDescendantById("pane:1")).toBeTruthy();
  app.stdin.write("H");
  await settleUntil(app.lastFrame, "Search sessions");
  for (
    let i = 0;
    i < 100 && !test.renderer.root.findDescendantById("command:history:lost");
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
  }
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "hello lost");
  expect(test.renderer.root.findDescendantById("pane:1")).toBeFalsy();
});

it("restores a session's archived workspace and opens the agent in it", async () => {
  const stale = { ...archivedAgent, id: "stale", workspaceId: "two" };
  const history = new FakeHistory([
    { agent: stale, projectName: null, workspaceName: null },
  ]);
  history.recovery = {
    kind: "recoverable",
    name: "Triage FLE-1",
    branch: "anh/fle-1",
  };
  const active: (string | null)[] = [];
  const harness = await setup(
    agents,
    30,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { history, onActiveWorkspace: (id) => active.push(id) },
  );
  const row = harness.removeWorkspace("two");
  if (!row) throw Error("missing workspace two");
  await settle();
  const { app, test, agentsPort } = harness;
  app.stdin.write("H");
  for (
    let i = 0;
    i < 100 && !test.renderer.root.findDescendantById("command:history:stale");
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
  }
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "u Restore");
  expect(app.lastFrame()).toContain("Workspace archived");
  expect(app.lastFrame()).toContain(
    "Restore Triage FLE-1 to return to its agents.",
  );
  expect(app.lastFrame()).toContain("Its worktree will use branch anh/fle-1.");
  expect(app.lastFrame()).not.toContain("showing the session here");
  app.stdin.write("u");
  await settleUntil(app.lastFrame, "Restoring…");
  expect(history.unarchived).toEqual(["stale"]);
  harness.addWorkspace(row);
  agentsPort.handler?.({
    kind: "upsert",
    agent: { ...stale, archivedAt: null },
  });
  await settle();
  await settle();
  expect(active.at(-1)).toBe("two");
  expect(test.renderer.root.findDescendantById("archived-callout")).toBeFalsy();
  expect(app.lastFrame()).toContain("hello stale");
});

it("unarchive failure keeps the view-only callout", async () => {
  const history = new FakeHistory([
    { agent: archivedAgent, projectName: "Repo", workspaceName: null },
  ]);
  history.unarchiveError = Error("boom");
  const { app, test, ports } = await openHistory(history, "old");
  await settleUntil(app.lastFrame, "hello old");
  app.stdin.write("u");
  await settleUntil(app.lastFrame, "! boom");
  expect(history.unarchived).toEqual(["old"]);
  expect(
    test.renderer.root.findDescendantById("archived-callout"),
  ).toBeTruthy();
  expect(app.lastFrame()).toContain("! boom");
  for (const key of ["i", "x", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(ports.get("old")?.sent).toEqual([]);
});

it("unarchived agent replaces its archived tab in place", async () => {
  const history = new FakeHistory([
    { agent: archivedAgent, projectName: "Repo", workspaceName: null },
  ]);
  const { app, test, agentsPort } = await openHistory(history, "old");
  await settleUntil(app.lastFrame, "hello old");
  function order() {
    const strip = rowText(test, "pane-tabs:0");
    return ["Old one", "Alpha agent", "Beta agent"].map((name) =>
      strip.indexOf(name),
    );
  }
  const before = order();
  expect(before.every((index) => index >= 0)).toBe(true);
  expect(before).toEqual([...before].sort((a, b) => a - b));
  app.stdin.write("u");
  await settleUntil(app.lastFrame, "Unarchiving…");
  expect(history.unarchived).toEqual(["old"]);
  agentsPort.handler?.({
    kind: "upsert",
    agent: { ...archivedAgent, archivedAt: null },
  });
  await settle();
  await settle();
  expect(order()).toEqual(before);
  expect(app.lastFrame()).not.toContain("This agent is archived");
  expect(app.lastFrame()).not.toContain("Unarchiving…");
  expect(test.renderer.root.findDescendantById("archived-callout")).toBeFalsy();
});

it("unarchives a session whose live tab was closed earlier in this run", async () => {
  const alpha = at(agents, 0);
  const archivedAlpha = { ...alpha, archivedAt: "2026-11-04T00:00:00Z" };
  const history = new FakeHistory([
    { agent: archivedAlpha, projectName: "Repo", workspaceName: null },
  ]);
  const management: NonNullable<AppProps["management"]> = {
    ...NO_PROJECT_ACTIONS,
    baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
    openFile: async () => {
      throw Error("Unexpected");
    },
    createWorkspace: async () => {
      throw Error("Unexpected create");
    },
    createAgent: async () => agent("new"),
    createTerminal: async () => {
      throw Error("Unexpected terminal");
    },
    renameWorkspace: async () => {},
    renameTab: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async () => {},
  };
  const { app, test, agentsPort } = await setup(
    agents,
    30,
    false,
    {},
    undefined,
    undefined,
    management,
    undefined,
    { history },
  );
  function order() {
    const strip = rowText(test, "pane-tabs:0");
    return ["Alpha agent", "Beta agent"].map((name) => strip.indexOf(name));
  }
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "hello alpha");
  const before = order();
  expect(before.every((index) => index >= 0)).toBe(true);
  for (const key of ["Z", "Q", "y"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(test.renderer.root.findDescendantById("tab:agent:alpha")).toBeFalsy();
  agentsPort.handler?.({ kind: "upsert", agent: archivedAlpha });
  await settle();
  app.stdin.write("H");
  for (
    let i = 0;
    i < 100 && !test.renderer.root.findDescendantById("command:history:alpha");
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
  }
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "This agent is archived · u Unarchive");
  app.stdin.write("u");
  await settleUntil(app.lastFrame, "Unarchiving…");
  expect(history.unarchived).toEqual(["alpha"]);
  agentsPort.handler?.({ kind: "upsert", agent: alpha });
  await settle();
  await settle();
  expect(app.lastFrame()).not.toContain("Unarchiving…");
  expect(test.renderer.root.findDescendantById("archived-callout")).toBeFalsy();
  expect(order()).toEqual(before);
  app.stdin.write("i");
  await settle();
  expect(app.lastFrame()).not.toContain(
    "This agent is archived; press u to unarchive",
  );
});

it("opens a session whose workspace was archived during this run", async () => {
  const stale = { ...archivedAgent, id: "stale", workspaceId: "two" };
  const history = new FakeHistory([
    { agent: stale, projectName: null, workspaceName: null },
  ]);
  const harness = await setup(
    agents,
    30,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { history },
  );
  harness.removeWorkspace("two");
  await settle();
  const { app, test } = harness;
  app.stdin.write("H");
  for (
    let i = 0;
    i < 100 && !test.renderer.root.findDescendantById("command:history:stale");
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
  }
  history.recovery = { kind: "recoverable", name: "two", branch: null };
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "hello stale");
  await settleUntil(app.lastFrame, "u Restore");
  expect(app.lastFrame()).toContain("Restore two to return to its agents.");
});

it("Shift-Tab and Ctrl-X leave an archived session unchanged", async () => {
  const moded = {
    ...archivedAgent,
    currentModeId: "ask",
    availableModes: [
      { id: "ask", label: "Ask" },
      { id: "auto", label: "Auto" },
    ],
  };
  const history = new FakeHistory([
    { agent: moded, projectName: "Repo", workspaceName: null },
  ]);
  const { app, test, ports } = await openHistory(history, "old");
  await settleUntil(app.lastFrame, "hello old");
  test.mockInput.pressTab({ shift: true });
  await settle();
  expect(app.lastFrame()).toContain(
    "This agent is archived; press u to unarchive",
  );
  app.stdin.write("\u0018");
  await settle();
  expect(ports.get("old")?.modes).toEqual([]);
  expect(ports.get("old")?.canceled).toBe(0);
});

it("History fills the terminal height to list many sessions at once", async () => {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    agent: agent(`s${index}`, {
      title: `Session ${index}`,
      cwd: "/repo/one",
      workspaceId: "one",
      archivedAt: "2026-11-04T00:00:00Z",
    }),
    projectName: "Repo",
    workspaceName: null,
  }));
  const { app, test } = await setup(
    agents,
    40,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { history: new FakeHistory(sessions) },
  );
  app.stdin.write("H");
  await settleUntil(app.lastFrame, "History");
  for (
    let i = 0;
    i < 100 && !test.renderer.root.findDescendantById("command:history:s0");
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
  }
  for (let index = 0; index < 12; index++)
    expect(
      test.renderer.root.findDescendantById(`command:history:s${index}`),
    ).toBeTruthy();
});

async function jumpSetup(prompts = true) {
  const harness = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    () => longChat(),
    () => ({ tail: 50, search: false, prompts }),
  );
  harness.app.stdin.write("\r");
  await settle();
  return harness;
}
function selectedRow(
  test: Awaited<ReturnType<typeof setup>>["test"],
  key: string,
) {
  const block = test.renderer.root.findDescendantById(key);
  if (!block) return null;
  return test.captureCharFrame().split("\n")[block.y] ?? null;
}
it("t lists the session's prompts and jumps to an old one, paging history in", async () => {
  const { app, test, ports } = await jumpSetup();
  expect(app.lastFrame()).not.toContain("ancient needle question");
  app.stdin.write("t");
  await settleUntil(app.lastFrame, "ancient needle question");
  expect(app.lastFrame()).toContain("Jump to prompt");
  for (const key of ["\u001b[B", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  await settleUntil(app.lastFrame, "ancient needle question");
  expect(app.lastFrame()).not.toContain("Jump to prompt");
  expect(ports.get("alpha")?.olderFetches.length).toBeGreaterThan(0);
  expect(selectedRow(test, "user:1")).toContain("▌");
  expect(app.lastFrame()).toContain("NORMAL");
});
it("jumps to a loaded prompt without fetching older history", async () => {
  const { app, test, ports } = await jumpSetup();
  app.stdin.write("k");
  await settle();
  app.stdin.write("t");
  await settleUntil(app.lastFrame, "Jump to prompt");
  await settleUntil(app.lastFrame, "ancient needle question");
  app.stdin.write("\r");
  await settle();
  expect(ports.get("alpha")?.olderFetches).toEqual([]);
  expect(selectedRow(test, "user:400")).toContain("▌");
});
it("t asks for a newer daemon without the prompt index", async () => {
  const { app } = await jumpSetup(false);
  app.stdin.write("t");
  await settle();
  expect(app.lastFrame()).toContain(
    "Update the Paseo daemon to browse prompts",
  );
  expect(app.lastFrame()).not.toContain("Jump to prompt");
});

it("shows a fork's chat history collapsed until it is expanded", async () => {
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    () => [
      {
        type: "user_message",
        text: "<chat-history-summary>\nSource agent: Origin\n\n[User] old secret ask\n</chat-history-summary>\n\ncarry on",
      },
      { type: "assistant_message", text: "ok" },
    ],
  );
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "carry on");
  expect(app.lastFrame()).toContain("Chat history from Origin");
  expect(app.lastFrame()).not.toContain("old secret ask");
  app.stdin.write("O");
  await settleUntil(app.lastFrame, "old secret ask");
  expect(app.lastFrame()).toContain("old secret ask");
});

const rewindable = agent("alpha", {
  title: "Alpha agent",
  cwd: "/repo/one",
  workspaceId: "one",
  capabilities: {
    ...at(agents, 0).capabilities,
    supportsRewindConversation: true,
  },
});
const asked = "please rewrite the parser and keep every existing test green";
async function rewindSetup() {
  const result = await setup(
    [rewindable],
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    () => [
      { type: "user_message", text: asked, messageId: "m1" },
      { type: "assistant_message", text: "done" },
    ],
    () => ({ tail: 2, search: false, prompts: true, rewind: true }),
  );
  const { app } = result;
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "done");
  async function rewind() {
    for (const key of ["\u000b", "rewind to prompt", "\r"]) {
      app.stdin.write(key);
      await settle();
    }
    await settleUntil(app.lastFrame, "Rewind to prompt");
    app.stdin.write("\r");
    await settleUntil(app.lastFrame, "to before");
    app.stdin.write("y");
    await settle();
  }
  return { ...result, rewind };
}
it("fills the prompt with the rewound message, ready to edit and send", async () => {
  const { app, ports, rewind } = await rewindSetup();
  await rewind();
  expect(ports.get("alpha")?.rewinds).toEqual([["m1", "conversation"]]);
  expect(app.lastFrame()).toContain("INSERT");
  app.stdin.write(" please");
  await settle();
  app.stdin.write("\r");
  await settle();
  expect(ports.get("alpha")?.sent).toEqual([`${asked} please`]);
});
it("keeps a draft when restoring a rewound message", async () => {
  const { app, ports, rewind } = await rewindSetup();
  app.stdin.write("i");
  await settle();
  app.stdin.write("my draft");
  await settle();
  await rewind();
  app.stdin.write("\r");
  await settle();
  expect(ports.get("alpha")?.sent).toEqual([`my draft\n${asked}`]);
});
it("leaves the prompt empty when the rewind fails", async () => {
  const { app, ports, rewind } = await rewindSetup();
  const port = ports.get("alpha");
  if (!port) throw Error("missing port");
  port.rewindError = Error("Rewind denied");
  await rewind();
  expect(app.lastFrame()).toContain("Rewind denied");
  expect(app.lastFrame()).not.toContain("INSERT");
});

it("grows the prompt to show a long rewound message from its first word", async () => {
  const long = `start-marker ${"lorem ipsum ".repeat(18)}end-marker`;
  const result = await setup(
    [rewindable],
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    () => [
      { type: "user_message", text: long, messageId: "m1" },
      { type: "assistant_message", text: "done" },
    ],
    () => ({ tail: 2, search: false, prompts: true, rewind: true }),
  );
  const { app } = result;
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "done");
  for (const key of ["\u000b", "rewind to prompt", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  await settleUntil(app.lastFrame, "Rewind to prompt");
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "to before");
  app.stdin.write("y");
  await settle();
  const prompt = app.lastFrame().split("\n").slice(-8).join("\n");
  expect(prompt).toContain("start-marker");
  expect(prompt).toContain("end-marker");
});

it("restores the archived workspace of a live session opened from History", async () => {
  const stranded = agent("lost", {
    title: "Lost one",
    cwd: "/repo/gone",
    workspaceId: "gone",
    lastUserMessageAt: "2026-11-03T00:00:00Z",
  });
  const history = new FakeHistory([
    { agent: stranded, projectName: "Repo", workspaceName: "fw-fix" },
    { agent: at(agents, 2), projectName: "Repo", workspaceName: null },
  ]);
  const harness = await setup(
    [...agents, stranded],
    30,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { history },
  );
  const { app, test } = harness;
  const all = history.entries;
  harness.removeWorkspace("gone");
  await settle();
  async function openRow(id: string) {
    history.entries = all.filter((entry) => entry.agent.id === id);
    app.stdin.write("H");
    await settleUntil(app.lastFrame, "History");
    const row = `command:history:${id}`;
    for (
      let i = 0;
      i < 100 && !test.renderer.root.findDescendantById(row);
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await settle();
    }
    app.stdin.write("\r");
    await settle();
  }
  await openRow("gamma");
  await settleUntil(app.lastFrame, "hello gamma");
  expect(history.restored).toEqual([]);
  await openRow("lost");
  await settleUntil(app.lastFrame, "hello lost");
  expect(history.restored).toEqual(["lost"]);
});

it("says why a live session's workspace could not be restored", async () => {
  const stranded = agent("lost", {
    title: "Lost one",
    cwd: "/repo/gone",
    workspaceId: "gone",
  });
  const history = new FakeHistory([
    { agent: stranded, projectName: "Repo", workspaceName: "fw-fix" },
  ]);
  history.restoreError = Error("The worktree directory no longer exists");
  const harness = await setup(
    [...agents, stranded],
    30,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { history },
  );
  harness.removeWorkspace("gone");
  await settle();
  const { app, test } = harness;
  app.stdin.write("H");
  await settleUntil(app.lastFrame, "History");
  for (
    let i = 0;
    i < 100 && !test.renderer.root.findDescendantById("command:history:lost");
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
  }
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "worktree directory no longer exists");
  expect(app.lastFrame()).toContain(
    "Could not restore workspace fw-fix: The worktree directory no longer exists",
  );
});
