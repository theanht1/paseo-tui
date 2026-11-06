import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import {
  addArchivedView,
  archivedCalloutText,
  historyOpenTarget,
  mutatesAgent,
  pruneArchivedViews,
  removeArchivedView,
  type UnarchiveState,
  viewOnlyCommands,
  withArchivedViews,
} from "./archived-views.js";

const live = agent("live", { workspaceId: "one" });
const old = agent("old", { workspaceId: "one", archivedAt: "2026-11-04" });
const gone = agent("gone", { workspaceId: "lost", archivedAt: "2026-11-04" });
const workspaces = [{ id: "one" }];

it("opens a listed live agent as itself and anything else as an archived view", () => {
  const listed = { ...live };
  expect(historyOpenTarget(live, [listed], workspaces)).toEqual({
    kind: "live",
    agent: listed,
  });
  expect(historyOpenTarget(old, [listed], workspaces)).toEqual({
    kind: "archived",
    agent: old,
    workspace: { id: "one" },
  });
  expect(historyOpenTarget(gone, [listed], workspaces)).toEqual({
    kind: "archived",
    agent: gone,
    workspace: null,
  });
});

it("adds, removes and prunes views, keeping the map when nothing changes", () => {
  const empty: ReadonlyMap<string, typeof old> = new Map();
  const views = addArchivedView(empty, old);
  expect([...views.keys()]).toEqual(["old"]);
  expect(removeArchivedView(views, "missing")).toBe(views);
  expect(removeArchivedView(views, "old").size).toBe(0);
  expect(pruneArchivedViews(views, [live])).toBe(views);
  expect(pruneArchivedViews(views, [{ ...old, archivedAt: null }]).size).toBe(
    0,
  );
  expect(
    pruneArchivedViews(views, [{ ...old, archivedAt: "2026-11-05" }]),
  ).toBe(views);
});

it("lists live agents first, then views the live list lacks", () => {
  const views = addArchivedView(addArchivedView(new Map(), old), live);
  expect(withArchivedViews([live], views)).toEqual([live, old]);
  expect(withArchivedViews([live], new Map())).toEqual([live]);
});

it("callout copy for idle, unarchiving and failed", () => {
  expect(archivedCalloutText({ kind: "idle" })).toBe(
    "This agent is archived · u Unarchive",
  );
  expect(archivedCalloutText({ kind: "pending" })).toBe("Unarchiving…");
  expect(archivedCalloutText({ kind: "failed", message: "boom" })).toBe(
    "! boom",
  );
});

it("names the actions that would change the agent", () => {
  for (const type of [
    "insert",
    "prompt.edit",
    "agent.cycleMode",
    "stop",
    "prefix.literal",
  ] as const)
    expect(mutatesAgent({ type })).toBe(true);
  expect(mutatesAgent({ type: "block.toggle" })).toBe(false);
  expect(mutatesAgent({ type: "search.start" })).toBe(false);
  expect(mutatesAgent({ type: "scroll.lines", delta: 1 })).toBe(false);
});

it("an archived agent keeps only commands that leave it unchanged", () => {
  const ids = [
    "unarchive",
    "context-window",
    "set-mode",
    "set-model",
    "set-thinking",
    "rewind",
    "fork",
    "rename",
    "open-chat-file",
  ];
  const items = ids.map((id) => ({ id }));
  expect(viewOnlyCommands(old, items).map((item) => item.id)).toEqual([
    "unarchive",
    "context-window",
    "fork",
    "open-chat-file",
  ]);
  expect(viewOnlyCommands(live, items)).toBe(items);
});

it("prunes unarchive progress for an agent that is live again", () => {
  const progress: ReadonlyMap<string, UnarchiveState> = new Map([
    ["old", { kind: "pending" }],
  ]);
  expect(pruneArchivedViews(progress, [live])).toBe(progress);
  expect(
    pruneArchivedViews(progress, [{ ...old, archivedAt: null }]).size,
  ).toBe(0);
});
