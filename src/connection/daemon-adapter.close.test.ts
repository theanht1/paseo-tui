import { expect, test } from "vitest";
import { closeDaemon } from "./daemon-adapter.js";

test("closing tolerates the client rejecting a subscription release it cut off", async () => {
  let closes = 0;
  await closeDaemon({
    async close() {
      closes++;
      throw new Error("Daemon client closed");
    },
  });
  expect(closes).toBe(1);
});

test("closing still reports other failures", async () => {
  await expect(
    closeDaemon({
      async close() {
        throw new Error("socket exploded");
      },
    }),
  ).rejects.toThrow("socket exploded");
});
