import type { PaseoAgent } from "@getpaseo/client";
import { expect, it } from "vitest";
import type { HostConnectionState } from "./connection/ports.js";
import type { LiveHost } from "./hosts.js";
import { createMultiHost, type HostSession } from "./multi-host.js";
import type { AgentsSnapshot } from "./state/agents-store.js";
import { createEmitter } from "./state/emitter.js";
import { createTimelineStore } from "./state/timeline-store.js";
import { FakeAgent, settle, settleUntil, setup } from "./test/app-harness.js";
import { agent, NO_PROJECT_ACTIONS } from "./test/fixtures.js";
import type { DirectorySnapshot } from "./ui/workspace/workspace-directory.js";

function mutable<T>(initial: T) {
  const emitter = createEmitter();
  let value = initial;
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => value,
    set(next: T) {
      value = next;
      emitter.notify();
    },
  };
}
function unexpected(): never {
  throw Error("Unexpected");
}
const alpha = agent("alpha", {
  title: "Alpha agent",
  cwd: "/repo/one",
  workspaceId: "one",
});
function listing(agents: PaseoAgent[]): AgentsSnapshot {
  return {
    groups: agents.map((value) => ({
      key: "one",
      agents: [value],
      updatedAt: value.updatedAt,
    })),
    error: null,
  };
}
function directoryOf(agents: PaseoAgent[]): DirectorySnapshot {
  return {
    projects: [
      {
        projectId: "repo",
        projectDisplayName: "Repo",
        projectRootPath: "/repo",
        projectKind: "git",
      },
    ],
    workspaces: agents.map(() => ({
      id: "one",
      projectId: "repo",
      projectRootPath: "/repo",
      activityAt: null,
      statusEnteredAt: null,
      workspaceDirectory: "/repo/one",
      name: "/repo/one",
    })),
    terminals: [],
    error: null,
  };
}
/** One connection's session: its listing, status and timelines that say which connection served them. */
function connectionTo(name: string, agents: PaseoAgent[]) {
  const status = mutable<HostConnectionState>({ status: "connected" });
  const agentList = mutable(listing(agents));
  const directory = mutable(directoryOf(agents));
  const session: HostSession = {
    status,
    agents: agentList,
    directory,
    terminals: { ref: unexpected },
    terminalStream: {
      observe: unexpected,
      write: unexpected,
      resize: unexpected,
    },
    management: {
      ...NO_PROJECT_ACTIONS,
      baseBranches: unexpected,
      createWorkspace: unexpected,
      createAgent: unexpected,
      createTerminal: unexpected,
      openFile: unexpected,
      renameWorkspace: unexpected,
      renameTab: unexpected,
      closeTab: unexpected,
      archiveWorkspace: unexpected,
    },
    agentsPort: {
      providers: unexpected,
      models: unexpected,
      modes: unexpected,
      onProvidersChange: () => () => {},
      create: unexpected,
    },
    refreshProviders: async () => {},
    clearAttention: async () => {},
    refresh: async () => {},
    openTimeline: (opened) =>
      createTimelineStore(
        new FakeAgent(opened, [
          { type: "user_message", text: `served by ${name}` },
        ]),
      ),
    completions: { commands: unexpected, files: unexpected },
    directories: { list: unexpected },
    schedules: {
      list: unexpected,
      inspect: unexpected,
      logs: unexpected,
      pause: unexpected,
      resume: unexpected,
      runOnce: unexpected,
      remove: unexpected,
      create: unexpected,
    },
  };
  const host: LiveHost<{ session: HostSession }> = {
    id: "build",
    label: "Build",
    live: { session },
  };
  return {
    host,
    status,
    load(next: PaseoAgent[]) {
      agentList.set(listing(next));
      directory.set(directoryOf(next));
    },
  };
}
async function openOnOldConnection() {
  const old = connectionTo("old", [alpha]);
  const hosts = mutable<readonly LiveHost<{ session: HostSession }>[]>([
    old.host,
  ]);
  const multi = createMultiHost({
    ...hosts,
    health: mutable([{ id: "build" }]),
  });
  const { app } = await setup(
    [alpha],
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {
      agents: multi.agents,
      directory: multi.directory,
      timelines: multi.timelines,
    },
  );
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "served by old");
  expect(app.lastFrame()).toContain("served by old");
  // The client gave up; hosts.ts keeps the dead connection shown while it replaces it.
  old.status.set({ status: "disconnected", reason: "Transport closed" });
  await settleUntil(app.lastFrame, "host offline");
  return { app, hosts };
}

it("rebinds an open pane to the replacement connection when it comes up already listed", async () => {
  const { app, hosts } = await openOnOldConnection();
  hosts.set([connectionTo("new", [alpha]).host]);
  await settleUntil(app.lastFrame, "served by new");
  expect(app.lastFrame()).toContain("served by new");
});

it("drops the dead connection's timeline when the replacement lists its agents later", async () => {
  const { app, hosts } = await openOnOldConnection();
  const replacement = connectionTo("new", []);
  hosts.set([replacement.host]);
  await settle();
  replacement.load([alpha]);
  await settle();
  // The agent was briefly unlisted, so its pane let it go rather than keep the old timeline.
  expect(app.lastFrame()).not.toContain("served by old");
  // Picking its tab again opens it on the new connection.
  app.stdin.write("1");
  await settleUntil(app.lastFrame, "served by new");
  expect(app.lastFrame()).toContain("served by new");
});
