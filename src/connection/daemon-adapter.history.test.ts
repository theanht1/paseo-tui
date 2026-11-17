import type { PaseoAgent } from "@getpaseo/client";
import type { WorkspaceRecoveryState } from "@getpaseo/protocol/messages";
import { expect, test } from "vitest";
import { agent } from "../test/fixtures.js";
import { createHistoryAdapter, type HistoryDaemon } from "./daemon-adapter.js";

class FakeDaemon implements HistoryDaemon {
  requests: unknown[] = [];
  refreshed: string[] = [];
  calls: string[] = [];
  recovery: (workspaceId: string) => WorkspaceRecoveryState = (
    workspaceId,
  ) => ({
    kind: "unavailable",
    workspaceId,
    reason: "workspace_not_archived",
    message: "Workspace is not archived",
  });
  hasMore = false;
  searchTruncated: boolean | undefined;
  entries: {
    agent: PaseoAgent;
    project: { projectName: string; workspaceName?: string | null };
  }[] = [
    {
      agent: agent("a1"),
      project: { projectName: "app", workspaceName: "fix" },
    },
    { agent: agent("a2"), project: { projectName: "app" } },
  ];
  constructor(private searchable: boolean) {}
  getLastServerInfoMessage() {
    return { features: { agentHistorySearch: this.searchable } };
  }
  async fetchAgentHistory(options: unknown) {
    this.requests.push(options);
    return {
      entries: this.entries,
      pageInfo: { hasMore: this.hasMore },
      ...(this.searchTruncated === undefined
        ? {}
        : { searchTruncated: this.searchTruncated }),
    };
  }
  async refreshAgent(agentId: string) {
    this.refreshed.push(agentId);
    this.calls.push(`refresh ${agentId}`);
  }
  async inspectWorkspaceRecovery(workspaceId: string) {
    this.calls.push(`inspect ${workspaceId}`);
    return this.recovery(workspaceId);
  }
  async restoreWorkspace(workspaceId: string) {
    this.calls.push(`restore ${workspaceId}`);
  }
}

test("requests archived sessions newest first", async () => {
  const fake = new FakeDaemon(false);
  const page = await createHistoryAdapter(fake).list("");
  expect(fake.requests).toEqual([
    {
      filter: { includeArchived: true },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: 200 },
    },
  ]);
  expect(page.entries).toEqual([
    { agent: agent("a1"), projectName: "app", workspaceName: "fix" },
    { agent: agent("a2"), projectName: "app", workspaceName: null },
  ]);
  expect(page.truncated).toBe(false);
});

test("searches only when the daemon supports it", async () => {
  const supported = new FakeDaemon(true);
  const history = createHistoryAdapter(supported);
  expect(history.searchable).toBe(true);
  await history.list("  fix ");
  await history.list("   ");
  expect(supported.requests).toMatchObject([{ search: "fix" }, {}]);
  expect(supported.requests[1]).not.toHaveProperty("search");

  const plain = new FakeDaemon(false);
  const without = createHistoryAdapter(plain);
  expect(without.searchable).toBe(false);
  await without.list("fix");
  expect(plain.requests[0]).not.toHaveProperty("search");
});

test("marks truncation", async () => {
  const more = new FakeDaemon(false);
  more.hasMore = true;
  expect((await createHistoryAdapter(more).list("")).truncated).toBe(true);
  const searched = new FakeDaemon(true);
  searched.searchTruncated = true;
  expect((await createHistoryAdapter(searched).list("x")).truncated).toBe(true);
});

test("unarchive refreshes the agent and leaves an active workspace alone", async () => {
  const fake = new FakeDaemon(false);
  await createHistoryAdapter(fake).unarchive({ id: "a9", workspaceId: "w" });
  expect(fake.calls).toEqual(["inspect w", "refresh a9"]);
  await createHistoryAdapter(fake).unarchive({ id: "a8" });
  expect(fake.calls).toEqual(["inspect w", "refresh a9", "refresh a8"]);
});

test("unarchive restores the agent's archived workspace first, so it returns to the sidebar", async () => {
  const fake = new FakeDaemon(false);
  fake.recovery = (workspaceId) => ({
    kind: "recoverable",
    workspaceId,
    workspaceName: "fw-fix-error-watch",
    action: "unarchive",
    branch: null,
  });
  await createHistoryAdapter(fake).unarchive({ id: "a9", workspaceId: "w" });
  expect(fake.calls).toEqual(["inspect w", "restore w", "refresh a9"]);
});

test("unarchive keeps the agent archived when its workspace cannot come back", async () => {
  const fake = new FakeDaemon(false);
  fake.recovery = (workspaceId) => ({
    kind: "unavailable",
    workspaceId,
    reason: "workspace_directory_missing",
    message: "The worktree directory no longer exists",
  });
  await expect(
    createHistoryAdapter(fake).unarchive({ id: "a9", workspaceId: "w" }),
  ).rejects.toThrow("The worktree directory no longer exists");
  expect(fake.calls).toEqual(["inspect w"]);
});

test("restores a live agent's archived workspace without touching the agent", async () => {
  const fake = new FakeDaemon(false);
  fake.recovery = (workspaceId) => ({
    kind: "recoverable",
    workspaceId,
    workspaceName: "fw-fix-error-watch",
    action: "unarchive",
    branch: null,
  });
  await createHistoryAdapter(fake).restoreWorkspace({
    id: "a9",
    workspaceId: "w",
  });
  expect(fake.calls).toEqual(["inspect w", "restore w"]);
});

test("inspects an archived workspace as recoverable with its name and branch", async () => {
  const fake = new FakeDaemon(false);
  fake.recovery = (workspaceId) => ({
    kind: "recoverable",
    workspaceId,
    workspaceName: "Triage FLE-1",
    action: "unarchive",
    branch: "anh/fle-1",
  });
  expect(
    await createHistoryAdapter(fake).inspectWorkspace({
      id: "a9",
      workspaceId: "w",
    }),
  ).toEqual({ kind: "recoverable", name: "Triage FLE-1", branch: "anh/fle-1" });
});

test("inspects a workspace that cannot come back, or is not archived", async () => {
  const fake = new FakeDaemon(false);
  const adapter = createHistoryAdapter(fake);
  expect(
    await adapter.inspectWorkspace({ id: "a9", workspaceId: "w" }),
  ).toEqual({ kind: "active" });
  expect(await adapter.inspectWorkspace({ id: "a9" })).toEqual({
    kind: "active",
  });
  fake.recovery = (workspaceId) => ({
    kind: "unavailable",
    workspaceId,
    reason: "workspace_directory_missing",
    message: "The worktree directory no longer exists",
  });
  expect(
    await adapter.inspectWorkspace({ id: "a9", workspaceId: "w" }),
  ).toEqual({
    kind: "unavailable",
    message: "The worktree directory no longer exists",
  });
});
