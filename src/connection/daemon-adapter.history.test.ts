import type { PaseoAgent } from "@getpaseo/client";
import { expect, test } from "vitest";
import { agent } from "../test/fixtures.js";
import { createHistoryAdapter, type HistoryDaemon } from "./daemon-adapter.js";

class FakeDaemon implements HistoryDaemon {
  requests: unknown[] = [];
  refreshed: string[] = [];
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

test("unarchive refreshes the agent", async () => {
  const fake = new FakeDaemon(false);
  await createHistoryAdapter(fake).unarchive("a9");
  expect(fake.refreshed).toEqual(["a9"]);
});
