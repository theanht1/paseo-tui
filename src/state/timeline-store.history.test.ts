import type { PaseoAgentTimelineEvent } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import type {
  ForkAttachment,
  RewindMode,
  TimelineCursor,
} from "../connection/ports.js";
import { agent, page } from "../test/fixtures.js";
import type {
  AgentHistoryPort,
  AgentPort,
  OlderTimelinePage,
} from "./ports.js";
import { createTimelineStore } from "./timeline-store.js";

function range(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}
const attachment: ForkAttachment = {
  type: "text",
  mimeType: "text/plain",
  text: "history",
};
class FakeHistory implements AgentHistoryPort {
  /** Every row the daemon holds. */
  all = range(1, 1000);
  beforeCalls: TimelineCursor[] = [];
  rewinds: [string, RewindMode][] = [];
  forks: (TimelineCursor | null)[] = [];
  thinking: string[] = [];
  rewindError: Error | null = null;
  async fetchBefore(
    cursor: TimelineCursor,
    limit: number,
  ): Promise<OlderTimelinePage> {
    this.beforeCalls.push(cursor);
    const older = this.all.filter((seq) => seq < cursor.seq).slice(-limit);
    return {
      ...page(older),
      hasOlder: (older[0] ?? 1) > (this.all[0] ?? 1),
    };
  }
  search = async () => ({ epoch: "epoch", seqs: [5], truncated: false });
  prompts = async () => ({
    epoch: "epoch",
    prompts: [{ seq: 5, timestamp: "t", preview: "first" }],
  });
  rewind: AgentHistoryPort["rewind"] = async (messageId, mode) => {
    if (this.rewindError) throw this.rewindError;
    this.rewinds.push([messageId, mode]);
  };
  forkContext = async (boundary: TimelineCursor | null) => {
    this.forks.push(boundary);
    return attachment;
  };
  setThinking = async (optionId: string) => {
    this.thinking.push(optionId);
    return "Thinking updated";
  };
}
function setup(history: AgentHistoryPort | null = new FakeHistory()) {
  const afterCalls: [TimelineCursor, number][] = [];
  const port: AgentPort = {
    fetchTail: async () => page(range(801, 1000)),
    async fetchAfter(cursor, limit) {
      afterCalls.push([cursor, limit]);
      return page([cursor.seq + 1], {
        entries: [
          {
            seqStart: cursor.seq + 1,
            seqEnd: cursor.seq + 1,
            timestamp: "t",
            provider: "codex",
            item: {
              type: "user_message",
              text: "the full first prompt",
              messageId: "m5",
            },
            sourceSeqRanges: [],
            collapsed: [],
          },
        ],
      });
    },
    subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }),
    send: async () => {},
    steer: async () => {},
    respondToPermission: async () => {},
    setMode: async () => null,
    setModel: async () => {},
    rename: async () => {},
    archive: async () => {},
    cancel: async () => {},
    snapshot: () => agent("a"),
    ...(history ? { history } : {}),
  };
  return { store: createTimelineStore(port), afterCalls, port };
}
function seqs(store: ReturnType<typeof createTimelineStore>) {
  return store.getSnapshot().rows.map((row) => row.seq);
}

describe("timeline store history", () => {
  it("offers no history operations without a history port", () => {
    const { store } = setup(null);
    expect([
      store.search,
      store.prompts,
      store.rewind,
      store.fork,
      store.setThinking,
    ]).toEqual([null, null, null, null, null]);
  });
  it("pages older rows in until the revealed sequence is loaded", async () => {
    const history = new FakeHistory();
    const { store } = setup(history);
    await store.open();
    expect(seqs(store)[0]).toBe(801);
    await store.search?.reveal(450);
    expect(seqs(store)).toEqual(range(401, 1000));
    expect(history.beforeCalls.map((cursor) => cursor.seq)).toEqual([801, 601]);
    await store.search?.reveal(900);
    expect(history.beforeCalls).toHaveLength(2);
  });
  it("keeps revealed rows when live rows arrive, and drops them on a tail refetch", async () => {
    const events: ((event: PaseoAgentTimelineEvent) => void)[] = [];
    const { store, port } = setup();
    port.subscribe = (handler) => {
      events.push(handler);
      return Object.assign(() => {}, { ready: Promise.resolve() });
    };
    await store.open();
    await store.search?.reveal(10);
    events[0]?.({
      agentId: "a",
      epoch: "epoch",
      seq: 1001,
      timestamp: "t",
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text: "live" },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(seqs(store)[0]).toBe(1);
    expect(seqs(store).at(-1)).toBe(1001);
    events[0]?.({
      agentId: "a",
      event: { type: "replacement", epoch: "epoch" },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(seqs(store)[0]).toBe(801);
  });
  it("rejects a reveal past the oldest row the daemon still has", async () => {
    const history = new FakeHistory();
    history.all = range(300, 1000);
    const { store } = setup(history);
    await store.open();
    await expect(store.search?.reveal(10)).rejects.toThrow(
      /no longer in the history/,
    );
    expect(store.getSnapshot().status).toBe("ready");
  });
  it("rewinds to the prompt's message id, reporting failures on the pane", async () => {
    const history = new FakeHistory();
    const { store, afterCalls } = setup(history);
    await store.open();
    await store.rewind?.({ epoch: "epoch", seq: 5 }, "conversation");
    expect(afterCalls).toEqual([[{ epoch: "epoch", seq: 4 }, 1]]);
    expect(history.rewinds).toEqual([["m5", "conversation"]]);
    history.rewindError = Error("Provider does not support rewinding files");
    await store.rewind?.({ epoch: "epoch", seq: 5 }, "files");
    expect(store.getSnapshot().lastActionError).toBe(
      "Provider does not support rewinding files",
    );
  });
  it("seeds a fork with the prompt's full text and the history before it", async () => {
    const history = new FakeHistory();
    const { store } = setup(history);
    expect(await store.fork?.({ epoch: "epoch", seq: 5 }, true)).toEqual({
      text: "the full first prompt",
      attachment,
    });
    expect(await store.fork?.({ epoch: "epoch", seq: 5 }, false)).toEqual({
      text: "the full first prompt",
      attachment: null,
    });
    expect(history.forks).toEqual([{ epoch: "epoch", seq: 4 }]);
  });
  it("rejects a prompt whose row is gone", async () => {
    const { store, port } = setup();
    port.fetchAfter = async () => page([]);
    await expect(
      store.fork?.({ epoch: "epoch", seq: 5 }, false),
    ).rejects.toThrow(/no longer in the history/);
  });
  it("sets thinking and shows the provider notice", async () => {
    const history = new FakeHistory();
    const { store } = setup(history);
    await store.open();
    await store.setThinking?.("high");
    expect(history.thinking).toEqual(["high"]);
    expect(store.getSnapshot().lastNotice).toBe("Thinking updated");
  });
});
