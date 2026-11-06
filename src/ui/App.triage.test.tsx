import { expect, it } from "vitest";
import { rowText, settle, setup } from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";
import { createModifierHold } from "./input/modifier-hold.js";
import type { AttentionNotification } from "./notify/attention-notifier.js";

const tool = (id: string) => ({
  id,
  provider: "codex",
  name: "Bash",
  kind: "tool" as const,
});
const unread = (reason: "finished" | "error", at: string) => ({
  requiresAttention: true,
  attentionReason: reason,
  attentionTimestamp: at,
});
function inWorkspace(id: string, workspaceId: string, extra = {}) {
  return agent(id, {
    title: `${id} agent`,
    cwd: `/repo/${workspaceId}`,
    workspaceId,
    ...extra,
  });
}

it("regroups the sidebar by status with S, act-first, with a pending count", async () => {
  const { app, test } = await setup([
    inWorkspace("alpha", "one"),
    inWorkspace("beta", "two", {
      pendingPermissions: [tool("t1"), tool("t2")],
    }),
    inWorkspace("gamma", "three", { status: "running" }),
  ]);
  expect(app.lastFrame()).not.toContain("Needs input");
  expect(rowText(test, "workspace:two")).toContain("!2");
  app.stdin.write("S");
  await settle();
  const frame = app.lastFrame();
  expect(frame).toContain("Needs input");
  expect(frame).toContain("Running");
  expect(frame).toContain("Idle");
  const y = (id: string) =>
    test.renderer.root.findDescendantById(`workspace:${id}`)?.y ?? -1;
  expect(y("two")).toBeLessThan(y("three"));
  expect(y("three")).toBeLessThan(y("one"));
  for (const key of ["g", "g", "j"]) app.stdin.write(key);
  await settle();
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("hello gamma");
  app.stdin.write("S");
  await settle();
  expect(app.lastFrame()).not.toContain("Needs input");
});

it("jumps with U to the most urgent agent waiting on you, then the next", async () => {
  const { app } = await setup([
    inWorkspace("alpha", "one"),
    inWorkspace("beta", "two", unread("finished", "2026-11-04T00:00:09Z")),
    inWorkspace("gamma", "three", unread("error", "2026-11-04T00:00:01Z")),
  ]);
  app.stdin.write("U");
  await settle();
  expect(app.lastFrame()).toContain("hello gamma");
  app.stdin.write("U");
  await settle();
  expect(app.lastFrame()).toContain("hello beta");
});

it("lists agents that need you first in the Command Center", async () => {
  const { app } = await setup([
    inWorkspace("alpha", "one"),
    inWorkspace("beta", "two", { pendingPermissions: [tool("t1")] }),
  ]);
  app.stdin.write(":");
  await settle();
  const frame = app.lastFrame();
  expect(frame).toContain("Needs you");
  expect(frame).toContain("Needs permission: Bash");
  expect(frame.indexOf("Needs you")).toBeLessThan(frame.indexOf("Agents"));
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("hello beta");
});

it("raises a notification for new waits unless you are looking at that agent", async () => {
  const sent: AttentionNotification[] = [];
  const { app, agentsPort, test } = await setup(
    [inWorkspace("alpha", "one"), inWorkspace("beta", "two")],
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { notify: (notification) => sent.push(notification) },
  );
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha");
  agentsPort.handler?.({
    kind: "upsert",
    agent: inWorkspace("beta", "two", { pendingPermissions: [tool("t1")] }),
  });
  agentsPort.handler?.({
    kind: "upsert",
    agent: inWorkspace("alpha", "one", { pendingPermissions: [tool("t2")] }),
  });
  await settle();
  expect(sent).toEqual([
    { agentId: "beta", title: "beta agent", body: "Needs permission: Bash" },
  ]);
  test.renderer.emit("blur");
  agentsPort.handler?.({
    kind: "upsert",
    agent: inWorkspace("alpha", "one", { pendingPermissions: [tool("t3")] }),
  });
  await settle();
  expect(sent.map((notification) => notification.agentId)).toEqual([
    "beta",
    "alpha",
  ]);
});

it("shows branch, diff size, and PR checks under a workspace row", async () => {
  const { app, updateWorkspace } = await setup([inWorkspace("alpha", "one")]);
  updateWorkspace("one", {
    gitRuntime: { currentBranch: "feat-login" },
    diffStat: { additions: 3, deletions: 1 },
    githubRuntime: {
      pullRequest: {
        number: 7,
        url: "https://example.test/7",
        title: "Login",
        state: "OPEN",
        baseRefName: "main",
        headRefName: "feat-login",
        isMerged: false,
        checksStatus: "failure",
      },
    },
  });
  await settle();
  expect(app.lastFrame()).toContain("⎇ feat-login · +3 −1 · #7 ✗");
});

/** Command on macOS, Alt elsewhere. */
const jump = process.platform === "darwin" ? { super: true } : { meta: true };
it("opens workspaces by position with Cmd/Alt-digit and [ ], and tabs with digits", async () => {
  const { app, test } = await setup(
    [
      inWorkspace("alpha", "one"),
      inWorkspace("alpha2", "one"),
      inWorkspace("beta", "two"),
      inWorkspace("gamma", "three"),
    ],
    24,
    true,
  );
  test.mockInput.pressKey("2", jump);
  await settle();
  expect(app.lastFrame()).toContain("hello beta");
  app.stdin.write("]");
  await settle();
  expect(app.lastFrame()).toContain("hello gamma");
  app.stdin.write("]");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha");
  app.stdin.write("[");
  await settle();
  expect(app.lastFrame()).toContain("hello gamma");
  test.mockInput.pressKey("1", jump);
  await settle();
  app.stdin.write("2");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha2");
  app.stdin.write("1");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha");
  expect(app.lastFrame()).not.toContain("hello alpha2");
});

it("shows a failed worktree setup under the workspace row", async () => {
  const { app, updateWorkspace } = await setup([inWorkspace("alpha", "one")]);
  updateWorkspace("one", {
    setupStatus: "failed",
    gitRuntime: { currentBranch: "feat-login" },
  });
  await settle();
  expect(app.lastFrame()).toContain("⎇ feat-login · setup failed");
});

it("shows each workspace's jump number while the jump modifier is held", async () => {
  const fire: (() => void)[] = [];
  const hold = createModifierHold(["super"], (run) => {
    fire.push(run);
    return () => {};
  });
  const { test } = await setup(
    [inWorkspace("alpha", "one"), inWorkspace("beta", "two")],
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { positionHints: hold },
  );
  expect(rowText(test, "workspace:two")).not.toMatch(/2\s*$/);
  hold.input("\u001b[57444;9u");
  for (const run of fire.splice(0)) run();
  await settle();
  expect(rowText(test, "workspace:one")).toMatch(/one\s+1\s*$/);
  expect(rowText(test, "workspace:two")).toMatch(/two\s+2\s*$/);
  hold.input("\u001b[57444;1:3u");
  await settle();
  expect(rowText(test, "workspace:two")).not.toMatch(/2\s*$/);
});
