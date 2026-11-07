import { describe, expect, it } from "vitest";
import type { SlashCommand } from "../../connection/ports.js";
import type { TurnState } from "../../state/timeline-store.js";
import { timelineStore } from "../../test/fixtures.js";
import {
  canClear,
  clearSession,
  clearSessionStep,
  isSessionSwitchNotice,
  usageSinceClear,
} from "./clear-session.js";

function command(name: string): SlashCommand {
  return { name, description: "", argumentHint: "", kind: "command" };
}
function store(turn: TurnState) {
  const calls: string[] = [];
  const base = timelineStore();
  return {
    calls,
    store: timelineStore({
      getSnapshot: () => ({ ...base.getSnapshot(), turn }),
      send: async (text) => {
        calls.push(`send ${text}`);
      },
      interrupt: async (text) => {
        calls.push(`interrupt ${text}`);
      },
    }),
  };
}

describe("canClear", () => {
  it("needs a clear command in the agent's slash-command list", () => {
    expect(canClear([command("compact"), command("clear")])).toBe(true);
    expect(canClear([command("compact"), command("clear-cache")])).toBe(false);
    expect(canClear([])).toBe(false);
  });
});

describe("clearSession", () => {
  it("sends /clear when the agent is idle", async () => {
    const { calls, store: idle } = store({ kind: "idle" });
    await clearSession(idle);
    expect(calls).toEqual(["send /clear"]);
  });
  it("sends /clear after a failed turn", async () => {
    const { calls, store: failed } = store({ kind: "failed", message: "x" });
    await clearSession(failed);
    expect(calls).toEqual(["send /clear"]);
  });
  it("interrupts the running turn with /clear", async () => {
    const { calls, store: running } = store({ kind: "running" });
    await clearSession(running);
    expect(calls).toEqual(["interrupt /clear"]);
  });
  it("interrupts a turn that is already stopping", async () => {
    const { calls, store: stopping } = store({
      kind: "stopping",
      phase: "requested",
    });
    await clearSession(stopping);
    expect(calls).toEqual(["interrupt /clear"]);
  });
});

describe("clearSessionStep", () => {
  it("asks first, then clears and reports it", async () => {
    const { calls, store: idle } = store({ kind: "idle" });
    const cleared: string[] = [];
    const step = clearSessionStep(idle, () => cleared.push("cleared"));
    if (step.kind !== "confirm") throw Error("expected a confirm step");
    expect(step.title).toBe("Clear this session? The conversation is reset.");
    expect(calls).toEqual([]);
    step.confirm();
    await Promise.resolve();
    expect(calls).toEqual(["send /clear"]);
    expect(cleared).toEqual(["cleared"]);
  });
});

describe("isSessionSwitchNotice", () => {
  it("matches the daemon's whole notice only", () => {
    expect(
      isSessionSwitchNotice("Claude switched to a new session: abc -> def"),
    ).toBe(true);
    expect(isSessionSwitchNotice("Claude switched to a new session")).toBe(
      false,
    );
    expect(
      isSessionSwitchNotice(
        "I said: Claude switched to a new session: abc -> def",
      ),
    ).toBe(false);
  });
});

describe("usageSinceClear", () => {
  const usage = {
    contextWindowUsedTokens: 90_000,
    contextWindowMaxTokens: 200_000,
  };
  it("hides the usage measured before the clear", () => {
    expect(usageSinceClear(usage, { usedTokens: 90_000 })).toBeUndefined();
  });
  it("shows the first usage that differs", () => {
    const next = { ...usage, contextWindowUsedTokens: 12_000 };
    expect(usageSinceClear(next, { usedTokens: 90_000 })).toBe(next);
  });
  it("passes usage through when nothing was cleared", () => {
    expect(usageSinceClear(usage, undefined)).toBe(usage);
  });
});
