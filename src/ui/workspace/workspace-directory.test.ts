import { expect, it } from "vitest";
import {
  createWorkspaceDirectory,
  type DirectoryApi,
} from "./workspace-directory.js";

it("loads daemon projects and every workspace page, releases owned observers on close", async () => {
  let released = 0;
  const cursors: (string | undefined)[] = [];
  const api: DirectoryApi = {
    projects: {
      list: async () => ({ requestId: "p", projects: [] }),
      subscribe: () => () => {},
    },
    workspaces: {
      list: async (options) => {
        cursors.push(options?.page?.cursor);
        return {
          requestId: "w",
          entries: [],
          pageInfo: {
            nextCursor: options?.page?.cursor ? null : "next",
            prevCursor: null,
            hasMore: !options?.page?.cursor,
          },
          subscription: {
            release: async () => {
              released++;
            },
            subscribe: () => () => {},
            getSnapshot: () => null,
          },
        };
      },
      subscribe: () => () => {},
    },
    terminals: { list: async () => ({ requestId: "t", entries: [] }) },
  };
  const store = createWorkspaceDirectory(api);
  await store.load();
  expect(cursors).toEqual([undefined, "next"]);
  expect(store.getSnapshot().error).toBeNull();
  await store.close();
  expect(released).toBe(1);
});
it("releases an owned subscription once when close races a reload", async () => {
  let released = 0;
  let requests = 0;
  let resume: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const api: DirectoryApi = {
    projects: {
      list: async () => {
        requests++;
        if (requests === 2) await gate;
        return { requestId: "p", projects: [] };
      },
      subscribe: () => () => {},
    },
    workspaces: {
      list: async () => ({
        requestId: "w",
        entries: [],
        pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
        subscription: {
          release: async () => {
            released++;
          },
          subscribe: () => () => {},
        },
      }),
      subscribe: () => () => {},
    },
    terminals: { list: async () => ({ requestId: "t", entries: [] }) },
  };
  const store = createWorkspaceDirectory(api);
  await store.load();
  const pending = store.load();
  await store.close();
  resume();
  await pending;
  expect(released).toBe(2);
});

it("removes archived workspaces immediately, even while an older fetch is pending", async () => {
  let update: Parameters<DirectoryApi["workspaces"]["subscribe"]>[0] = () => {};
  let resume: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let requests = 0;
  const workspace = {
    id: "branch",
    projectId: "repo",
    projectRootPath: "/repo",
    name: "Branch",
    workspaceDirectory: "/trees/branch",
    projectDisplayName: "Repo",
    projectKind: "git" as const,
    status: "done" as const,
    workspaceKind: "worktree" as const,
    archivingAt: null,
    statusEnteredAt: null,
    activityAt: null,
    scripts: [],
  };
  const api: DirectoryApi = {
    projects: {
      list: async () => ({ requestId: "p", projects: [] }),
      subscribe: () => () => {},
    },
    workspaces: {
      subscribe: (handler) => {
        update = handler;
        return () => {};
      },
      list: async () => {
        if (++requests > 1) await gate;
        return {
          requestId: "w",
          entries: [workspace],
          pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
        };
      },
    },
    terminals: {
      list: async () => ({
        requestId: "t",
        entries: [
          {
            id: "shell",
            workspaceId: "branch",
            cwd: "/trees/branch",
            name: "Shell",
          },
        ],
      }),
    },
  };
  const store = createWorkspaceDirectory(api);
  await store.load();
  const pending = store.load();
  expect(() =>
    Reflect.apply(update, undefined, [{ kind: "future-workspace-update" }]),
  ).not.toThrow();
  update({ kind: "remove", id: "branch" });
  expect(store.getSnapshot().workspaces).toEqual([]);
  expect(store.getSnapshot().terminals).toEqual([]);
  resume();
  await pending;
  expect(store.getSnapshot().workspaces).toEqual([]);
  await store.close();
});
