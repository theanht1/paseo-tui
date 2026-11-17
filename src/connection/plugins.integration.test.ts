import { expect, inject, it, vi } from "vitest";
import { connect } from "./connect.js";

it("lists the fixture server plugin and round-trips its RPC", async () => {
  const connection = await connect({
    kind: "host",
    connection: inject("daemonHost"),
  });
  try {
    const plugins = connection.plugins;
    if (plugins === null) throw new Error("The daemon lacks plugin support");
    await vi.waitFor(
      async () =>
        expect(await plugins.list()).toContainEqual({
          id: "tui-fixture",
          running: true,
        }),
      { timeout: 30000, interval: 200 },
    );
    expect(await plugins.rpc("tui-fixture", "echo", { text: "hi" })).toEqual({
      text: "hi",
      from: "tui-fixture",
    });
    await expect(plugins.rpc("tui-fixture", "missing", {})).rejects.toThrow();
  } finally {
    await connection.close();
  }
}, 60000);
