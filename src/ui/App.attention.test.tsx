import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { expect, it } from "vitest";
import { rowText, settle, setup } from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";

const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
it("hints i or a in the normal-mode prompt placeholder and types after a", async () => {
  const { app, ports } = await setup();
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("Press i or a to message Alpha agent");
  app.stdin.write("a");
  await settle();
  expect(app.lastFrame()).not.toContain("Press i or a");
  expect(app.lastFrame()).toContain("Message Alpha agent…");
  for (const key of ["h", "i", "\r"]) app.stdin.write(key);
  await settle();
  expect(ports.get("alpha")?.sent).toEqual(["hi"]);
});
it("prefixes a workspace and its tab with ? for a pending question, above permission and working", async () => {
  const question = {
    id: "q",
    provider: "codex",
    name: "AskUserQuestion",
    kind: "question" as const,
  };
  const tool = {
    id: "t",
    provider: "codex",
    name: "Bash",
    kind: "tool" as const,
  };
  const { test } = await setup([
    agent("alpha", {
      title: "Alpha agent",
      cwd: "/repo/one",
      workspaceId: "one",
      status: "running",
      pendingPermissions: [question],
    }),
    agent("beta", {
      title: "Beta agent",
      cwd: "/repo/one",
      workspaceId: "one",
      pendingPermissions: [tool],
    }),
    agent("gamma", {
      title: "Gamma agent",
      cwd: "/repo/two",
      workspaceId: "two",
      status: "running",
      pendingPermissions: [tool],
    }),
  ]);
  expect(rowText(test, "workspace:one")).toMatch(/^\W*\?2 /);
  expect(rowText(test, "tab:agent:alpha")).toContain("? ❯ Alpha agent");
  expect(rowText(test, "tab:agent:beta")).toContain("! ❯ Beta agent");
  expect(rowText(test, "workspace:two")).toContain("!");
  expect(rowText(test, "workspace:two")).not.toMatch(SPINNER);
});
it("prefixes workspaces and tabs with working and unread indicators and clears unread when viewed", async () => {
  const unread = {
    requiresAttention: true,
    attentionReason: "finished" as const,
    attentionTimestamp: "2026-11-04T00:00:05Z",
  };
  const { app, test, agentsPort, cleared } = await setup([
    agent("alpha", {
      title: "Alpha agent",
      cwd: "/repo/one",
      workspaceId: "one",
    }),
    agent("beta", {
      title: "Beta agent",
      cwd: "/repo/one",
      workspaceId: "one",
      ...unread,
    }),
    agent("gamma", {
      title: "Gamma agent",
      cwd: "/repo/two",
      workspaceId: "two",
      status: "running",
    }),
  ]);
  expect(rowText(test, "workspace:one")).toContain("●");
  expect(rowText(test, "workspace:two")).toMatch(SPINNER);
  expect(rowText(test, "tab:agent:beta")).toContain("●");
  expect(rowText(test, "tab:agent:alpha")).not.toContain("●");
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha");
  expect(rowText(test, "tab:agent:beta")).toContain("●");
  expect(cleared).toEqual([]);
  app.stdin.write("g");
  app.stdin.write("t");
  await settle();
  expect(app.lastFrame()).toContain("hello beta");
  expect(rowText(test, "tab:agent:beta")).not.toContain("●");
  expect(rowText(test, "workspace:one")).not.toContain("●");
  expect(cleared).toEqual(["beta"]);
  agentsPort.handler?.({
    kind: "upsert",
    agent: agent("alpha", {
      title: "Alpha agent",
      cwd: "/repo/one",
      workspaceId: "one",
      status: "running",
    }),
  });
  await settle();
  expect(rowText(test, "tab:agent:alpha")).toMatch(SPINNER);
  expect(rowText(test, "workspace:one")).toMatch(SPINNER);
  agentsPort.handler?.({
    kind: "upsert",
    agent: agent("alpha", {
      title: "Alpha agent",
      cwd: "/repo/one",
      workspaceId: "one",
      ...unread,
      attentionTimestamp: "2026-11-04T00:00:09Z",
    }),
  });
  await settle();
  expect(rowText(test, "tab:agent:alpha")).toContain("●");
  expect(rowText(test, "workspace:one")).toContain("●");
  app.stdin.write("g");
  app.stdin.write("T");
  await settle();
  expect(rowText(test, "tab:agent:alpha")).not.toContain("●");
  expect(cleared).toEqual(["beta", "alpha"]);
});

it("answers an AskUserQuestion turn with keys and mouse and sends answers keyed by header", async () => {
  const input = {
    questions: [
      {
        question: "Which database should we use?",
        header: "Database",
        multiSelect: false,
        allowOther: true,
        options: [
          { label: "Postgres", description: "Relational" },
          { label: "SQLite", description: "Embedded" },
        ],
      },
      {
        question: "Which features do you want?",
        header: "Features",
        multiSelect: true,
        allowOther: true,
        options: [{ label: "Auth" }, { label: "Billing" }, { label: "Search" }],
      },
    ],
  };
  const request: AgentPermissionRequest = {
    id: "ask",
    provider: "claude",
    name: "AskUserQuestion",
    kind: "question",
    input,
  };
  const { app, ports, test } = await setup(
    [agent("alpha", { pendingPermissions: [request] })],
    30,
  );
  app.stdin.write("\r");
  await settle();
  const frame = app.lastFrame();
  expect(frame).toContain("Which database should we use?");
  expect(frame).toContain("1. Postgres");
  expect(frame).toContain("Relational");
  expect(frame).toContain("3. Other");
  expect(frame).toContain("Submit");
  app.stdin.write("2");
  await settle();
  expect(app.lastFrame()).toContain("Which features do you want?");
  app.stdin.write("4");
  await settle();
  for (const key of ["q", "W", "?", ":"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("Other: qW?:");
  expect(app.lastFrame()).not.toContain("Command Center");
  expect(app.lastFrame()).not.toContain("Shortcuts");
  app.stdin.write("\u001b");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  const port = ports.get("alpha");
  if (!port) throw Error("alpha timeline was not opened");
  expect(port.responses).toEqual([]);
  const auth = test.renderer.root.findDescendantById("question-option:0");
  if (!auth) throw Error("Missing Auth option");
  await test.mockMouse.click(auth.x + 2, auth.y);
  await settle();
  const submit = test.renderer.root.findDescendantById("question-submit");
  if (!submit) throw Error("Missing Submit");
  await test.mockMouse.click(submit.x + 1, submit.y);
  await settle();
  expect(port.responses).toEqual([
    {
      id: "ask",
      response: {
        behavior: "allow",
        updatedInput: {
          ...input,
          answers: { Database: "SQLite", Features: "Auth, qW?:" },
        },
      },
    },
  ]);
  port.requestPermission({ ...request, id: "again" });
  await settle();
  app.stdin.write("\u001b");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  expect(port.responses.at(-1)).toEqual({
    id: "again",
    response: { behavior: "deny", message: "Dismissed by user" },
  });
});
