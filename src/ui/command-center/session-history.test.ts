import { expect, it } from "vitest";
import type { HistoryEntry, HistoryPage } from "../../connection/ports.js";
import { agent } from "../../test/fixtures.js";
import type { CommandStep } from "./registry.js";
import {
  type SessionHistoryContext,
  sessionHistoryCommand,
  sessionHistoryStep,
} from "./session-history.js";

const NOW = Date.parse("2026-11-05T12:00:00Z");
function context(
  page: Partial<HistoryPage & { hostErrors: string[] }> = {},
  searchable = true,
) {
  const queries: string[] = [];
  const opened: HistoryEntry[] = [];
  const value: SessionHistoryContext = {
    history: {
      searchable,
      async list(query) {
        queries.push(query);
        return { entries: [], truncated: false, hostErrors: [], ...page };
      },
    },
    now: () => NOW,
    open: (entry) => opened.push(entry),
  };
  return { value, queries, opened };
}
function search(step: CommandStep, query: string) {
  if (step.kind !== "search") throw Error(`expected search, got ${step.kind}`);
  return step.search(query);
}
const live = agent("live", {
  title: "Live one",
  cwd: "/repo/live",
  updatedAt: "2026-11-05T11:00:00Z",
});
const archived = agent("old", {
  title: "Old one",
  cwd: "/repo/old",
  archivedAt: "2026-11-04T00:00:00Z",
  updatedAt: "2026-11-03T12:00:00Z",
});

it("lists sessions in port order with archived marked", async () => {
  const { value } = context({
    entries: [
      { agent: archived, projectName: "Repo", workspaceName: null },
      { agent: live, projectName: null, workspaceName: null },
    ],
  });
  const rows = await search(sessionHistoryStep(value), "");
  expect(rows.map((row) => row.title)).toEqual(["Old one", "Live one"]);
  expect(rows.map((row) => row.subtitle)).toEqual([
    "Repo · codex · archived · 2d",
    "/repo/live · codex · idle · 1h",
  ]);
  expect(rows.every((row) => row.recency === undefined)).toBe(true);
});

it("passes the typed query to the port", async () => {
  const { value, queries } = context();
  await search(sessionHistoryStep(value), "fix");
  expect(queries).toEqual(["fix"]);
});

it("empty, no-match, truncated, host-error and unsupported-search rows", async () => {
  const step = sessionHistoryStep(context().value);
  expect((await search(step, "")).map((row) => row.title)).toEqual([
    "No sessions yet",
  ]);
  expect((await search(step, "zzz")).map((row) => row.title)).toEqual([
    "No sessions match",
  ]);
  const truncated = sessionHistoryStep(
    context({
      entries: [{ agent: live, projectName: null, workspaceName: null }],
      truncated: true,
    }).value,
  );
  expect((await search(truncated, "a")).at(-1)?.title).toBe(
    "Too many matches — narrow your search",
  );
  const failing = sessionHistoryStep(
    context({
      entries: [{ agent: live, projectName: null, workspaceName: null }],
      hostErrors: ["work: offline"],
    }).value,
  );
  expect((await search(failing, "")).at(-1)?.title).toBe("! work: offline");
  const unsupported = sessionHistoryStep(
    context(
      { entries: [{ agent: live, projectName: null, workspaceName: null }] },
      false,
    ).value,
  );
  expect((await search(unsupported, "fix")).map((row) => row.title)).toEqual([
    "Search needs a newer daemon (agentHistorySearch)",
    "Live one",
  ]);
  expect((await search(unsupported, "")).map((row) => row.title)).toEqual([
    "Live one",
  ]);
  const status = (await search(step, ""))[0];
  expect(status?.run()).toBe(step);
});

it("selecting a row calls open with its entry", async () => {
  const entry = { agent: archived, projectName: "Repo", workspaceName: "fix" };
  const { value, opened } = context({ entries: [entry] });
  const [row] = await search(sessionHistoryStep(value), "");
  expect(row?.run()).toBeUndefined();
  expect(opened).toEqual([entry]);
});

it("History… opens the History step", () => {
  const command = sessionHistoryCommand(context().value);
  expect(command).toMatchObject({
    id: "history",
    group: "Agents",
    title: "History…",
    keywords: ["sessions", "archived", "closed", "resume"],
    action: { type: "history.open" },
  });
  expect(command.run()).toMatchObject({ kind: "search", title: "History" });
});
