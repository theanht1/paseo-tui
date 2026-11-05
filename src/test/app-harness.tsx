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
import { createAgentsStore } from "../state/agents-store.js";
import type {
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
import { watchConnection } from "../ui/connection-status.js";
import {
  createSyntaxStyle,
  createTheme,
  ThemeContext,
} from "../ui/render/theme.js";

export const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

export class FakeAgents implements AgentsPort {
  thinking: CatalogModel["thinking"];
  providerAvailable = true;
  async providers() {
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
  constructor(
    readonly current: PaseoAgent,
    readonly items: AgentTimelineItem[],
  ) {}
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
    const tail = page(seqs);
    return {
      ...tail,
      entries: tail.entries.map((entry, index) => ({
        ...entry,
        item: at(this.items, index),
      })),
    };
  }
  async fetchAfter(): Promise<never> {
    throw new Error("unexpected catch-up");
  }
  async send(text: string) {
    this.sent.push(text);
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
) {
  const workspaceIds = [
    ...new Set(currentAgents.map((agent) => agent.workspaceId ?? agent.cwd)),
  ];
  let directorySnapshot = {
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
                  observe(id, receive) {
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
  function setTerminals(terminals: typeof directorySnapshot.terminals) {
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
    setTerminals,
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
