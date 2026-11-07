import { expect, it } from "vitest";
import { shutdown } from "./shutdown.js";

it("saves every preference even when closing the hosts fails", async () => {
  const saved: string[] = [];
  const save = (name: string) => ({
    async flush() {
      saved.push(name);
    },
  });
  await expect(
    shutdown([save("order"), save("labels")], async () => {
      throw Error("Daemon client closed");
    }),
  ).rejects.toThrow("Daemon client closed");
  expect(saved).toEqual(["order", "labels"]);
});
