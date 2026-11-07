import { expect, it } from "vitest";
import { rowText, settle, setup } from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";

const UNREAD = {
  requiresAttention: true,
  attentionReason: "finished" as const,
  attentionTimestamp: "2026-11-06T00:00:05Z",
};
const alpha = (extra = {}) =>
  agent("alpha", {
    title: "Alpha agent",
    cwd: "/repo/one",
    workspaceId: "one",
    ...extra,
  });
const beta = (extra = {}) =>
  agent("beta", {
    title: "Beta agent",
    cwd: "/repo/one",
    workspaceId: "one",
    ...extra,
  });
const gamma = (extra = {}) =>
  agent("gamma", {
    title: "Gamma agent",
    cwd: "/repo/two",
    workspaceId: "two",
    ...extra,
  });

async function open(
  agents = [alpha(), beta(), gamma()],
  options: { supported?: boolean; error?: Error } = {},
) {
  const calls: string[] = [];
  let upsert: (marked: ReturnType<typeof alpha>) => void = () => {};
  const harness = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {
      workspaceRead: {
        canMarkUnread: () => options.supported !== false,
        async markRead(ids) {
          calls.push(`read ${ids.join(",")}`);
        },
        async markUnread(id) {
          calls.push(`unread ${id}`);
          if (options.error) throw options.error;
          upsert(alpha(UNREAD));
        },
      },
    },
  );
  upsert = (marked) =>
    harness.agentsPort.handler?.({ kind: "upsert", agent: marked });
  return { ...harness, calls };
}
async function palette(
  app: Awaited<ReturnType<typeof open>>["app"],
  query: string,
) {
  app.stdin.write(":");
  await settle();
  app.stdin.write(query);
  await settle();
  app.stdin.write("\r");
  await settle();
}

it("keeps the workspace you are viewing unread until you leave and come back", async () => {
  const { app, test, calls } = await open();
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha");
  await palette(app, "Mark as unread");
  expect(calls).toEqual(["unread one"]);
  expect(rowText(test, "tab:agent:alpha")).toContain("●");
  expect(rowText(test, "workspace:one")).toContain("●");
  app.stdin.write("g");
  app.stdin.write("t");
  await settle();
  expect(app.lastFrame()).toContain("hello beta");
  expect(rowText(test, "tab:agent:alpha")).toContain("●");
  app.stdin.write("g");
  app.stdin.write("T");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha");
  expect(rowText(test, "tab:agent:alpha")).not.toContain("●");
  expect(rowText(test, "workspace:one")).not.toContain("●");
});

it("marks the workspace under the sidebar cursor read with m, but not a running one", async () => {
  const { app, test, calls } = await open([
    alpha(),
    beta(UNREAD),
    gamma({ status: "running" }),
  ]);
  app.stdin.write("m");
  await settle();
  expect(calls).toEqual(["read one"]);
  app.stdin.write("j");
  await settle();
  app.stdin.write("m");
  await settle();
  expect(calls).toEqual(["read one"]);
  expect(rowText(test, "workspace:two")).not.toContain("●");
});

it("offers Mark as read and Mark all as read in the Command Center", async () => {
  const { app, calls } = await open([
    alpha(),
    beta(UNREAD),
    gamma({ ...UNREAD, attentionTimestamp: "2026-11-06T00:00:06Z" }),
  ]);
  app.stdin.write(":");
  await settle();
  app.stdin.write("Mark");
  await settle();
  expect(app.lastFrame()).toContain("Mark as read");
  expect(app.lastFrame()).toContain("Mark all as read");
  expect(app.lastFrame()).not.toContain("Mark as unread");
  app.stdin.write("\u001b");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await palette(app, "Mark all as read");
  expect(calls).toEqual(["read one,two"]);
});

it("hides Mark as unread when the daemon cannot do it", async () => {
  const { app, calls } = await open(undefined, { supported: false });
  app.stdin.write(":");
  await settle();
  app.stdin.write("Mark");
  await settle();
  expect(app.lastFrame()).not.toContain("Mark as unread");
  expect(calls).toEqual([]);
});

it("shows the daemon's refusal in the status line", async () => {
  const { app } = await open(undefined, {
    error: new Error("Workspace has no finished agent to mark unread: one"),
  });
  app.stdin.write("\r");
  await settle();
  await palette(app, "Mark as unread");
  expect(app.lastFrame()).toContain(
    "Workspace has no finished agent to mark unread: one",
  );
});

it("moves a held Unread workspace to Idle at once when marked read", async () => {
  const { app, test, agentsPort } = await open([
    alpha(),
    beta(),
    gamma(UNREAD),
  ]);
  app.stdin.write("S");
  await settle();
  const y = (id: string) =>
    test.renderer.root.findDescendantById(`workspace:${id}`)?.y ?? -1;
  for (const key of ["g", "g"]) app.stdin.write(key);
  await settle();
  app.stdin.write("\r");
  await settle();
  const idleY = () =>
    app
      .lastFrame()
      ?.split("\n")
      .findIndex((line) => line.includes("Idle")) ?? -1;
  expect(idleY()).toBeGreaterThan(-1);
  expect(y("two")).toBeLessThan(idleY());
  app.stdin.write("\t");
  await settle();
  app.stdin.write("m");
  await settle();
  agentsPort.handler?.({ kind: "upsert", agent: gamma() });
  await settle();
  expect(y("two")).toBeGreaterThan(idleY());
});
