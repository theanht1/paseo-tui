import { describe, expect, it } from "vitest";
import {
  contextDetailRows,
  contextMeterText,
  contextWindow,
  formatTokenCount,
} from "./context-window.js";

describe("contextWindow", () => {
  it("measures used over max", () => {
    const window = contextWindow({
      contextWindowUsedTokens: 84_000,
      contextWindowMaxTokens: 200_000,
      totalCostUsd: 0.1234,
    });
    expect(window).toEqual({
      kind: "measured",
      percentage: 42,
      usedTokens: 84_000,
      maxTokens: 200_000,
      level: "ok",
      cost: "$0.12",
    });
    expect(contextMeterText(window)).toBe("ctx 42% 84k/200k");
    expect(contextDetailRows(window)).toEqual([
      "42% used",
      "84k / 200k tokens",
      "Session cost $0.12",
    ]);
  });

  it("levels follow the GUI thresholds", () => {
    const level = (percentage: number) => {
      const window = contextWindow({
        contextWindowUsedTokens: percentage * 10,
        contextWindowMaxTokens: 1000,
      });
      return window.kind === "measured" ? window.level : window.kind;
    };
    expect(level(69.9)).toBe("ok");
    expect(level(70)).toBe("warn");
    expect(level(90)).toBe("warn");
    expect(level(90.1)).toBe("error");
  });

  it("no data for missing or zero max", () => {
    for (const usage of [
      undefined,
      {},
      { contextWindowMaxTokens: 0, contextWindowUsedTokens: 10 },
      { contextWindowMaxTokens: 100, contextWindowUsedTokens: Number.NaN },
    ]) {
      const window = contextWindow(usage);
      expect(window).toEqual({ kind: "none" });
      expect(contextMeterText(window)).toBe("");
      expect(contextDetailRows(window)).toEqual(["No context data"]);
    }
  });

  it("tiny and zero costs", () => {
    const cost = (totalCostUsd: number) => {
      const window = contextWindow({
        contextWindowUsedTokens: 1,
        contextWindowMaxTokens: 10,
        totalCostUsd,
      });
      return window.kind === "measured" ? window.cost : "none";
    };
    expect(cost(0.004)).toBe("$0.0040");
    expect(cost(0)).toBeNull();
  });
});

describe("formatTokenCount", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1_499)).toBe("1k");
    expect(formatTokenCount(1_500_000)).toBe("2m");
  });
});
