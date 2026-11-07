import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import { paneSubagents, popupRows } from "./subagent-popup.js";

const parent = agent("parent", { title: "Lead" });
const child = agent("child", {
  title: "Helper",
  labels: { "paseo.parent-agent-id": "parent" },
});
const task: ProviderSubagentDescriptorPayload = {
  id: "task",
  parentAgentId: "parent",
  provider: "claude",
  title: "Explore",
  description: null,
  status: "running",
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
  toolCallId: null,
};

it("derives the pane's subagents, the parent breadcrumb and nothing for plain agents", () => {
  const agents = [parent, child];
  expect(paneSubagents(parent, null, agents, [task])).toMatchObject({
    parent: null,
    parentId: "parent",
    pill: { text: "◆ 2 subagents · 1 working", running: true },
  });
  expect(
    paneSubagents(
      parent,
      { parentAgentId: "parent", subagentId: "task" },
      agents,
      [task],
    ),
  ).toMatchObject({
    parent: { agentId: "parent", label: "Lead" },
    parentId: "parent",
  });
  expect(paneSubagents(child, null, agents, [task])).toMatchObject({
    parent: { agentId: "parent", label: "Lead" },
    parentId: "child",
    entries: [],
  });
  expect(paneSubagents(agent("solo"), null, agents, [task])).toBeNull();
});

it("lists the parent first, then subagents, and clamps the cursor", () => {
  const view = paneSubagents(child, null, [parent, child], []);
  if (!view) throw Error("Expected a breadcrumb");
  const rows = popupRows(paneSubagents(parent, null, [parent, child], [task]));
  expect(rows.map((row) => row.key)).toEqual(["paseo:child", "provider:task"]);
  expect(popupRows(view).map((row) => [row.kind, row.label])).toEqual([
    ["parent", "Go to parent tab (Lead)"],
  ]);
});
