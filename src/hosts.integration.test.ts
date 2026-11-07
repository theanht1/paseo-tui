import { expect, inject, it } from "vitest";
import { connect } from "./connection/connect.js";
import { connectedHost, createHosts } from "./hosts.js";
import { createMultiHost } from "./multi-host.js";
import { startTestDaemon } from "./test/daemon-harness.js";

it("keeps the healthy host working and quiet when another daemon dies", async () => {
  const doomed = await startTestDaemon();
  const healthy = inject("daemonHost");
  const hosts = createHosts({
    initial: {
      target: { kind: "host", connection: healthy },
      live: connectedHost(await connect({ kind: "host", connection: healthy })),
    },
    schedule: () => () => {},
    registry: {
      list: () => [
        { connection: doomed.host, label: "Doomed", password: null },
      ],
      add: async (host) => host,
    },
    open: async (target, label, password) =>
      connectedHost(await connect(target, label, password)),
  });
  try {
    await hosts.ready();
    const merged = createMultiHost(hosts);
    const stop = merged.directory.subscribe(() => {});
    await doomed.stop();
    await expect
      .poll(
        () =>
          hosts.health.getSnapshot().find((entry) => entry.label === "Doomed")
            ?.health.kind,
        { timeout: 10000 },
      )
      .toBe("offline");
    await expect.poll(() => merged.directory.getSnapshot().error).toBeNull();
    await merged.refresh();
    const history = await merged.history?.list("");
    expect(history?.hostErrors).toEqual([]);
    expect(hosts.health.getSnapshot()[0]?.version).toMatch(/\d/);
    stop();
  } finally {
    await hosts.close();
  }
}, 60000);
