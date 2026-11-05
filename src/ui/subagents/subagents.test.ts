import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import {
  parentAgentId,
  providerHeader,
  subagentBucket,
  subagentPill,
  subagentRow,
  subagentsOf,
} from "./subagents.js";

const PARENT = { "paseo.parent-agent-id": "parent" };
function descriptor(
  id: string,
  overrides: Partial<ProviderSubagentDescriptorPayload> = {},
): ProviderSubagentDescriptorPayload {
  return {
    id,
    parentAgentId: "parent",
    provider: "claude",
    title: `Task ${id}`,
    description: null,
    status: "completed",
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: "2026-11-04T00:00:00Z",
    toolCallId: null,
    ...overrides,
  };
}

it("collects delegated Paseo agents and top-level provider subagents of a parent by creation time", () => {
  const delegated = agent("child", {
    labels: PARENT,
    createdAt: "2026-11-04T00:00:02Z",
  });
  const entries = subagentsOf(
    "parent",
    [
      delegated,
      agent("archived", { labels: PARENT, archivedAt: "2026-11-04T00:00:09Z" }),
      agent("unrelated", { labels: { "paseo.parent-agent-id": "other" } }),
      agent("parent"),
    ],
    [
      descriptor("late", { createdAt: "2026-11-04T00:00:05Z" }),
      descriptor("early", { createdAt: "2026-11-04T00:00:01Z" }),
      descriptor("nested", { parentSubagentId: "early" }),
      descriptor("elsewhere", { parentAgentId: "other" }),
    ],
  );
  expect(
    entries.map((entry) =>
      entry.kind === "paseo" ? entry.agent.id : entry.descriptor.id,
    ),
  ).toEqual(["early", "child", "late"]);
  expect(parentAgentId(delegated)).toBe("parent");
  expect(parentAgentId(agent("root"))).toBeNull();
});

it("maps status the way the Paseo app buckets subagents", () => {
  expect(
    subagentBucket({
      kind: "provider",
      descriptor: descriptor("a", { status: "running" }),
    }),
  ).toBe("running");
  expect(
    subagentBucket({
      kind: "provider",
      descriptor: descriptor("a", { status: "failed" }),
    }),
  ).toBe("failed");
  expect(
    subagentBucket({
      kind: "provider",
      descriptor: descriptor("a", { status: "canceled" }),
    }),
  ).toBe("done");
  expect(
    subagentBucket({
      kind: "paseo",
      agent: agent("p", {
        pendingPermissions: [
          { id: "q", provider: "codex", name: "Ask", kind: "question" },
        ],
      }),
    }),
  ).toBe("needs_input");
  expect(
    subagentBucket({ kind: "paseo", agent: agent("p", { status: "error" }) }),
  ).toBe("failed");
  expect(
    subagentBucket({
      kind: "paseo",
      agent: agent("p", {
        requiresAttention: true,
        attentionReason: "finished",
      }),
    }),
  ).toBe("attention");
});

it("labels rows by description then title and summarizes the pill by active buckets", () => {
  expect(
    subagentRow({
      kind: "provider",
      descriptor: descriptor("a", {
        title: "Explore",
        description: "Find the parser",
        status: "running",
      }),
    }),
  ).toEqual({
    key: "provider:a",
    label: "Find the parser",
    subtitle: "Explore",
    bucket: "running",
  });
  expect(
    subagentRow({
      kind: "provider",
      descriptor: descriptor("b", { title: "New agent" }),
    }).label,
  ).toBe("Subagent");
  const running = {
    kind: "provider" as const,
    descriptor: descriptor("r", { status: "running" }),
  };
  const failed = {
    kind: "provider" as const,
    descriptor: descriptor("f", { status: "failed" }),
  };
  const done = { kind: "provider" as const, descriptor: descriptor("d") };
  expect(subagentPill([done])).toEqual({
    text: "◆ 1 subagent",
    running: false,
  });
  expect(subagentPill([running, failed, done, done])).toEqual({
    text: "◆ 4 subagents · 1 failed, 1 working",
    running: true,
  });
});

it("describes a provider subagent's chat header from its descriptor", () => {
  expect(
    providerHeader(
      descriptor("a", { status: "failed", description: "Fix it", cwd: null }),
      "/repo",
    ),
  ).toEqual({
    id: "a",
    title: "Fix it",
    provider: "claude",
    model: null,
    availableModes: [],
    currentModeId: null,
    status: "error",
    cwd: "/repo",
    activeTurn: null,
  });
  expect(
    providerHeader(
      descriptor("b", { status: "running", cwd: "/tree" }),
      "/repo",
    ),
  ).toMatchObject({
    status: "running",
    cwd: "/tree",
  });
});
