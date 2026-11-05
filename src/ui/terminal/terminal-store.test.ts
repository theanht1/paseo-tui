import type { TerminalStreamEvent } from "@getpaseo/client";
import { expect, it } from "vitest";
import type { TerminalStreamPort } from "../../connection/ports.js";
import { createTerminalStore } from "./terminal-store.js";

it("streams ANSI replay and live bytes, forwards input and resize, and detaches", async () => {
  let receive: (event: TerminalStreamEvent) => void = () => {};
  const input: string[] = [];
  const sizes: number[][] = [];
  const output: (string | Uint8Array)[] = [];
  const replays: unknown[] = [];
  let detached = false;
  const port: TerminalStreamPort = {
    observe(_id, onEvent) {
      receive = onEvent;
      return {
        ready: Promise.resolve(),
        async close() {
          detached = true;
        },
      };
    },
    write(_id, data) {
      input.push(data);
    },
    resize(_id, cols, rows) {
      sizes.push([cols, rows]);
    },
  };
  const store = createTerminalStore("t", port);
  store.start({
    beginReplay(cols, rows) {
      replays.push([cols, rows]);
    },
    endReplay() {
      replays.push("end");
    },
    write(data) {
      output.push(data);
    },
  });
  const prefix = { terminalId: "t", subscriptionId: "s" };
  receive({
    ...prefix,
    type: "replay",
    replay: { type: "begin", cols: 80, rows: 24 },
  });
  const red = new TextEncoder().encode("\x1b[31mred\x1b[0m");
  receive({ ...prefix, type: "replay", replay: { type: "data", data: red } });
  receive({ ...prefix, type: "replay", replay: { type: "end" } });
  const live = new TextEncoder().encode("\r\x1b[2Kprompt> ");
  receive({ ...prefix, type: "output", data: live });
  expect(output).toEqual([red, live]);
  expect(replays).toEqual([[80, 24], "end"]);
  expect(() =>
    Reflect.apply(receive, undefined, [{ ...prefix, type: "future-stream" }]),
  ).not.toThrow();
  expect(output.at(-1)).toBe("\r\n\x1b[2m[future-stream]\x1b[0m\r\n");
  store.write("\x03");
  store.resize(90, 20);
  await Promise.resolve();
  expect(input).toEqual(["\x03"]);
  expect(sizes).toEqual([[90, 20]]);
  store.close();
  expect(detached).toBe(true);
  receive({ ...prefix, type: "output", data: red });
  expect(output).toHaveLength(3);
});

it("reports stream failures without polling or swallowing errors", async () => {
  const store = createTerminalStore("t", {
    observe() {
      return {
        ready: Promise.reject(Error("stream failed")),
        async close() {},
      };
    },
    write() {
      throw Error("input failed");
    },
    resize() {},
  });
  store.start({ write() {}, beginReplay() {}, endReplay() {} });
  await Promise.resolve();
  expect(store.getSnapshot().error).toContain("stream failed");
  store.write("x");
  expect(store.getSnapshot().error).toContain("input failed");
  store.close();
});
