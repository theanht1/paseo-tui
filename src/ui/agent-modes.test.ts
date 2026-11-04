import { expect, test } from "vitest";
import { nextMode } from "./agent-modes.js";

const availableModes = [
  { id: "ask", label: "Ask" },
  { id: "auto", label: "Auto" },
];
test("cycles modes in order and wraps", () => {
  expect(nextMode({ currentModeId: "ask", availableModes })).toBe("auto");
  expect(nextMode({ currentModeId: "auto", availableModes })).toBe("ask");
  expect(nextMode({ currentModeId: "unknown", availableModes })).toBe("ask");
});
test("requires at least two modes", () => {
  expect(nextMode({ currentModeId: null, availableModes: [] })).toBeNull();
  expect(
    nextMode({
      currentModeId: "ask",
      availableModes: availableModes.slice(0, 1),
    }),
  ).toBeNull();
});
