import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { expect, it } from "vitest";
import { agents, settle, settleUntil, setup } from "../test/app-harness.js";

/** 400 rows: an old prompt mentioning the needle, then filler, then a recent mention. */
function longChat(): AgentTimelineItem[] {
  return [
    { type: "user_message", text: "ancient needle question" },
    ...Array.from(
      { length: 398 },
      (_, index): AgentTimelineItem => ({
        type: "assistant_message",
        text: `filler ${index}\n`,
      }),
    ),
    { type: "user_message", text: "recent needle question" },
  ];
}
async function searchFor(
  app: Awaited<ReturnType<typeof setup>>["app"],
  query: string,
) {
  for (const key of ["\r", "/", query, "\r"]) {
    app.stdin.write(key);
    await settle();
  }
}

it("finds matches outside the loaded window and pages back to them with n", async () => {
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    () => longChat(),
    () => ({ tail: 50, search: true }),
  );
  await searchFor(app, "needle");
  await settleUntil(app.lastFrame, "match 2/2");
  expect(app.lastFrame()).toContain("recent needle question");
  app.stdin.write("n");
  await settleUntil(app.lastFrame, "ancient needle question");
  expect(app.lastFrame()).toContain("match 1/2");
  app.stdin.write("N");
  await settleUntil(app.lastFrame, "recent needle question");
  expect(app.lastFrame()).toContain("match 2/2");
});

it("jumps to the newest daemon match when nothing loaded matches", async () => {
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    () => longChat(),
    () => ({ tail: 50, search: true }),
  );
  await searchFor(app, "ancient");
  await settleUntil(app.lastFrame, "ancient needle question");
  expect(app.lastFrame()).toContain("match 1/1");
});

it("searches only loaded rows when the daemon lacks agentHistorySearch", async () => {
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    () => longChat(),
    () => ({ tail: 50, search: false }),
  );
  await searchFor(app, "ancient");
  expect(app.lastFrame()).toContain("no match");
});
