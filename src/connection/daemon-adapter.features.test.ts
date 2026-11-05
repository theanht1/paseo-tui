import type { AgentProviderNotice } from "@getpaseo/protocol/agent-types";
import { expect, test } from "vitest";
import {
  type AgentFeaturesDaemon,
  createAgentFeaturesAdapter,
} from "./daemon-adapter.js";
import type { ForkAttachment } from "./ports.js";

type Features = NonNullable<
  ReturnType<AgentFeaturesDaemon["getLastServerInfoMessage"]>
>["features"];
const ALL: Features = {
  agentHistorySearch: true,
  agentTimelinePromptIndex: true,
  rewind: true,
  agentForkContext: true,
  agentForkContextCursor: true,
  agentThinkingUpdate: true,
};
const attachment: ForkAttachment = {
  type: "text",
  mimeType: "text/plain",
  contextKind: "chat_history",
  title: "Chat history",
  text: "history",
};
class FakeDaemon implements AgentFeaturesDaemon {
  calls: unknown[][] = [];
  reads = 0;
  searchPages: {
    epoch: string;
    locations: { seq: number; role: "user" | "assistant" }[];
    nextCursor: number | null;
    error: string | null;
  }[] = [];
  notice: AgentProviderNotice | null = null;
  rewindError: string | null = null;
  forkAttachment: ForkAttachment | null = attachment;
  forkError: string | null = null;
  constructor(private features: Features) {}
  getLastServerInfoMessage() {
    this.reads++;
    return { features: this.features };
  }
  async searchAgentTimeline(options: {
    agentId: string;
    query: string;
    cursor?: number;
  }) {
    this.calls.push(["search", options]);
    const next = this.searchPages.shift();
    if (!next) throw Error("no page");
    return { requestId: "r", agentId: options.agentId, ...next };
  }
  async listAgentTimelinePrompts(agentId: string) {
    this.calls.push(["prompts", agentId]);
    return {
      requestId: "r",
      agentId,
      epoch: "e",
      prompts: [{ seq: 3, timestamp: "t", preview: "hello" }],
      error: null,
    };
  }
  async rewindAgent(
    agentId: string,
    messageId: string,
    mode: "conversation" | "files" | "both",
  ) {
    this.calls.push(["rewind", agentId, messageId, mode]);
    return {
      requestId: "r",
      agentId,
      ok: this.rewindError === null,
      error: this.rewindError,
    };
  }
  async buildAgentForkContext(
    agentId: string,
    options?: { boundaryCursor?: { epoch: string; seq: number } },
  ) {
    this.calls.push(["fork", agentId, options]);
    return {
      requestId: "r",
      agentId,
      attachment: this.forkAttachment,
      itemCount: 1,
      boundaryCursor: options?.boundaryCursor ?? null,
      boundaryMessageId: null,
      error: this.forkError,
    };
  }
  async setAgentThinkingOption(agentId: string, optionId: string | null) {
    this.calls.push(["thinking", agentId, optionId]);
    return this.notice;
  }
}

test("hides every feature the daemon does not advertise, reading server_info once", () => {
  const fake = new FakeDaemon({});
  const adapter = createAgentFeaturesAdapter(fake);
  expect(adapter).toEqual({
    search: null,
    prompts: null,
    rewind: null,
    forkContext: null,
    setThinking: null,
  });
  expect(fake.reads).toBe(1);
  const cursorless = createAgentFeaturesAdapter(
    new FakeDaemon({ agentForkContext: true }),
  );
  expect(cursorless.forkContext).toBeNull();
});

test("collects every search page into one ordered result", async () => {
  const fake = new FakeDaemon(ALL);
  fake.searchPages = [
    {
      epoch: "e",
      locations: [
        { seq: 2, role: "user" },
        { seq: 9, role: "assistant" },
      ],
      nextCursor: 9,
      error: null,
    },
    {
      epoch: "e",
      locations: [{ seq: 14, role: "assistant" }],
      nextCursor: null,
      error: null,
    },
  ];
  const search = createAgentFeaturesAdapter(fake).search;
  if (!search) throw Error("search expected");
  expect(await search("a", "needle")).toEqual({
    epoch: "e",
    seqs: [2, 9, 14],
    truncated: false,
  });
  expect(fake.calls).toEqual([
    ["search", { agentId: "a", query: "needle" }],
    ["search", { agentId: "a", query: "needle", cursor: 9 }],
  ]);
});

test("stops after five search pages and rejects errors or epoch changes", async () => {
  const fake = new FakeDaemon(ALL);
  const search = createAgentFeaturesAdapter(fake).search;
  if (!search) throw Error("search expected");
  fake.searchPages = Array.from({ length: 6 }, (_, index) => ({
    epoch: "e",
    locations: [{ seq: index + 1, role: "user" as const }],
    nextCursor: index + 1,
    error: null,
  }));
  expect(await search("a", "x")).toEqual({
    epoch: "e",
    seqs: [1, 2, 3, 4, 5],
    truncated: true,
  });
  fake.searchPages = [
    { epoch: "", locations: [], nextCursor: null, error: "Agent not found" },
  ];
  await expect(search("a", "x")).rejects.toThrow("Agent not found");
  fake.searchPages = [
    { epoch: "e", locations: [], nextCursor: 1, error: null },
    { epoch: "f", locations: [], nextCursor: null, error: null },
  ];
  await expect(search("a", "x")).rejects.toThrow(/History changed/);
});

test("forwards rewind, fork context and thinking, surfacing daemon errors", async () => {
  const fake = new FakeDaemon(ALL);
  const adapter = createAgentFeaturesAdapter(fake);
  if (
    !adapter.prompts ||
    !adapter.rewind ||
    !adapter.forkContext ||
    !adapter.setThinking
  )
    throw Error("features expected");
  expect(await adapter.prompts("a")).toEqual({
    epoch: "e",
    prompts: [{ seq: 3, timestamp: "t", preview: "hello" }],
  });
  await adapter.rewind("a", "m1", "both");
  fake.rewindError = "Provider does not support rewinding both";
  await expect(adapter.rewind("a", "m1", "both")).rejects.toThrow(
    "Provider does not support rewinding both",
  );
  expect(await adapter.forkContext("a", { epoch: "e", seq: 4 })).toEqual(
    attachment,
  );
  expect(await adapter.forkContext("a", null)).toEqual(attachment);
  fake.forkAttachment = null;
  fake.forkError = "Selected timeline position is no longer available.";
  await expect(adapter.forkContext("a", null)).rejects.toThrow(
    "no longer available",
  );
  fake.notice = { type: "info", message: "Thinking set" };
  expect(await adapter.setThinking("a", "high")).toBe("Thinking set");
  fake.notice = { type: "error", message: "Unsupported" };
  await expect(adapter.setThinking("a", "high")).rejects.toThrow("Unsupported");
  expect(fake.calls.filter((call) => call[0] !== "prompts")).toEqual([
    ["rewind", "a", "m1", "both"],
    ["rewind", "a", "m1", "both"],
    ["fork", "a", { boundaryCursor: { epoch: "e", seq: 4 } }],
    ["fork", "a", {}],
    ["fork", "a", {}],
    ["thinking", "a", "high"],
    ["thinking", "a", "high"],
  ]);
});
