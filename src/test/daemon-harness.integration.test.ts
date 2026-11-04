import { expect, inject, it } from "vitest";
import { connect } from "../connection/connect.js";

it("exposes only mock providers from the isolated daemon", async () => {
  const connection = await connect({
    kind: "host",
    connection: inject("daemonHost"),
  });
  try {
    const providers = await connection.api.providers.listAvailable();
    expect(
      providers.providers.find((provider) => provider.provider === "mock")
        ?.available,
    ).toBe(true);
    expect(
      providers.providers
        .filter((provider) => provider.available)
        .map((provider) => provider.provider)
        .sort(),
    ).toEqual(["mock"]);
  } finally {
    await connection.close();
  }
});
