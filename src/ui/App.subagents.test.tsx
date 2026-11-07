import { RGBA } from "@opentui/core";
import { describe, expect, it } from "vitest";
import type { ProviderSubagentUpdate } from "../connection/ports.js";
import { createProviderSubagentStore } from "../state/provider-subagents.js";
import {
  agents,
  rowText,
  settle,
  settleUntil,
  setup,
} from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";
import { BINDINGS } from "./input/bindings.js";
import { createTheme } from "./render/theme.js";

describe("subagents", () => {
  function providerStore() {
    const listed: string[] = [];
    const push: { handler: ((update: ProviderSubagentUpdate) => void) | null } =
      { handler: null };
    const store = createProviderSubagentStore({
      async list(parentAgentId) {
        listed.push(parentAgentId);
        return parentAgentId === "alpha"
          ? [
              {
                id: "task",
                parentAgentId: "alpha",
                provider: "claude",
                title: "Explore",
                description: "Find the parser",
                status: "running",
                createdAt: "2026-11-03T00:00:05Z",
                updatedAt: "2026-11-03T00:00:05Z",
                toolCallId: null,
              },
            ]
          : [];
      },
      observe(handler) {
        push.handler = handler;
        return () => {};
      },
      async timeline() {
        return {
          epoch: "e",
          error: null,
          reset: false,
          staleCursor: false,
          gap: false,
          hasNewer: false,
          endCursor: { epoch: "e", seq: 1 },
          window: { minSeq: 1, maxSeq: 1, nextSeq: 2 },
          rows: [
            {
              seq: 1,
              timestamp: "2026-11-03T00:00:06Z",
              item: { type: "assistant_message", text: "parser lives in src" },
            },
          ],
        };
      },
    });
    return { store, listed, push };
  }
  const family = [
    ...agents,
    agent("helper", {
      title: "Helper agent",
      cwd: "/repo/one",
      workspaceId: "one",
      labels: { "paseo.parent-agent-id": "alpha" },
      createdAt: "2026-11-03T00:00:01Z",
    }),
  ];
  function selectedTab(
    test: Awaited<ReturnType<typeof setup>>["test"],
    key: string,
  ) {
    const tab = test.renderer.root.findDescendantById(`tab:${key}`);
    if (!tab) return null;
    const label = rowText(test, `tab:${key}`);
    const span = test
      .captureSpans()
      .lines[tab.y]?.spans.find(
        (candidate) =>
          label.includes(candidate.text.trim()) && candidate.text.trim(),
      );
    const active = RGBA.fromHex(createTheme({}).tabActiveBg);
    return (
      span?.bg.toInts().slice(0, 3).join(",") ===
      active.toInts().slice(0, 3).join(",")
    );
  }
  it("opens subagents in their own tabs, keeps the parent tab, and refocuses an open one", async () => {
    const provider = providerStore();
    const { app, test } = await setup(
      family,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      { subagents: provider.store },
    );
    app.stdin.write("\r");
    await settle();
    expect(provider.listed).toContain("alpha");
    expect(app.lastFrame()).toContain("◆ 2 subagents · 1 working");
    app.stdin.write("s");
    await settle();
    expect(app.lastFrame()).toContain("Subagents");
    expect(rowText(test, "subagent-row:0")).toContain("Helper agent");
    expect(rowText(test, "subagent-row:0")).toContain("done");
    expect(rowText(test, "subagent-row:1")).toContain("Find the parser");
    expect(rowText(test, "subagent-row:1")).toContain("working");
    app.stdin.write("j");
    app.stdin.write("\r");
    await settleUntil(() => app.lastFrame(), "parser lives in src");
    expect(app.lastFrame()).toContain("parser lives in src");
    expect(app.lastFrame()).not.toContain("hello alpha");
    expect(rowText(test, "tab:subagent:alpha:task")).toContain("◆ Explore");
    expect(selectedTab(test, "subagent:alpha:task")).toBe(true);
    expect(
      test.renderer.root.findDescendantById("tab:agent:alpha"),
    ).toBeTruthy();
    const pill = test.renderer.root.findDescendantById("subagent-pill");
    if (!pill) throw Error("Missing pill");
    await test.mockMouse.click(pill.x + 1, pill.y);
    await settle();
    expect(rowText(test, "subagent-row:0")).toContain("Go to parent tab");
    app.stdin.write("\r");
    await settleUntil(() => app.lastFrame(), "hello alpha");
    expect(app.lastFrame()).toContain("hello alpha");
    expect(selectedTab(test, "agent:alpha")).toBe(true);
    expect(
      test.renderer.root.findDescendantById("tab:subagent:alpha:task"),
    ).toBeTruthy();
    app.stdin.write("s");
    await settle();
    app.stdin.write("j");
    app.stdin.write("\r");
    await settleUntil(() => app.lastFrame(), "parser lives in src");
    expect(app.lastFrame()).toContain("parser lives in src");
    expect(app.lastFrame().split("◆ Explore").length).toBe(2);
    expect(selectedTab(test, "subagent:alpha:task")).toBe(true);
    app.stdin.write("Z");
    app.stdin.write("Q");
    await settle();
    expect(app.lastFrame()).not.toContain("Close tab?");
    expect(
      test.renderer.root.findDescendantById("tab:subagent:alpha:task"),
    ).toBeFalsy();
    expect(app.lastFrame()).toContain("hello alpha");
    app.stdin.write("s");
    await settle();
    const helper = test.renderer.root.findDescendantById("subagent-row:0");
    if (!helper) throw Error("Missing helper row");
    await test.mockMouse.click(helper.x + 2, helper.y);
    await settle();
    expect(app.lastFrame()).toContain("hello helper");
    expect(selectedTab(test, "agent:helper")).toBe(true);
    expect(
      test.renderer.root.findDescendantById("tab:agent:alpha"),
    ).toBeTruthy();
  });
  it("lists the subagents shortcut and Command Center action", async () => {
    const { app } = await setup(family);
    app.stdin.write("?");
    await settle();
    app.stdin.write("/");
    await settle();
    app.stdin.write("subagents");
    await settle();
    expect(app.lastFrame()).toContain("Subagents");
    expect(
      BINDINGS.some(
        (b) => b.keys === "s" && b.action.type === "subagents.open",
      ),
    ).toBe(true);
  });
});
