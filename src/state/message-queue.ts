import type { PaseoAgent } from "@getpaseo/client";
import { createEmitter } from "./emitter.js";
import type { TimelineRegistry } from "./timeline-registry.js";
import type { TimelineStore, TurnState } from "./timeline-store.js";

export interface QueuedMessage {
  id: string;
  text: string;
}
export interface QueueSnapshot {
  /** Oldest first; the oldest goes out when the running turn ends. */
  items: readonly QueuedMessage[];
  /** Set after a failed or stopped turn, so nothing is sent into it until resumed. */
  paused: boolean;
}
type Hold = ReturnType<TimelineRegistry["acquire"]>;

/**
 * One agent's messages typed while its turn runs. They live in this process only
 * (the daemon has no queue to list or edit). While any wait, the queue holds the
 * agent's timeline open so it still sees the turn end with no pane showing it.
 */
function createMessageQueue(
  registry: Pick<TimelineRegistry, "acquire" | "subscribe">,
  agent: PaseoAgent,
  changed: () => void,
) {
  const emitter = createEmitter();
  let snapshot: QueueSnapshot = { items: [], paused: false };
  let next = 0;
  let hold: Hold | null = null;
  let watched: TimelineStore | null = null;
  let unwatch: (() => void) | null = null;
  let stopRegistry: (() => void) | null = null;
  let last: TurnState["kind"] | null = null;
  /** Sends in flight; the timeline stays held until they finish. */
  let sending = 0;
  function publish(patch: Partial<QueueSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    emitter.notify();
    changed();
    if (snapshot.items.length) retain();
    else if (!sending) letGo();
  }
  /** Runs a send with the timeline held, so it stays open until the send is done. */
  async function deliver(send: () => Promise<void>) {
    sending++;
    try {
      await send();
    } finally {
      sending--;
      if (!snapshot.items.length && !sending) letGo();
    }
  }
  function watch(store: TimelineStore) {
    if (watched === store) return;
    unwatch?.();
    watched = store;
    last = store.getSnapshot().turn.kind;
    unwatch = store.subscribe(() => observe(store));
  }
  function retain() {
    if (hold) return;
    hold = registry.acquire(agent);
    // The registry swaps in a new store when a failed timeline reopens.
    stopRegistry = registry.subscribe(() => {
      if (hold) watch(hold.store);
    });
    watch(hold.store);
  }
  function letGo() {
    unwatch?.();
    stopRegistry?.();
    hold?.release();
    unwatch = stopRegistry = hold = watched = null;
    last = null;
  }
  function observe(store: TimelineStore) {
    const turn = store.getSnapshot().turn.kind;
    const previous = last;
    last = turn;
    if (turn === previous) return;
    if (turn === "failed" || (turn === "idle" && previous === "stopping"))
      publish({ paused: true });
    else if (turn === "idle" && previous === "running" && !snapshot.paused)
      void sendOldest(store);
  }
  async function sendOldest(store: TimelineStore) {
    const [first, ...rest] = snapshot.items;
    if (!first || sending) return;
    await deliver(async () => {
      publish({ items: rest });
      await store.send(first.text);
      if (store.getSnapshot().lastActionError)
        publish({ items: [first, ...snapshot.items], paused: true });
    });
  }
  function take(id: string): string | null {
    const item = snapshot.items.find((entry) => entry.id === id);
    if (!item) return null;
    publish({ items: snapshot.items.filter((entry) => entry !== item) });
    return item.text;
  }
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => snapshot,
    enqueue(text: string) {
      if (!text.trim()) return;
      publish({ items: [...snapshot.items, { id: `q${++next}`, text }] });
    },
    remove(id: string) {
      take(id);
    },
    /** Removes the message and returns its text (to edit it in the prompt). */
    take,
    clear() {
      publish({ items: [], paused: false });
    },
    /** Sends a message now: into the running turn (`steer`) or replacing it (`interrupt`). */
    async sendNow(id: string, behavior: "steer" | "interrupt") {
      const store = hold?.store;
      if (!store) return;
      await deliver(async () => {
        const text = take(id);
        if (text === null) return;
        const running = store.getSnapshot().turn.kind === "running";
        if (!running) await store.send(text);
        else if (behavior === "steer") await store.steer(text);
        else await store.interrupt(text);
      });
    },
    /** Unpauses; with the agent idle, the oldest message goes out now. */
    async resume() {
      const store = hold?.store;
      if (!store) return;
      publish({ paused: false });
      const turn = store.getSnapshot().turn.kind;
      if (turn === "idle" || turn === "failed") await sendOldest(store);
    },
    close() {
      emitter.clear();
      letGo();
    },
  };
}
export type MessageQueue = ReturnType<typeof createMessageQueue>;

/** Every agent's message queue, by agent id, for the life of the window. */
export function createMessageQueues(
  registry: Pick<TimelineRegistry, "acquire" | "subscribe">,
) {
  const queues = new Map<string, MessageQueue>();
  const emitter = createEmitter();
  return {
    forAgent(agent: PaseoAgent): MessageQueue {
      let queue = queues.get(agent.id);
      if (!queue) {
        queue = createMessageQueue(registry, agent, emitter.notify);
        queues.set(agent.id, queue);
      }
      return queue;
    },
    /** Messages waiting across every agent; quitting loses them. */
    total() {
      let count = 0;
      for (const queue of queues.values())
        count += queue.getSnapshot().items.length;
      return count;
    },
    subscribe: emitter.subscribe,
    close() {
      for (const queue of queues.values()) queue.close();
      queues.clear();
      emitter.clear();
    },
  };
}
export type MessageQueues = ReturnType<typeof createMessageQueues>;
