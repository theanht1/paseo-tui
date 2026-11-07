import {
  normalizeWorkspaceLabelName,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelDefinition,
  workspaceLabelKey,
} from "@getpaseo/protocol/workspace-labels";
import { createEmitter } from "../../state/emitter.js";
import {
  byName,
  type HostCatalogEntry,
  type WorkspaceLabels,
  type WorkspaceLabelsSnapshot,
} from "../../state/label-catalog.js";
import { toggleFilterKey, UNLABELLED } from "../agent/label-filter.js";
import type { LabelFilterMemory } from "../layout/label-filter-memory.js";
import type { WorkspaceRow } from "../workspace/workspaces.js";
import type { CommandItem, CommandStep } from "./registry.js";

export const LABELS_UNSUPPORTED =
  "Update the Paseo daemon to use workspace labels (workspaceLabels)";

export interface AssignDeps {
  labels: WorkspaceLabels;
  workspaceId: string;
  /** The workspace's latest row, for the names it carries. */
  row(workspaceId: string): WorkspaceRow | undefined;
  subscribeRows(listener: () => void): () => void;
  report(text: string): void;
}
function checked(on: boolean, title: string) {
  return `${on ? "✓" : " "} ${title}`;
}
function field(error: Error, name: "requestType" | "code"): string | null {
  const value: unknown = name in error ? Reflect.get(error, name) : undefined;
  return typeof value === "string" ? value : null;
}
/** The daemon's message without the ` requestType=… code=…` the client appends. */
export function labelErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  let text = error.message;
  const requestType = field(error, "requestType");
  const code = field(error, "code");
  if (requestType) text = text.replace(` requestType=${requestType}`, "");
  if (code) text = text.replace(` code=${code}`, "");
  return text.trim() || "The label change failed";
}

/** The workspace's labels as a toggle list that stays open; a message when its host has none. */
export function workspaceLabelsStep(deps: AssignDeps): CommandStep | string {
  const { labels, workspaceId } = deps;
  if (labels.getSnapshot().host(workspaceId).kind === "unsupported")
    return LABELS_UNSUPPORTED;
  const emitter = createEmitter();
  const pending = new Set<string>();
  /** The daemon's answer, until the directory's row changes from `baseline`. */
  let answered: { baseline: unknown; names: readonly string[] } | null = null;
  function carried(): readonly string[] {
    const names = deps.row(workspaceId)?.labels;
    return answered && names === answered.baseline
      ? answered.names
      : (names ?? []);
  }
  function assign(label: WorkspaceLabelDefinition, assigned: boolean) {
    const key = workspaceLabelKey(label.name);
    if (pending.has(key)) return;
    pending.add(key);
    emitter.notify();
    const baseline = deps.row(workspaceId)?.labels;
    labels
      .setAssignment({ workspaceId, label, assigned })
      .then(
        (names) => {
          answered = { baseline, names };
        },
        (error: unknown) => deps.report(labelErrorMessage(error)),
      )
      .finally(() => {
        pending.delete(key);
        emitter.notify();
      });
  }
  function catalog(): readonly WorkspaceLabelDefinition[] {
    const state = labels.getSnapshot().host(workspaceId);
    return state.kind === "ready" ? state.labels : [];
  }
  const step: CommandStep = {
    kind: "choice",
    title: "Labels",
    subscribe(listener) {
      const stops = [
        emitter.subscribe(listener),
        labels.subscribe(listener),
        deps.subscribeRows(listener),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
    items() {
      const state = labels.getSnapshot().host(workspaceId);
      const keys = new Set(carried().map(workspaceLabelKey));
      const rows: CommandItem[] =
        state.kind === "ready"
          ? [...state.labels].sort(byName).map((label) => {
              const key = workspaceLabelKey(label.name);
              const on = keys.has(key);
              return {
                id: `label:${key}`,
                group: "Workspaces",
                title: checked(on, label.name),
                subtitle: pending.has(key) ? "saving…" : label.color,
                run() {
                  assign(label, !on);
                  return step;
                },
              };
            })
          : [
              {
                id: "labels-status",
                group: "Workspaces",
                title:
                  state.kind === "failed"
                    ? `Labels unavailable: ${state.error}`
                    : "Loading labels…",
                run: () => step,
              },
            ];
      return [
        ...rows,
        {
          id: "new-label",
          group: "Workspaces",
          title: "New label…",
          keywords: ["create", "add"],
          run: () => newLabelStep(),
        },
      ];
    },
  };
  function newLabelStep(): CommandStep {
    return {
      kind: "input",
      title: "New label",
      placeholder: "Label name",
      required: "Name",
      submit(text) {
        const name = text.trim();
        const existing = catalog().find(
          (label) => workspaceLabelKey(label.name) === workspaceLabelKey(name),
        );
        if (existing) {
          assign(existing, true);
          return undefined;
        }
        return {
          kind: "choice",
          title: "Color",
          items: () =>
            WORKSPACE_LABEL_COLORS.map((color) => ({
              id: `label-color:${color}`,
              group: "Workspaces",
              title: color,
              ...(color === "violet" ? { subtitle: "default" } : {}),
              run(): undefined {
                assign({ name, color }, true);
              },
            })),
        };
      },
    };
  }
  return step;
}

export interface FilterDeps {
  labels: WorkspaceLabels;
  filter: LabelFilterMemory;
  /** Its host's definitions come first when hosts disagree. */
  workspaceId: string | null;
}
/** Multi-select filter over every connected host's labels, plus Unlabelled. */
export function labelFilterStep({
  labels,
  filter,
  workspaceId,
}: FilterDeps): CommandStep | string {
  if (!labels.getSnapshot().supported) return LABELS_UNSUPPORTED;
  const toggle = (id: string, title: string, key: string): CommandItem => ({
    id,
    group: "View",
    title: checked(filter.getSnapshot().includes(key), title),
    run() {
      filter.set(toggleFilterKey(filter.getSnapshot(), key));
      return step;
    },
  });
  const step: CommandStep = {
    kind: "choice",
    title: "Filter by label",
    subscribe(listener) {
      const stops = [labels.subscribe(listener), filter.subscribe(listener)];
      return () => {
        for (const stop of stops) stop();
      };
    },
    items() {
      const keys = filter.getSnapshot();
      const merged = labels.getSnapshot().merged(workspaceId);
      const known = new Set(
        merged.map((label) => workspaceLabelKey(label.name)),
      );
      return [
        toggle("label-filter:unlabelled", "Unlabelled", UNLABELLED),
        ...merged.map((label) =>
          toggle(
            `label-filter:${workspaceLabelKey(label.name)}`,
            label.name,
            workspaceLabelKey(label.name),
          ),
        ),
        ...keys
          .filter((key) => key !== UNLABELLED && !known.has(key))
          .map((key) => toggle(`label-filter:${key}`, key, key)),
        ...(keys.length
          ? [
              {
                id: "label-filter-clear",
                group: "View" as const,
                title: "Clear filter",
                run(): undefined {
                  filter.set([]);
                },
              },
            ]
          : []),
      ];
    },
  };
  return step;
}

export interface ManageDeps {
  labels: WorkspaceLabels;
  report(text: string): void;
}
function workspaceCount(count: number) {
  return `${count} workspace${count === 1 ? "" : "s"}`;
}
/** Manage labels: choose a host when several have labels, then a label, then Rename / Recolor / Delete. */
export function manageLabelsStep(deps: ManageDeps): CommandStep | string {
  const { labels, report } = deps;
  if (!labels.getSnapshot().supported) return LABELS_UNSUPPORTED;
  const catalog = (hostId: string): HostCatalogEntry | undefined =>
    labels.getSnapshot().catalogs.find((entry) => entry.hostId === hostId);
  function failedRow(
    host: WorkspaceLabelsSnapshot["failed"][number],
    step: CommandStep,
  ): CommandItem {
    return {
      id: `manage-labels-failed:${host.hostId}`,
      group: "View",
      title: `Labels unavailable on ${host.label}: ${host.error}`,
      subtitle: "Enter lists again",
      run() {
        labels
          .reload(host.hostId)
          .catch((error: unknown) => report(labelErrorMessage(error)));
        return step;
      },
    };
  }
  function labelRows(entry: HostCatalogEntry): CommandItem[] {
    if (!entry.labels.length)
      return [
        {
          id: "manage-labels-empty",
          group: "View",
          title: "No labels yet",
          run: () => undefined,
        },
      ];
    return entry.labels.map((label) => ({
      id: `manage-label:${workspaceLabelKey(label.name)}`,
      group: "View",
      title: label.name,
      subtitle: label.color,
      run: () => actions(entry, label),
    }));
  }
  const loading: CommandItem = {
    id: "manage-labels-loading",
    group: "View",
    title: "Loading labels…",
    run: () => undefined,
  };
  function labelList(hostId: string): CommandStep {
    const step: CommandStep = {
      kind: "choice",
      title: catalog(hostId)?.label ?? "Labels",
      subscribe: labels.subscribe,
      items() {
        const entry = catalog(hostId);
        if (entry) return labelRows(entry);
        const failed = labels
          .getSnapshot()
          .failed.find((host) => host.hostId === hostId);
        return [failed ? failedRow(failed, step) : loading];
      },
    };
    return step;
  }
  function edit(
    entry: HostCatalogEntry,
    label: WorkspaceLabelDefinition,
    change: { newName: string } | { color: WorkspaceLabelDefinition["color"] },
  ): undefined {
    labels
      .update(entry.hostId, { name: label.name, ...change })
      .catch((error: unknown) =>
        report(
          error instanceof Error &&
            field(error, "code") === "label_name_taken" &&
            "newName" in change
            ? `A label named "${change.newName}" already exists on ${entry.label}`
            : labelErrorMessage(error),
        ),
      );
    return undefined;
  }
  function actions(
    entry: HostCatalogEntry,
    label: WorkspaceLabelDefinition,
  ): CommandStep {
    const rename: CommandStep = {
      kind: "input",
      title: "Rename",
      placeholder: "Label name",
      initial: label.name,
      required: "Name",
      validate(text) {
        const newName = normalizeWorkspaceLabelName(text);
        if (!newName) return "Name is required";
        return newName === label.name ? "Name is unchanged" : null;
      },
      submit(text) {
        const newName = normalizeWorkspaceLabelName(text);
        // Unchanged or empty is nothing to send; the field stays open.
        if (!newName || newName === label.name) return rename;
        return edit(entry, label, { newName });
      },
    };
    const recolor: CommandStep = {
      kind: "choice",
      title: "Recolor",
      items: () =>
        WORKSPACE_LABEL_COLORS.map((color) => ({
          id: `recolor:${color}`,
          group: "View",
          title: color,
          ...(color === label.color ? { subtitle: "current" } : {}),
          run: () =>
            color === label.color ? recolor : edit(entry, label, { color }),
        })),
    };
    const remove: CommandStep = {
      kind: "confirm",
      title: "Delete",
      async prepare() {
        try {
          const count = await labels.inspectDelete(entry.hostId, label.name);
          return `Delete label ${label.name}? Removes it from ${workspaceCount(count)}`;
        } catch (error) {
          throw Error(labelErrorMessage(error));
        }
      },
      confirm() {
        labels
          .delete(entry.hostId, label.name)
          .catch((error: unknown) => report(labelErrorMessage(error)));
      },
    };
    return {
      kind: "choice",
      title: label.name,
      items: () => [
        {
          id: "label-rename",
          group: "View",
          title: "Rename…",
          run: () => rename,
        },
        {
          id: "label-recolor",
          group: "View",
          title: "Recolor…",
          run: () => recolor,
        },
        {
          id: "label-delete",
          group: "View",
          title: "Delete…",
          run: () => remove,
        },
      ],
    };
  }
  const hosts = labels.getSnapshot().catalogs;
  const only = hosts[0];
  if (hosts.length === 1 && only) return labelList(only.hostId);
  /** Whose labels to manage; until one host has listed, its labels or the failed listings. */
  const choose: CommandStep = {
    kind: "choice",
    title: "Manage labels",
    subscribe: labels.subscribe,
    items() {
      const { catalogs, failed } = labels.getSnapshot();
      const first = catalogs[0];
      if (catalogs.length === 1 && first) return labelRows(first);
      if (catalogs.length)
        return catalogs.map((entry) => ({
          id: `manage-labels-host:${entry.hostId}`,
          group: "View",
          title: entry.label,
          ...(entry.online ? {} : { subtitle: "offline" }),
          run: () => labelList(entry.hostId),
        }));
      return failed.length
        ? failed.map((host) => failedRow(host, choose))
        : [loading];
    },
  };
  return choose;
}

export interface LabelCommandContext extends Omit<AssignDeps, "workspaceId"> {
  filter: LabelFilterMemory;
  /** The selected workspace, which Labels… edits. */
  workspace: WorkspaceRow | null;
}
function opened(step: CommandStep | string, report: (text: string) => void) {
  if (typeof step === "string") {
    report(step);
    return undefined;
  }
  return step;
}
export function labelCommands(context: LabelCommandContext): CommandItem[] {
  const { workspace } = context;
  return [
    ...(workspace
      ? [
          {
            id: "workspace-labels",
            group: "Workspaces" as const,
            title: "Labels…",
            subtitle: workspace.title || workspace.name,
            keywords: ["label", "tag"],
            action: { type: "workspace.labels" as const },
            run: () =>
              opened(
                workspaceLabelsStep({ ...context, workspaceId: workspace.id }),
                context.report,
              ),
          },
        ]
      : []),
    {
      id: "label-filter",
      group: "View",
      title: "Filter by label…",
      keywords: ["label", "tag", "filter"],
      run: () =>
        opened(
          labelFilterStep({
            labels: context.labels,
            filter: context.filter,
            workspaceId: workspace?.id ?? null,
          }),
          context.report,
        ),
    },
    {
      id: "manage-labels",
      group: "View",
      title: "Manage labels…",
      keywords: ["label", "tag", "rename", "recolor", "color", "delete"],
      run: () => opened(manageLabelsStep(context), context.report),
    },
  ];
}
