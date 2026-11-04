import type { PaseoAgent, PaseoAgentTimelineEvent } from "@getpaseo/client";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentTimelineItem,
} from "@getpaseo/protocol/agent-types";
import { createEmitter } from "./emitter.js";
import type { AgentPort, TimelineCursor, TimelinePage } from "./ports.js";

export interface TimelineRow {
  seq: number;
  timestamp: string;
  item: AgentTimelineItem;
}
export type TurnState =
  | { kind: "idle" }
  | { kind: "running"; turnId?: string }
  | { kind: "failed"; message: string };
interface TimelineContents {
  rows: readonly TimelineRow[];
  turn: TurnState;
  pendingPermissions: readonly AgentPermissionRequest[];
  lastActionError: string | null;
  lastNotice: string | null;
}
export type TimelineSnapshot = TimelineContents &
  (
    | { status: "loading"; epoch: null; error: null }
    | { status: "ready"; epoch: string; error: null }
    | { status: "error"; epoch: string | null; error: string }
    | { status: "closed"; epoch: string | null; error: string | null }
  );

function snapshotTurn(agent: PaseoAgent | null): TurnState {
  if (agent?.status === "running")
    return { kind: "running", turnId: agent.activeTurn?.turnId };
  if (agent?.status === "error")
    return { kind: "failed", message: agent.lastError ?? "Agent failed" };
  return { kind: "idle" };
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function pageRows(page: TimelinePage): TimelineRow[] {
  const rows = page.entries.map((entry) => ({
    seq: entry.seqEnd,
    timestamp: entry.timestamp,
    item: entry.item,
  }));
  return rows.sort((a, b) => a.seq - b.seq);
}

export function createTimelineStore(port: AgentPort) {
  const emitter = createEmitter();
  const agent = port.snapshot();
  let snapshot: TimelineSnapshot = {
    status: "loading",
    epoch: null,
    rows: [],
    turn: snapshotTurn(agent),
    pendingPermissions: agent?.pendingPermissions ?? [],
    lastActionError: null,
    lastNotice: null,
    error: null,
  };
  let phase: "new" | "opening" | "ready" | "error" | "closed" = "new";
  let cursor: TimelineCursor | null = null;
  let release: (() => void) | null = null;
  let buffered: PaseoAgentTimelineEvent[] | null = [];
  let queue = Promise.resolve();
  let opening: Promise<void> | null = null;

  function isActive() {
    return phase !== "closed" && phase !== "error";
  }
  function publish(next: TimelineSnapshot) {
    snapshot = next;
    emitter.notify();
  }
  function stopSubscription() {
    release?.();
    release = null;
  }
  function fail(error: unknown) {
    if (!isActive()) return;
    phase = "error";
    buffered = null;
    stopSubscription();
    publish({ ...snapshot, status: "error", error: errorMessage(error) });
  }
  function seedAgent(
    page: TimelinePage,
  ): Pick<TimelineContents, "turn" | "pendingPermissions"> {
    if (page.agent)
      return {
        turn: snapshotTurn(page.agent),
        pendingPermissions: page.agent.pendingPermissions,
      };
    return {
      turn: snapshot.turn,
      pendingPermissions: snapshot.pendingPermissions,
    };
  }
  async function refetchTail() {
    const page = await port.fetchTail(200);
    if (!isActive()) return;
    if (page.error) throw new Error(page.error);
    const rows = pageRows(page).slice(-500);
    cursor = {
      epoch: page.epoch,
      seq: page.endCursor?.seq ?? page.window.maxSeq,
    };
    publish({
      ...snapshot,
      ...seedAgent(page),
      status: "ready",
      epoch: page.epoch,
      rows,
      error: null,
    });
  }
  function appendPage(page: TimelinePage) {
    const lastSeq = cursor?.seq ?? 0;
    const rows = pageRows(page).filter((row) => row.seq > lastSeq);
    const seq = page.endCursor?.seq ?? lastSeq;
    cursor = { epoch: page.epoch, seq };
    publish({
      ...snapshot,
      ...seedAgent(page),
      status: "ready",
      epoch: page.epoch,
      rows: [...snapshot.rows, ...rows].slice(-500),
      error: null,
    });
  }
  async function catchUp() {
    while (isActive() && cursor) {
      const before = cursor;
      const page = await port.fetchAfter(before, 200);
      if (!isActive()) return;
      if (page.error) throw new Error(page.error);
      const reset =
        page.reset ||
        page.staleCursor ||
        page.gap ||
        page.epoch !== before.epoch;
      if (reset) {
        await refetchTail();
        return;
      }
      appendPage(page);
      if (!page.hasNewer) return;
      if (cursor.seq <= before.seq)
        throw new Error("Timeline catch-up did not advance");
    }
  }
  async function timeline(
    payload: Extract<PaseoAgentTimelineEvent, { timestamp: string }>,
  ) {
    if (payload.event.type !== "timeline") return;
    const { epoch, seq } = payload;
    if (epoch === undefined || seq === undefined)
      throw new Error("Timeline event has no epoch or sequence");
    if (epoch !== cursor?.epoch) await refetchTail();
    if (!isActive() || !cursor || cursor.epoch !== epoch) return;
    if (seq <= cursor.seq) return;
    if (seq > cursor.seq + 1) await catchUp();
    if (!isActive() || !cursor || cursor.epoch !== epoch) return;
    if (seq <= cursor.seq) return;
    if (seq !== cursor.seq + 1)
      throw new Error("Timeline catch-up left a sequence gap");
    const row: TimelineRow = {
      seq,
      timestamp: payload.timestamp,
      item: payload.event.item,
    };
    cursor = { epoch, seq };
    publish({
      ...snapshot,
      status: "ready",
      epoch,
      error: null,
      rows: [...snapshot.rows, row].slice(-500),
    });
  }
  function removePermission(requestId: string) {
    const pendingPermissions = snapshot.pendingPermissions.filter(
      (request) => request.id !== requestId,
    );
    publish({ ...snapshot, pendingPermissions });
  }
  async function process(payload: PaseoAgentTimelineEvent) {
    if (!isActive()) return;
    const event = payload.event;
    switch (event.type) {
      case "timeline":
        if ("timestamp" in payload) await timeline(payload);
        return;
      case "replacement":
        await refetchTail();
        return;
      case "subscription_restored":
        await catchUp();
        return;
      case "error":
        fail(event.error);
        return;
      case "turn_started":
        publish({
          ...snapshot,
          turn: { kind: "running", turnId: event.turnId },
        });
        return;
      case "turn_completed":
      case "turn_canceled":
        publish({ ...snapshot, turn: { kind: "idle" } });
        return;
      case "turn_failed":
        publish({
          ...snapshot,
          turn: { kind: "failed", message: event.error },
        });
        return;
      case "attention_required": {
        if (event.reason === "permission") return;
        const preserveFailure =
          event.reason === "error" && snapshot.turn.kind === "failed";
        if (preserveFailure) return;
        const turn: TurnState =
          event.reason === "error"
            ? { kind: "failed", message: "Agent requires attention" }
            : { kind: "idle" };
        publish({ ...snapshot, turn });
        return;
      }
      case "permission_requested": {
        const permissions = snapshot.pendingPermissions.filter(
          (request) => request.id !== event.request.id,
        );
        publish({
          ...snapshot,
          pendingPermissions: [...permissions, event.request],
        });
        return;
      }
      case "permission_resolved":
        removePermission(event.requestId);
        return;
      default:
        return;
    }
  }
  function receive(payload: PaseoAgentTimelineEvent) {
    if (!isActive()) return;
    if (payload.event.type === "error") {
      fail(payload.event.error);
      return;
    }
    if (buffered) {
      buffered.push(payload);
      return;
    }
    queue = queue.then(() => process(payload)).catch(fail);
  }
  async function bootstrap() {
    try {
      const subscription = port.subscribe(receive);
      release = subscription;
      if (!isActive()) {
        stopSubscription();
        return;
      }
      await subscription.ready;
      if (!isActive()) return;
      await refetchTail();
      while (isActive() && buffered && buffered.length > 0) {
        const payload = buffered.shift();
        if (payload) await process(payload);
      }
      if (isActive()) {
        buffered = null;
        phase = "ready";
      }
    } catch (error) {
      fail(error);
    }
  }
  function open(): Promise<void> {
    if (opening) return opening;
    if (phase !== "new") return Promise.resolve();
    phase = "opening";
    opening = bootstrap();
    return opening;
  }
  async function action(operation: () => Promise<void>) {
    if (!isActive()) return;
    publish({ ...snapshot, lastNotice: null });
    try {
      await operation();
      if (isActive()) publish({ ...snapshot, lastActionError: null });
    } catch (error) {
      if (isActive())
        publish({ ...snapshot, lastActionError: errorMessage(error) });
    }
  }
  async function send(text: string) {
    const prompt = text.trim();
    if (prompt.length === 0) return;
    await action(() => port.send(prompt));
  }
  async function respond(requestId: string, response: AgentPermissionResponse) {
    await action(async () => {
      await port.respondToPermission(requestId, response);
      if (isActive()) removePermission(requestId);
    });
  }
  async function cancel() {
    await action(() => port.cancel());
  }
  async function setMode(modeId: string) {
    await action(async () => {
      const notice = await port.setMode(modeId);
      if (isActive()) publish({ ...snapshot, lastNotice: notice });
    });
  }
  async function setModel(modelId: string) {
    await action(() => port.setModel(modelId));
  }
  async function rename(name: string) {
    await action(() => port.rename(name));
  }
  async function archive() {
    await action(() => port.archive());
  }
  function close() {
    if (phase === "closed") return;
    phase = "closed";
    buffered = null;
    stopSubscription();
    snapshot = { ...snapshot, status: "closed" };
    emitter.clear();
  }
  function getSnapshot() {
    return snapshot;
  }
  return {
    getSnapshot,
    subscribe: emitter.subscribe,
    open,
    close,
    send,
    respond,
    cancel,
    setMode,
    setModel,
    rename,
    archive,
  };
}
