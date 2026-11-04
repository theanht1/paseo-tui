import { expect, inject, it } from "vitest";
import { connect } from "../connection/connect.js";
import { createSession } from "./session.js";

it("loads the real daemon's agents through a session", async () => {
  const connection = await connect({
    kind: "host",
    connection: inject("daemonHost"),
  });
  const session = createSession(connection);
  try {
    await session.agents.load();
    expect(session.agents.getSnapshot().error).toBeNull();
    expect(
      (await session.agentsPort.providers()).some(
        (provider) => provider.id === "mock" && provider.available,
      ),
    ).toBe(true);
  } finally {
    await session.close();
    await connection.close();
  }
});
