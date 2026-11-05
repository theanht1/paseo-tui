import { expect, it } from "vitest";
import {
  notificationSequence,
  parseNotifyStyle,
} from "./terminal-notification.js";

const note = { title: "Alpha", body: "Needs permission: Bash" };

it("encodes OSC 9, OSC 777, and a plain bell", () => {
  expect(notificationSequence("osc9", note, {})).toBe(
    "\x1b]9;Alpha: Needs permission: Bash\x07",
  );
  expect(notificationSequence("osc777", note, {})).toBe(
    "\x1b]777;notify;Alpha;Needs permission: Bash\x07",
  );
  expect(notificationSequence("bell", note, {})).toBe("\x07");
});

it("strips control characters and keeps OSC 777 fields separate", () => {
  expect(
    notificationSequence(
      "osc777",
      { title: "a;b\x1b]x", body: "line\nnext\x07" },
      {},
    ),
  ).toBe("\x1b]777;notify;a,b]x;line next\x07");
});

it("wraps sequences in tmux passthrough inside tmux", () => {
  expect(notificationSequence("osc9", note, { TMUX: "/tmp/tmux" })).toBe(
    "\x1bPtmux;\x1b\x1b]9;Alpha: Needs permission: Bash\x07\x1b\\",
  );
  expect(notificationSequence("bell", note, { TMUX: "/tmp/tmux" })).toBe(
    "\x07",
  );
});

it("parses the --notify option", () => {
  expect(parseNotifyStyle(undefined)).toBe("osc9");
  expect(parseNotifyStyle("off")).toBe("off");
  expect(() => parseNotifyStyle("loud")).toThrow(
    "--notify must be one of osc9, osc777, bell, off",
  );
});
