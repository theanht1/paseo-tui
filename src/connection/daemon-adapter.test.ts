import type { createHostClient } from "@getpaseo/client/node";
import type { AgentProviderNotice } from "@getpaseo/protocol/agent-types";
import { expect, test } from "vitest";
import {
  createCompletionAdapter,
  createDaemonAdapter,
  createDirectoryAdapter,
  createGitAdapter,
  createSubagentAdapter,
  DRAFT_COMMANDS_AGENT_ID,
} from "./daemon-adapter.js";

type Daemon = Pick<
  ReturnType<typeof createHostClient>,
  | "cancelAgent"
  | "setAgentMode"
  | "setAgentModel"
  | "updateAgent"
  | "clearAgentAttention"
>;
class FakeDaemon implements Daemon {
  calls: unknown[][] = [];
  notice: AgentProviderNotice | null = null;
  async cancelAgent(id: string) {
    this.calls.push(["cancel", id]);
  }
  async setAgentMode(id: string, mode: string) {
    this.calls.push(["mode", id, mode]);
    return this.notice;
  }
  async setAgentModel(id: string, model: string | null) {
    this.calls.push(["model", id, model]);
  }
  async updateAgent(id: string, updates: { name?: string }) {
    this.calls.push(["rename", id, updates]);
  }
  async clearAgentAttention(id: string | string[]) {
    this.calls.push(["attention", id]);
  }
}
test.each(["info", "warning"] as const)(
  "returns %s mode notices",
  async (type) => {
    const fake = new FakeDaemon();
    fake.notice = { type, message: "Mode changed" };
    expect(await createDaemonAdapter(fake).setAgentMode("a", "ask")).toBe(
      "Mode changed",
    );
    expect(fake.calls).toEqual([["mode", "a", "ask"]]);
  },
);
test("rejects error notices and returns null without a notice", async () => {
  const fake = new FakeDaemon();
  const adapter = createDaemonAdapter(fake);
  expect(await adapter.setAgentMode("a", "ask")).toBeNull();
  fake.notice = { type: "error", message: "Unsupported mode" };
  await expect(adapter.setAgentMode("a", "ask")).rejects.toThrow(
    "Unsupported mode",
  );
});
test("forwards ids, trims names and rejects empty names before RPC", async () => {
  const fake = new FakeDaemon();
  const adapter = createDaemonAdapter(fake);
  await adapter.cancelAgent("a");
  await adapter.setAgentModel("b", "model");
  await adapter.renameAgent("c", "  New name  ");
  await adapter.clearAgentAttention("e");
  await expect(adapter.renameAgent("d", " \t ")).rejects.toThrow(
    "Name can't be empty",
  );
  expect(fake.calls).toEqual([
    ["cancel", "a"],
    ["model", "b", "model"],
    ["rename", "c", { name: "New name" }],
    ["attention", "e"],
  ]);
});
test("requires explicit project, workspace and provider snapshot capabilities before any RPC", async () => {
  const { requireWorkspaceCapabilities } = await import("./daemon-adapter.js");
  const info = {
    status: "server_info" as const,
    serverId: "host",
    hostname: null,
    version: "0.15.0",
    features: {
      workspaceMultiplicity: true,
      workspaceTerminals: true,
      projectList: true,
      providersSnapshot: true,
    },
  };
  expect(() =>
    requireWorkspaceCapabilities({ getLastServerInfoMessage: () => info }),
  ).not.toThrow();
  for (const capability of [
    "workspaceMultiplicity",
    "workspaceTerminals",
    "projectList",
    "providersSnapshot",
  ]) {
    expect(() =>
      requireWorkspaceCapabilities({
        getLastServerInfoMessage: () => ({
          ...info,
          features: { ...info.features, [capability]: false },
        }),
      }),
    ).toThrow(/Update/);
  }
  expect(() =>
    requireWorkspaceCapabilities({ getLastServerInfoMessage: () => null }),
  ).toThrow(/Update/);
});
test("captures management capabilities once and forwards terminal rename errors", async () => {
  const { createManagementAdapter } = await import("./daemon-adapter.js");
  let reads = 0;
  const calls: { terminalId: string; title: string }[] = [];
  const adapter = createManagementAdapter({
    getLastServerInfoMessage() {
      reads++;
      return {
        status: "server_info",
        serverId: "s",
        hostname: null,
        version: null,
        features: {
          creationLifecycle: true,
          workspaceMultiplicity: true,
          workspaceTerminals: true,
        },
      };
    },
    async renameTerminal(input) {
      calls.push(input);
      return { requestId: "r", success: false, error: "Rename denied" };
    },
  });
  expect(adapter.capabilities).toEqual({
    create: true,
    thinking: false,
    workspace: true,
    terminal: true,
  });
  await expect(adapter.renameTerminal("t", "Name")).rejects.toThrow(
    "Rename denied",
  );
  expect(calls).toEqual([{ terminalId: "t", title: "Name" }]);
  expect(reads).toBe(1);
  const unsupported = createManagementAdapter({
    getLastServerInfoMessage: () => null,
    renameTerminal: async () => {
      throw Error("Should never call");
    },
  });
  await expect(unsupported.renameTerminal("t", "Name")).rejects.toThrow(
    /Update/,
  );
});

test("streams terminal replay, forwards resize and releases the observation", async () => {
  const { createTerminalStreamAdapter } = await import("./daemon-adapter.js");
  const input: unknown[] = [];
  let released = false;
  let receive: (event: import("@getpaseo/client").TerminalStreamEvent) => void =
    () => {};
  const adapter = createTerminalStreamAdapter({
    observeTerminal(_id, handler) {
      receive = handler;
      return {
        subscriptionId: "s",
        ready: Promise.resolve({
          terminalId: "t",
          subscriptionId: "s",
          requestId: "r",
          slot: 1,
          error: null,
        }),
        subscribe: () => () => {},
        async release() {
          released = true;
        },
      };
    },
    sendTerminalInput(id, message) {
      input.push({ id, message });
    },
  });
  const events: unknown[] = [];
  const stream = adapter.observe(
    "t",
    (event) => events.push(event),
    () => {},
  );
  await stream.ready;
  const output = {
    terminalId: "t",
    subscriptionId: "s",
    type: "output" as const,
    data: new Uint8Array([65]),
  };
  receive(output);
  expect(events).toEqual([output]);
  adapter.write("t", "hi");
  adapter.resize("t", 90, 30);
  expect(input).toEqual([
    { id: "t", message: { type: "input", data: "hi" } },
    {
      id: "t",
      message: { type: "resize", cols: 90, rows: 30, intent: "claim" },
    },
  ]);
  await stream.close();
  expect(released).toBe(true);
});

test("reports a terminal's process exit at once, and an exit error as an error", async () => {
  const { createTerminalStreamAdapter } = await import("./daemon-adapter.js");
  let update: (message: {
    type: "terminal_stream_exit";
    payload: { terminalId: string; error?: string };
  }) => void = () => {};
  const adapter = createTerminalStreamAdapter({
    observeTerminal() {
      return {
        subscriptionId: "s",
        ready: Promise.resolve({
          terminalId: "t",
          subscriptionId: "s",
          requestId: "r",
          slot: 1,
          error: null,
        }),
        subscribe(observer) {
          update = (message) => observer.update?.(message);
          return () => {};
        },
        async release() {},
      };
    },
    sendTerminalInput() {},
  });
  const seen: unknown[] = [];
  adapter.observe(
    "t",
    () => {},
    (error) => seen.push(["error", error]),
    () => seen.push("exit"),
  );
  update({ type: "terminal_stream_exit", payload: { terminalId: "t" } });
  update({
    type: "terminal_stream_exit",
    payload: { terminalId: "t", error: "spawn failed" },
  });
  expect(seen).toEqual(["exit", ["error", "spawn failed"]]);
});

test("lists agent slash commands and workspace files for prompt completion", async () => {
  const calls: unknown[] = [];
  const adapter = createCompletionAdapter({
    async listCommands(options: { agentId: string; draftConfig?: unknown }) {
      calls.push(["commands", options]);
      return {
        agentId: options.agentId,
        requestId: "r",
        error: null,
        commands: [
          {
            name: "review",
            description: "Review",
            argumentHint: "",
            kind: "skill" as const,
          },
          { name: "compact", description: "Compact", argumentHint: "" },
        ],
      };
    },
    async getDirectorySuggestions(options) {
      calls.push(["files", options]);
      return {
        requestId: "r",
        error: null,
        directories: ["src"],
        entries: [
          { path: "src", kind: "directory" as const },
          { path: "src/app.ts", kind: "file" as const },
        ],
      };
    },
  });
  expect(await adapter.commands({ kind: "agent", agentId: "a" })).toEqual([
    { name: "review", description: "Review", argumentHint: "", kind: "skill" },
    {
      name: "compact",
      description: "Compact",
      argumentHint: "",
      kind: "command",
    },
  ]);
  expect(await adapter.files("/repo", "sr")).toEqual([
    { path: "src", kind: "directory" },
    { path: "src/app.ts", kind: "file" },
  ]);
  await adapter.commands({
    kind: "draft",
    config: { provider: "claude", cwd: "/repo", model: "opus", modeId: "plan" },
  });
  expect(calls.pop()).toEqual([
    "commands",
    {
      agentId: DRAFT_COMMANDS_AGENT_ID,
      draftConfig: {
        provider: "claude",
        cwd: "/repo",
        model: "opus",
        modeId: "plan",
      },
    },
  ]);
  expect(calls).toEqual([
    ["commands", { agentId: "a" }],
    [
      "files",
      {
        query: "sr",
        cwd: "/repo",
        includeFiles: true,
        includeDirectories: true,
        matchMode: "fuzzy",
        limit: 50,
      },
    ],
  ]);
});

test("surfaces command and file listing errors", async () => {
  const adapter = createCompletionAdapter({
    async listCommands() {
      return {
        agentId: "a",
        requestId: "r",
        error: "no session",
        commands: [],
      };
    },
    async getDirectorySuggestions() {
      return { requestId: "r", error: "denied", directories: [], entries: [] };
    },
  });
  await expect(
    adapter.commands({ kind: "agent", agentId: "a" }),
  ).rejects.toThrow("no session");
  await expect(adapter.files("/repo", "")).rejects.toThrow("denied");
});

test("lists repository branches and the daemon-reported base ref for new worktrees", async () => {
  const calls: unknown[] = [];
  const adapter = createGitAdapter({
    async getBranchSuggestions(options) {
      calls.push(["branches", options]);
      return { branches: ["dev", "main"], error: null };
    },
    async getCheckoutStatus(cwd) {
      calls.push(["status", cwd]);
      return { isGit: true, baseRef: "origin/main", error: null };
    },
  });
  expect(await adapter.branches("/repo")).toEqual({
    branches: ["dev", "main"],
    baseRef: "origin/main",
  });
  expect(calls).toEqual([
    ["branches", { cwd: "/repo", limit: 200 }],
    ["status", "/repo"],
  ]);
  const failing = createGitAdapter({
    async getBranchSuggestions() {
      return { branches: [], error: "not a repository" };
    },
    async getCheckoutStatus() {
      return { isGit: false, baseRef: null, error: null };
    },
  });
  await expect(failing.branches("/x")).rejects.toThrow("not a repository");
});

test("gates provider subagents on server_info features and maps list, updates and timelines", async () => {
  const calls: unknown[] = [];
  const observed: { update?: (message: { type: string }) => void } = {};
  let released = 0;
  function daemon(features: Record<string, boolean>) {
    return {
      getLastServerInfoMessage: () => ({ features }),
      async listProviderSubagents(parentAgentId: string) {
        calls.push(["list", parentAgentId]);
        return {
          requestId: "r",
          parentAgentId,
          error: null,
          subagents: [],
        };
      },
      async fetchProviderSubagentTimeline(
        parentAgentId: string,
        subagentId: string,
        options: unknown,
      ) {
        calls.push(["timeline", parentAgentId, subagentId, options]);
        return {
          requestId: "r",
          parentAgentId,
          subagentId,
          provider: "claude",
          direction: "tail" as const,
          epoch: "e",
          reset: false,
          staleCursor: false,
          gap: false,
          window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
          hasOlder: false,
          hasNewer: false,
          rows: [],
          error: null,
        };
      },
      observeEvents(events: string[]) {
        calls.push(["observe", events]);
        return {
          subscribe(next: {
            snapshot(): void;
            update(message: { type: string }): void;
          }) {
            observed.update = next.update;
            return () => {
              observed.update = undefined;
            };
          },
          async release() {
            released++;
          },
        };
      },
    };
  }
  expect(createSubagentAdapter(daemon({}))).toBeNull();
  const adapter = createSubagentAdapter(daemon({ providerSubagents: true }));
  if (!adapter) throw Error("Expected subagent support");
  await adapter.list("parent");
  const updates: unknown[] = [];
  const stop = adapter.observe((update) => updates.push(update));
  const upsert = {
    type: "agent.provider_subagents.update",
    payload: { kind: "remove", parentAgentId: "parent", subagentId: "a" },
  };
  observed.update?.(upsert);
  observed.update?.({ type: "agent_update" });
  expect(updates).toEqual([upsert.payload]);
  stop();
  expect(released).toBe(1);
  await expect(
    adapter.timeline("parent", "a", { direction: "tail", limit: 5 }),
  ).rejects.toThrow(/projectedSubagentTimeline/);
  const full = createSubagentAdapter(
    daemon({ providerSubagents: true, projectedSubagentTimeline: true }),
  );
  await full?.timeline("parent", "a", { direction: "tail", limit: 5 });
  expect(calls).toEqual([
    ["list", "parent"],
    ["observe", ["agent.provider_subagents.update"]],
    ["timeline", "parent", "a", { direction: "tail", limit: 5 }],
  ]);
});

test("lists a path's directory through the file explorer, rooted at that directory", async () => {
  const calls: unknown[] = [];
  const port = createDirectoryAdapter({
    async listDirectory(cwd: string, path: string) {
      calls.push([cwd, path]);
      return {
        path: ".",
        entries: [
          {
            name: "a.ts",
            path: "a.ts",
            kind: "file" as const,
            size: 1,
            modifiedAt: "",
          },
          {
            name: "lib",
            path: "lib",
            kind: "directory" as const,
            size: 0,
            modifiedAt: "",
          },
        ],
      };
    },
  });
  expect(await port.list("~/repo/src")).toEqual([
    { name: "a.ts", kind: "file" },
    { name: "lib", kind: "directory" },
  ]);
  expect(calls).toEqual([["~/repo/src", "."]]);
});
