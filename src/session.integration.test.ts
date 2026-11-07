import { expect, inject, it } from "vitest";
import { connect } from "./connection/connect.js";
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
    await expect
      .poll(
        async () =>
          (await session.agentsPort.providers()).some(
            (provider) => provider.id === "mock" && provider.available,
          ),
        { timeout: 15000 },
      )
      .toBe(true);
  } finally {
    await session.close();
    await connection.close();
  }
});

it("preloads the host's provider catalog at session start and refreshes it", async () => {
  const connection = await connect({
    kind: "host",
    connection: inject("daemonHost"),
  });
  const session = createSession(connection);
  try {
    await Promise.all([session.agents.load(), session.directory.load()]);
    await session.providers.load();
    const snapshot = session.providers.getSnapshot();
    expect(
      snapshot.kind === "ready" &&
        snapshot.entries.some((entry) => entry.provider === "mock"),
    ).toBe(true);
    await session.refreshProviders();
    expect(
      (await session.agentsPort.models("mock")).some(
        (model) => model.id === "ten-second-stream",
      ),
    ).toBe(true);
  } finally {
    await session.close();
    await connection.close();
  }
});

it("replicates the host's label catalog and assigns a label to a workspace", async () => {
  const connection = await connect({
    kind: "host",
    connection: inject("daemonHost"),
  });
  const session = createSession(connection);
  const agent = await session.agentsPort.create({
    provider: "mock",
    model: "ten-second-stream",
    modeId: null,
    cwd: process.cwd(),
    title: "Labels",
    prompt: null,
  });
  try {
    const labels = session.labels;
    if (!labels) throw Error("the test daemon should have workspaceLabels");
    await expect
      .poll(() => labels.getSnapshot().kind, { timeout: 15000 })
      .toBe("ready");
    const workspaceId = agent.workspaceId;
    if (!workspaceId) throw Error("the agent should have a workspace");
    const name = `it-${Date.now()}`;
    expect(
      await labels.setAssignment({
        workspaceId,
        label: { name, color: "teal" },
        assigned: true,
      }),
    ).toContain(name);
    await expect
      .poll(() => {
        const snapshot = labels.getSnapshot();
        return snapshot.kind === "ready"
          ? snapshot.labels.some((label) => label.name === name)
          : false;
      })
      .toBe(true);
    await session.directory.load();
    await expect
      .poll(
        () =>
          session.directory
            .getSnapshot()
            .workspaces.find((row) => row.id === workspaceId)?.labels ?? [],
        { timeout: 10000 },
      )
      .toContain(name);
    await labels.load();
    expect(labels.getSnapshot()).toMatchObject({ kind: "ready", error: null });
    expect(
      await labels.setAssignment({
        workspaceId,
        label: { name, color: "teal" },
        assigned: false,
      }),
    ).not.toContain(name);
  } finally {
    await connection.api.agents.ref(agent.id).archive();
    await session.close();
    await connection.close();
  }
});
