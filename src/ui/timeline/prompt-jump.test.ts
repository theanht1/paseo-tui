import { describe, expect, it } from "vitest";
import { promptTarget } from "./prompt-jump.js";

describe("promptTarget", () => {
  const owners = new Map([
    [40, "user:40"],
    [41, "assistant:41"],
  ]);
  it("targets the loaded user block", () => {
    expect(promptTarget(40, owners, "e", "e")).toEqual({
      kind: "loaded",
      key: "user:40",
    });
  });
  it("pages an unloaded prompt in by its sequence", () => {
    expect(promptTarget(3, owners, "e", "e")).toEqual({
      kind: "unloaded",
      seq: 3,
    });
  });
  it("refuses a prompt from another history (rewound, or not loaded yet)", () => {
    expect(promptTarget(40, owners, "new", "old")).toEqual({ kind: "stale" });
    expect(promptTarget(40, owners, null, "old")).toEqual({ kind: "stale" });
  });
});
