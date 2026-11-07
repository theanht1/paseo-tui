import { expect, it } from "vitest";
import { versionRows } from "./version.js";

it("shows versions and compares connected daemons only to the client", () => {
  expect(
    versionRows({ tui: "1.0", client: "0.15.0" }, [
      {
        id: "a",
        label: "local",
        health: { kind: "connected" },
        version: "v0.15.0",
      },
      {
        id: "b",
        label: "work",
        health: { kind: "connected" },
        version: "0.16.2",
      },
      {
        id: "c",
        label: "laptop",
        health: {
          kind: "offline",
          since: 0,
          lastError: null,
          nextRetryAt: null,
        },
        version: null,
      },
      {
        id: "d",
        label: "unknown",
        health: { kind: "connected" },
        version: null,
      },
    ]),
  ).toEqual([
    "paseo-tui        1.0",
    "@getpaseo/client 0.15.0",
    "─ hosts ─",
    "local   daemon v0.15.0",
    "work    daemon 0.16.2   ⚠ differs from client 0.15.0",
    "laptop  offline",
    "unknown daemon version unknown",
  ]);
});

it("does not flag mismatches when the client version is missing", () => {
  expect(
    versionRows({ tui: "1", client: null }, [
      { id: "a", label: "a", health: { kind: "connected" }, version: "2" },
    ]).join("\n"),
  ).not.toContain("differs");
});
