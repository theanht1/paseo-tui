import { expect, it } from "vitest";
import { fitHints, statusLabel, statusLine } from "./status-hints.js";

it("keeps whole hints and reserves the shortcuts suffix", () => {
  expect(fitHints(["j next", "very long hint", "k up"], 28)).toBe(
    "j next · k up · ? shortcuts",
  );
  expect(fitHints(["j next"], 11)).toBe("? shortcuts");
  expect(fitHints(["j next"], 20)).toBe("j next · ? shortcuts");
});
it("shrinks status information before dropping the shortcuts link", () => {
  const line = statusLine(30, "a very long connection label", [
    "Ctrl-N new tab",
  ]);
  expect(line.endsWith("? shortcuts")).toBe(true);
  expect(line.length).toBeLessThanOrEqual(30);
});
it("measures wide text in terminal cells without splitting graphemes", async () => {
  const { truncateCells } = await import("./status-hints.js");
  expect(truncateCells("界界界", 5)).toBe("界界");
  expect(truncateCells("e\u0301👩‍💻x", 3)).toBe("e\u0301👩‍💻");
  expect(fitHints(["界界", "x"], 18)).toBe("界界 · ? shortcuts");
});

it("shows the most urgent status message ahead of the connection label", () => {
  const idle = {
    label: "local",
    quitPending: false,
    notice: null,
    operation: null,
    createError: null,
  };
  expect(statusLabel(idle)).toBe("local");
  expect(statusLabel({ ...idle, createError: "no provider" })).toBe(
    "! no provider · local",
  );
  expect(
    statusLabel({ ...idle, operation: "Creating…", createError: "x" }),
  ).toBe("Creating…");
  expect(
    statusLabel({ ...idle, notice: "Copied", operation: "Creating…" }),
  ).toBe("Copied");
  expect(statusLabel({ ...idle, quitPending: true, notice: "Copied" })).toBe(
    "Press Ctrl+C again to quit",
  );
});
