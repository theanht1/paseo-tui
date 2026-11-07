/** Shared App test harness: fakes at the client boundary plus `setup()`. */
import type {
  ConnectionState,
  PaseoAgent,
  PaseoAgentTimelineEvent,
  PaseoAgentUpdate,
} from "@getpaseo/client";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentTimelineItem,
} from "@getpaseo/protocol/agent-types";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { afterEach } from "vitest";
import type { HistoryEntry } from "../connection/ports.js";
import { createAgentsStore } from "../state/agents-store.js";
import type {
  AgentHistoryPort,
  AgentPort,
  AgentsList,
  AgentsPort,
  CatalogModel,
  CreateAgentInput,
} from "../state/ports.js";
import { createTimelineRegistry } from "../state/timeline-registry.js";
import { createTimelineStore } from "../state/timeline-store.js";
import { at } from "../test/at.js";
import { agent, listSnapshot, page } from "../test/fixtures.js";
import { App, type AppProps } from "../ui/App.js";
import type { ThinkingPreference } from "../ui/agent/thinking-preference.js";
import type { SessionHistory } from "../ui/command-center/session-history.js";
import { watchConnection } from "../ui/connection-status.js";
import {
  createSyntaxStyle,
  createTheme,
  ThemeContext,
} from "../ui/render/theme.js";
import type { DirectorySnapshot } from "../ui/workspace/workspace-directory.js";
import type { WorkspaceRow } from "../ui/workspace/workspaces.js";

export const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

export class FakeAgents implements AgentsPort {
  thinking: CatalogModel["thinking"];
  providerAvailable = true;
  /** While set, providers() waits for it, like a catalog still loading. */
  providersLoaded: Promise<void> | null = null;
  providerListeners = new Set<() => void>();
  onProvidersChange(listener: () => void) {
    this.providerListeners.add(listener);
    return () => {
      this.providerListeners.delete(listener);
    };
  }
  async providers() {
    await this.providersLoaded;
    return [
      {
        id: "codex",
        label: "Codex",
        available: this.providerAvailable,
        error: this.providerAvailable ? null : "Sign in required",
        defaultModeId: "ask",
      },
    ];
  }
  async models() {
    return [
      {
        id: "best",
        label: "Best",
        description: null,
        isDefault: true,
        ...(this.thinking ? { thinking: this.thinking } : {}),
      },
    ];
  }
  async modes() {
    return [{ id: "ask", label: "Ask", description: null }];
  }
  createError: Error | null = null;
  createdInputs: CreateAgentInput[] = [];
  created = agent("created", { title: "Created agent", cwd: "/repo/one" });
  async create(input: CreateAgentInput) {
    this.createdInputs.push(input);
    if (this.createError) throw this.createError;
    return this.created;
  }
  lists = 0;
  constructor(public agents: PaseoAgent[]) {}
  async list(): Promise<AgentsList> {
    this.lists++;
    const snapshot = listSnapshot(this.agents);
    return {
      ...snapshot,
      subscription: {
        release: async () => {},
        subscribe: (observer) => {
          observer.snapshot(snapshot);
          return () => {};
        },
      },
    };
  }
  handler: ((update: PaseoAgentUpdate) => void) | null = null;
  onUpdate(handler: (update: PaseoAgentUpdate) => void) {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }
}
/** Session history across hosts (the `history` prop); pass it through `extra`. */
export class FakeHistory implements SessionHistory {
  searchable = true;
  queries: string[] = [];
  unarchived: string[] = [];
  unarchiveError: Error | null = null;
  constructor(public entries: HistoryEntry[] = []) {}
  async list(query: string) {
    this.queries.push(query);
    return { entries: this.entries, truncated: false, hostErrors: [] };
  }
  async unarchive(agentId: string) {
    this.unarchived.push(agentId);
    if (this.unarchiveError) throw this.unarchiveError;
  }
}
/** Daemon-side history for a fake agent; omitted means a daemon without those features. */
export interface FakeHistoryOptions {
  /** Rows the tail fetch returns; older ones page in through `fetchBefore`. */
  tail: number;
  /** Whether the daemon advertises `agentHistorySearch`. */
  search: boolean;
  /** Whether the daemon advertises `agentTimelinePromptIndex`. */
  prompts?: boolean;
}
export class FakeAgent implements AgentPort {
  sent: string[] = [];
  responses: { id: string; response: AgentPermissionResponse }[] = [];
  canceled = 0;
  sendError: Error | null = null;
  responseError: Error | null = null;
  cancelError: Error | null = null;
  sendGate: Promise<void> = Promise.resolve();
  responseGate: Promise<void> = Promise.resolve();
  cancelGate: Promise<void> = Promise.resolve();
  handler: ((event: PaseoAgentTimelineEvent) => void) | null = null;
  released = false;
  /** The cursor sequence of each older page the pane fetched. */
  olderFetches: number[] = [];
  readonly history?: AgentHistoryPort;
  constructor(
    readonly current: PaseoAgent,
    readonly items: AgentTimelineItem[],
    options?: FakeHistoryOptions,
  ) {
    if (options) {
      this.tailSize = options.tail;
      this.history = {
        fetchBefore: async (cursor, limit) => {
          this.olderFetches.push(cursor.seq);
          const seqs = this.items
            .map((_, index) => index + 1)
            .filter((seq) => seq < cursor.seq)
            .slice(-limit);
          return { ...this.rows(seqs), hasOlder: (seqs[0] ?? 1) > 1 };
        },
        search: options.search
          ? async (query) => ({
              epoch: "epoch",
              seqs: this.items.flatMap((item, index) =>
                (item.type === "user_message" ||
                  item.type === "assistant_message") &&
                item.text.toLowerCase().includes(query.toLowerCase())
                  ? [index + 1]
                  : [],
              ),
              truncated: false,
            })
          : null,
        prompts: options.prompts
          ? async () => ({
              epoch: "epoch",
              prompts: this.items.flatMap((item, index) =>
                item.type === "user_message"
                  ? [
                      {
                        seq: index + 1,
                        timestamp: "2026-11-03T00:00:00Z",
                        preview: item.text,
                      },
                    ]
                  : [],
              ),
            })
          : null,
        rewind: null,
        forkContext: null,
        setThinking: null,
      };
    }
  }
  private tailSize: number | null = null;
  private rows(seqs: number[]) {
    const rows = page(seqs);
    return {
      ...rows,
      entries: rows.entries.map((entry) => ({
        ...entry,
        item: at(this.items, entry.seqEnd - 1),
      })),
    };
  }
  subscribe(handler: (event: PaseoAgentTimelineEvent) => void) {
    this.handler = handler;
    return Object.assign(
      () => {
        this.released = true;
      },
      { ready: Promise.resolve() },
    );
  }
  async fetchTail() {
    const seqs = this.items.map((_, index) => index + 1);
    return this.rows(
      this.tailSize === null ? seqs : seqs.slice(-this.tailSize),
    );
  }
  async fetchAfter(): Promise<never> {
    throw new Error("unexpected catch-up");
  }
  async send(text: string) {
    this.sent.push(text);
    await this.sendGate;
    if (this.sendError) throw this.sendError;
  }
  steered: string[] = [];
  async steer(text: string) {
    this.steered.push(text);
    await this.sendGate;
    if (this.sendError) throw this.sendError;
  }
  interrupted: string[] = [];
  async interrupt(text: string) {
    this.interrupted.push(text);
    await this.sendGate;
    if (this.sendError) throw this.sendError;
  }
  async respondToPermission(id: string, response: AgentPermissionResponse) {
    this.responses.push({ id, response });
    await this.responseGate;
    if (this.responseError) throw this.responseError;
  }
  async cancel() {
    this.canceled++;
    await this.cancelGate;
    if (this.cancelError) throw this.cancelError;
  }
  modes: string[] = [];
  names: string[] = [];
  archived = 0;
  modeError: Error | null = null;
  modeNotice: string | null = null;
  async setMode(id: string) {
    this.modes.push(id);
    if (this.modeError) throw this.modeError;
    return this.modeNotice;
  }
  models: string[] = [];
  async setModel(id: string) {
    this.models.push(id);
  }
  async rename(name: string) {
    this.names.push(name);
  }
  async archive() {
    this.archived++;
  }
  snapshot() {
    return this.current;
  }
  requestPermission(request: AgentPermissionRequest) {
    this.handler?.({
      agentId: this.current.id,
      timestamp: "2026-11-03T00:00:00Z",
      event: { type: "permission_requested", provider: "codex", request },
    });
  }
  startTurn(turnId = "turn") {
    this.handler?.({
      agentId: this.current.id,
      timestamp: "2026-11-03T00:00:00Z",
      event: { type: "turn_started", provider: "codex", turnId },
    });
  }
  endTurn(
    event:
      | { type: "turn_completed" }
      | { type: "turn_canceled"; reason: string }
      | { type: "turn_failed"; error: string } = {
      type: "turn_canceled",
      reason: "stop",
    },
  ) {
    this.handler?.({
      agentId: this.current.id,
      timestamp: "2026-11-03T00:00:00Z",
      event: { ...event, provider: "codex" },
    });
  }
  pushAssistant(seq: number, text: string) {
    this.handler?.({
      agentId: this.current.id,
      epoch: "epoch",
      seq,
      timestamp: "2026-11-03T00:00:00Z",
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text },
      },
    });
  }
}
export class FakeConnection {
  listeners = new Set<(state: ConnectionState) => void>();
  onConnectionState(cb: (state: ConnectionState) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  emit(state: ConnectionState) {
    for (const listener of this.listeners) listener(state);
  }
}
export const renders: (() => Promise<void>)[] = [];
export async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const render of renders) await render();
  }
}
export async function settleUntil(frame: () => string, text: string) {
  await settle();
  for (let i = 0; i < 100 && !frame().includes(text); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
  }
}

export const agents = [
  agent("alpha", {
    title: "Alpha agent",
    cwd: "/repo/one",
    workspaceId: "one",
    updatedAt: "2026-11-03T00:00:02Z",
  }),
  agent("beta", {
    title: "Beta agent",
    cwd: "/repo/one",
    workspaceId: "one",
    updatedAt: "2026-11-03T00:00:01Z",
  }),
  agent("gamma", {
    title: "Gamma agent",
    cwd: "/repo/two",
    workspaceId: "two",
    status: "running",
    updatedAt: "2026-11-03T00:00:00Z",
  }),
];

export async function setup(
  currentAgents = agents,
  height = 24,
  kittyKeyboard = false,
  env: NodeJS.ProcessEnv = {},
  catalog?: AppProps["catalog"] | "agents",
  terminalApi?: AppProps["terminals"],
  management?: AppProps["management"],
  thinkingPreference?: ThinkingPreference,
  extra: Partial<AppProps> = {},
  items?: (agentId: string) => AgentTimelineItem[] | null,
  history?: (agentId: string) => FakeHistoryOptions | undefined,
) {
  const workspaceIds = [
    ...new Set(currentAgents.map((agent) => agent.workspaceId ?? agent.cwd)),
  ];
  let directorySnapshot: DirectorySnapshot = {
    projects: [
      {
        projectId: "repo",
        projectDisplayName: "Repo",
        projectRootPath: "/repo",
        projectKind: "git" as const,
      },
    ],
    workspaces: workspaceIds.map((id) => ({
      id,
      projectId: "repo",
      projectRootPath: "/repo",
      activityAt: null,
      statusEnteredAt: null,
      pinnedAt: null,
      workspaceDirectory:
        currentAgents.find((agent) => (agent.workspaceId ?? agent.cwd) === id)
          ?.cwd ?? "/repo",
      name:
        currentAgents.find((agent) => (agent.workspaceId ?? agent.cwd) === id)
          ?.cwd ?? id,
    })),
    terminals: terminalApi
      ? [
          {
            id: "shell",
            workspaceId: at(workspaceIds, 0),
            cwd: "/repo/one",
            name: "Shell",
          },
        ]
      : [],
    error: null,
  };
  const directoryListeners = new Set<() => void>();
  /** Each observed terminal's exit callback: lets a test end the process (vim `:q`). */
  const terminalExits = new Map<string, () => void>();
  const agentsPort = new FakeAgents(currentAgents);
  const store = createAgentsStore(agentsPort);
  await store.load();
  const ports = new Map<string, FakeAgent>();
  const connection = new FakeConnection();
  const status = watchConnection(connection, () => void store.resync());
  const test = await createTestRenderer({
    width: 120,
    height,
    kittyKeyboard,
    exitOnCtrlC: false,
  });
  renders.push(test.waitForVisualIdle);
  cleanups.push(async () => {
    renders.splice(renders.indexOf(test.waitForVisualIdle), 1);
  });
  const theme = createTheme(env);
  const syntaxStyle = createSyntaxStyle(test.renderer, theme);
  const root = createRoot(test.renderer);
  cleanups.push(async () => {
    await test.dispose();
    syntaxStyle.destroy();
    timelines.close();
    status.close();
    await store.close();
  });
  const cleared: string[] = [];
  const timelines = createTimelineRegistry((value) => {
    const port = new FakeAgent(
      value,
      items?.(value.id) ?? [
        { type: "user_message", text: `hello ${value.id}` },
        { type: "assistant_message", text: "Hi " },
        { type: "assistant_message", text: "there" },
      ],
      history?.(value.id),
    );
    ports.set(value.id, port);
    return createTimelineStore(port);
  });
  flushSync(() =>
    root.render(
      <ThemeContext value={{ theme, syntaxStyle }}>
        <App
          label="local (127.0.0.1:6767)"
          connection={status}
          agents={store}
          directory={{
            subscribe: (listener) => {
              directoryListeners.add(listener);
              return () => {
                directoryListeners.delete(listener);
              };
            },
            getSnapshot: () => directorySnapshot,
          }}
          onExit={() => test.renderer.destroy()}
          timelines={timelines}
          terminals={terminalApi}
          terminalStream={
            terminalApi
              ? {
                  observe(id, receive, _onError, onExit) {
                    if (onExit) terminalExits.set(id, onExit);
                    let closed = false;
                    const ready = terminalApi
                      .ref(id)
                      .capture()
                      .then((capture) => {
                        if (!closed)
                          receive({
                            type: "output",
                            terminalId: id,
                            subscriptionId: "test",
                            data: new TextEncoder().encode(
                              capture.lines.join("\r\n"),
                            ),
                          });
                      });
                    return {
                      ready,
                      async close() {
                        closed = true;
                      },
                    };
                  },
                  write(id, data) {
                    terminalApi.ref(id).write(data);
                  },
                  resize() {},
                }
              : undefined
          }
          management={management}
          thinkingPreference={thinkingPreference}
          clearAttention={async (agentId) => {
            cleared.push(agentId);
          }}
          catalog={catalog === "agents" ? agentsPort : catalog}
          {...extra}
        />
      </ThemeContext>,
    ),
  );
  const app = {
    stdin: {
      write(input: string) {
        if (input.startsWith("\u001b[200~"))
          void test.mockInput.pasteBracketedText(input.slice(6, -6));
        else test.mockInput.pressKey(input);
      },
    },
    lastFrame: () => test.captureCharFrame(),
  };
  await settle();
  await test.renderOnce();
  function removeWorkspace(id: string) {
    directorySnapshot = {
      ...directorySnapshot,
      workspaces: directorySnapshot.workspaces.filter((row) => row.id !== id),
      terminals: directorySnapshot.terminals.filter(
        (row) => row.workspaceId !== id,
      ),
    };
    for (const listener of directoryListeners) listener();
  }
  function updateWorkspace(id: string, patch: Partial<WorkspaceRow>) {
    directorySnapshot = {
      ...directorySnapshot,
      workspaces: directorySnapshot.workspaces.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      ),
    };
    for (const listener of directoryListeners) listener();
  }
  function setTerminals(terminals: DirectorySnapshot["terminals"]) {
    directorySnapshot = { ...directorySnapshot, terminals };
    for (const listener of directoryListeners) listener();
  }
  return {
    app,
    ports,
    agentsPort,
    connection,
    test,
    cleared,
    removeWorkspace,
    updateWorkspace,
    setTerminals,
    /** Ends the terminal's process, as vim `:q` does; the directory still lists it. */
    exitTerminal(id: string) {
      terminalExits.get(id)?.();
    },
  };
}

export function rowText(
  test: Awaited<ReturnType<typeof setup>>["test"],
  id: string,
) {
  const row = test.renderer.root.findDescendantById(id);
  if (!row) throw Error(`Missing ${id}`);
  return (
    test
      .captureCharFrame()
      .split("\n")
      [row.y]?.slice(row.x, row.x + row.width) ?? ""
  );
}
