import { expect, test } from "vitest";
import { timelineStore } from "../../test/fixtures.js";
import { createSubagentTimelines } from "./subagent-timelines.js";

function setup() {
  const log: string[] = [];
  const timelines = createSubagentTimelines((parentAgentId, subagentId) => {
    const name = `${parentAgentId}/${subagentId}`;
    return timelineStore({
      open: async () => {
        log.push(`open ${name}`);
      },
      close: () => {
        log.push(`close ${name}`);
      },
    });
  });
  return { timelines, log };
}

test("opens a subagent timeline once and reuses it", () => {
  const { timelines, log } = setup();
  const first = timelines.get({ parentAgentId: "a", id: "s1" });
  expect(timelines.get({ parentAgentId: "a", id: "s1" })).toBe(first);
  expect(log).toEqual(["open a/s1"]);
});

test("retain closes timelines no pane shows any more", () => {
  const { timelines, log } = setup();
  timelines.get({ parentAgentId: "a", id: "s1" });
  timelines.get({ parentAgentId: "a", id: "s2" });
  timelines.retain([{ parentAgentId: "a", subagentId: "s2" }]);
  expect(log).toEqual(["open a/s1", "open a/s2", "close a/s1"]);
  const reopened = timelines.get({ parentAgentId: "a", id: "s1" });
  expect(reopened).toBeDefined();
  expect(log.at(-1)).toBe("open a/s1");
});

test("close closes every open timeline", () => {
  const { timelines, log } = setup();
  timelines.get({ parentAgentId: "a", id: "s1" });
  timelines.get({ parentAgentId: "b", id: "s1" });
  timelines.close();
  expect(log.slice(2)).toEqual(["close a/s1", "close b/s1"]);
});
