import { expect, it } from "vitest";
import { createModifierHold, modifierKey } from "./modifier-hold.js";

function manualTimers() {
  const pending = new Set<() => void>();
  return {
    schedule(run: () => void) {
      pending.add(run);
      return () => pending.delete(run);
    },
    fire() {
      for (const run of [...pending]) {
        pending.delete(run);
        run();
      }
    },
  };
}

it("reads kitty modifier-only key presses, repeats and releases", () => {
  expect(modifierKey("\u001b[57444;9u")).toEqual({
    modifier: "super",
    down: true,
  });
  expect(modifierKey("\u001b[57450;9:2u")).toEqual({
    modifier: "super",
    down: true,
  });
  expect(modifierKey("\u001b[57444;1:3u")).toEqual({
    modifier: "super",
    down: false,
  });
  expect(modifierKey("\u001b[57443;3u")).toEqual({
    modifier: "alt",
    down: true,
  });
  expect(modifierKey("\u001b[57449;1:3u")).toEqual({
    modifier: "alt",
    down: false,
  });
  expect(modifierKey("\u001b[57441;2u")).toEqual({
    modifier: "shift",
    down: true,
  });
  expect(modifierKey("\u001b[49;9u")).toBeNull();
  expect(modifierKey("a")).toBeNull();
});

it("shows hints once the watched modifier is held, hides on release, and swallows modifier keys", () => {
  const timers = manualTimers();
  const hold = createModifierHold(["super"], timers.schedule);
  let changes = 0;
  hold.subscribe(() => changes++);
  expect(hold.input("\u001b[57444;9u")).toBe(true);
  expect(hold.getSnapshot()).toBe(false);
  timers.fire();
  expect(hold.getSnapshot()).toBe(true);
  expect(hold.input("\u001b[57444;9:2u")).toBe(true);
  expect(hold.input("\u001b[49;9u")).toBe(false);
  expect(hold.getSnapshot()).toBe(true);
  expect(hold.input("\u001b[57444;1:3u")).toBe(true);
  expect(hold.getSnapshot()).toBe(false);
  expect(changes).toBe(2);
  expect(hold.input("\u001b[57441;2u")).toBe(true);
  expect(hold.input("\u001b[57443;3u")).toBe(true);
  timers.fire();
  expect(hold.getSnapshot()).toBe(false);
});

it("never shows hints for a quick tap, and resets when the terminal loses focus", () => {
  const timers = manualTimers();
  const hold = createModifierHold(["alt"], timers.schedule);
  hold.input("\u001b[57443;3u");
  hold.input("\u001b[57443;1:3u");
  timers.fire();
  expect(hold.getSnapshot()).toBe(false);
  hold.input("\u001b[57449;3u");
  timers.fire();
  expect(hold.getSnapshot()).toBe(true);
  hold.reset();
  expect(hold.getSnapshot()).toBe(false);
});

it("watches several modifiers at once (Cmd or Alt on macOS)", () => {
  const timers = manualTimers();
  const hold = createModifierHold(["super", "alt"], timers.schedule);
  hold.input("\u001b[57443;3u");
  timers.fire();
  expect(hold.getSnapshot()).toBe(true);
  hold.input("\u001b[57443;1:3u");
  expect(hold.getSnapshot()).toBe(false);
  hold.input("\u001b[57444;9u");
  timers.fire();
  expect(hold.getSnapshot()).toBe(true);
});
