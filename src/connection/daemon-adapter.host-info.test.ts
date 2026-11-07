import { expect, test } from "vitest";
import {
  createHostInfoAdapter,
  type HostInfoDaemon,
} from "./daemon-adapter.js";

test("reports the connected daemon's version and retries on demand", () => {
  let info: { version: string | null } | null = { version: "0.15.0" };
  const retries: unknown[] = [];
  const daemon: HostInfoDaemon = {
    getLastServerInfoMessage: () => info,
    ensureConnected: (options) => {
      retries.push(options);
    },
  };
  const host = createHostInfoAdapter(daemon);
  expect(host.version()).toBe("0.15.0");
  info = null;
  expect(host.version()).toBeNull();
  info = { version: null };
  expect(host.version()).toBeNull();
  host.reconnect();
  expect(retries).toEqual([undefined]);
});
