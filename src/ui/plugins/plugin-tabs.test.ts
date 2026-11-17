import { expect, test } from "vitest";
import type { PluginActionEntry, PluginViewEntry } from "./plugin-host.js";
import {
  actionOnHost,
  pluginCommands,
  pluginNoticeLine,
  pluginViewTabs,
  prunePluginViews,
} from "./plugin-tabs.js";

function view(hostId: string, pluginId: string, id: string): PluginViewEntry {
  return {
    hostId,
    pluginId,
    view: { id, title: `${id} title`, render: () => null },
  };
}
function action(
  hostId: string,
  id: string,
  ran: string[] = [],
): PluginActionEntry {
  return {
    hostId,
    hostLabel: hostId.toUpperCase(),
    pluginId: "board",
    action: {
      id,
      title: `Do ${id}`,
      run: () => void ran.push(`${hostId}.${id}`),
    },
  };
}
const hostOf = (workspaceId: string) =>
  workspaceId === "w-home"
    ? "home"
    : workspaceId === "w-build"
      ? "build"
      : null;
const open = [
  { workspaceId: "w-home", pluginId: "board", viewId: "main" },
  { workspaceId: "w-build", pluginId: "board", viewId: "main" },
  { workspaceId: "w-gone", pluginId: "board", viewId: "main" },
];

test("an open view is a tab only where its plugin registered it on the workspace's host", () => {
  expect(pluginViewTabs(open, [view("home", "board", "main")], hostOf)).toEqual(
    [
      {
        kind: "plugin",
        key: "plugin:w-home:board:main",
        workspaceId: "w-home",
        pluginId: "board",
        viewId: "main",
        title: "main title",
      },
    ],
  );
});

test("drops open views a settled host does not offer, and keeps the rest", () => {
  const views = [view("home", "board", "main")];
  // build is still starting its plugins; w-gone's host is unknown.
  expect(
    prunePluginViews(open, { views, settled: new Set(["home"]) }, hostOf),
  ).toBe(open);
  expect(
    prunePluginViews(
      open,
      { views, settled: new Set(["home", "build"]) },
      hostOf,
    ),
  ).toEqual([open[0], open[2]]);
});

test("a key runs the action on the open workspace's host, else the first host offering it", () => {
  const actions = [action("home", "sync"), action("build", "sync")];
  expect(actionOnHost(actions, "board", "sync", "build")).toBe(actions[1]);
  expect(actionOnHost(actions, "board", "sync", null)).toBe(actions[0]);
  expect(actionOnHost(actions, "board", "other", "home")).toBeNull();
});

test("lists actions as commands, naming the host when several offer the same one", () => {
  const ran: string[] = [];
  const actions = [
    action("home", "sync", ran),
    action("build", "sync", ran),
    action("home", "solo", ran),
  ];
  const commands = pluginCommands(actions, (entry) => void entry.action.run());
  expect(
    commands.map(({ id, group, title, subtitle, action }) => ({
      id,
      group,
      title,
      subtitle,
      action,
    })),
  ).toEqual([
    {
      id: "plugin:home:board:sync",
      group: "Actions",
      title: "Do sync",
      subtitle: "HOME",
      action: { type: "plugin", plugin: "board", action: "sync" },
    },
    {
      id: "plugin:build:board:sync",
      group: "Actions",
      title: "Do sync",
      subtitle: "BUILD",
      action: { type: "plugin", plugin: "board", action: "sync" },
    },
    {
      id: "plugin:home:board:solo",
      group: "Actions",
      title: "Do solo",
      subtitle: undefined,
      action: { type: "plugin", plugin: "board", action: "solo" },
    },
  ]);
  commands[1]?.run();
  expect(ran).toEqual(["build.sync"]);
});

test("plugin messages share one status line; an error marks it and holds it longer", () => {
  expect(
    pluginNoticeLine([
      { text: "Saved", level: "info" },
      { text: "Synced", level: "info" },
    ]),
  ).toEqual({ text: "Saved · Synced", hold: 2500 });
  expect(
    pluginNoticeLine([
      { text: "Saved", level: "info" },
      { text: "Plugin x failed to load: nope", level: "error" },
    ]),
  ).toEqual({ text: "! Saved · Plugin x failed to load: nope", hold: 5000 });
});
