import { expect, it } from "vitest";
import { hostsPath, loadHostRegistry } from "./host-registry.js";

function memory(initial: string | null) {
  const storage = {
    text: initial,
    async read() {
      return storage.text;
    },
    async write(contents: string) {
      storage.text = contents;
    },
  };
  return storage;
}

it("keeps hosts in the config directory", () => {
  expect(hostsPath({}, "/home/me")).toBe(
    "/home/me/.config/paseo-tui/hosts.json",
  );
  expect(hostsPath({ XDG_CONFIG_HOME: "/cfg" }, "/home/me")).toBe(
    "/cfg/paseo-tui/hosts.json",
  );
});

it("starts empty, saves added hosts and reloads them", async () => {
  const storage = memory(null);
  const registry = await loadHostRegistry(storage, "hosts.json");
  expect(registry.list()).toEqual([]);
  await registry.add({
    connection: " build:6767 ",
    label: " Build ",
    password: "s3cret",
  });
  await registry.add({ connection: "ssh://me@box", label: "", password: "" });
  expect(registry.list()).toEqual([
    { connection: "build:6767", label: "Build", password: "s3cret" },
    { connection: "ssh://me@box", label: null, password: null },
  ]);
  expect(JSON.parse(storage.text ?? "")).toEqual({
    hosts: [
      { connection: "build:6767", label: "Build", password: "s3cret" },
      { connection: "ssh://me@box", label: null },
    ],
  });
  const reloaded = await loadHostRegistry(storage, "hosts.json");
  expect(reloaded.list()).toEqual(registry.list());
});

it("rejects blank and duplicate hosts", async () => {
  const registry = await loadHostRegistry(memory(null), "hosts.json");
  await expect(
    registry.add({ connection: " ", label: null, password: null }),
  ).rejects.toThrow("Enter a host address");
  await registry.add({ connection: "build:6767", label: null, password: null });
  await expect(
    registry.add({ connection: "build:6767", label: "again", password: null }),
  ).rejects.toThrow("build:6767 is already saved");
});

it("names the file when it is not a host list", async () => {
  await expect(
    loadHostRegistry(memory("{"), "/cfg/hosts.json"),
  ).rejects.toThrow("Invalid hosts file /cfg/hosts.json");
  await expect(
    loadHostRegistry(
      memory(JSON.stringify({ hosts: [{ label: "x" }] })),
      "/cfg/hosts.json",
    ),
  ).rejects.toThrow(
    "Invalid hosts file /cfg/hosts.json: hosts[0].connection must be a non-empty string",
  );
});

it("keeps a password typed into the address in the password field instead", async () => {
  const storage = memory(null);
  const registry = await loadHostRegistry(storage, "hosts.json");
  const saved = await registry.add({
    connection: "tcp://gpu:6767?password=hunter2",
    label: null,
    password: null,
  });
  expect(saved).toEqual({
    connection: "tcp://gpu:6767",
    label: null,
    password: "hunter2",
  });
  expect(storage.text).not.toContain("?password");
});

it("moves passwords out of saved addresses on load, keeping a separate one", async () => {
  const storage = memory(
    JSON.stringify({
      hosts: [
        { connection: "tcp://gpu:6767?password=hunter2" },
        { connection: "ssh://me@box?password=old", password: "kept" },
        {
          connection: "wss://paseo.example.com/?password=pw&x=1",
          label: "Web",
        },
      ],
    }),
  );
  const registry = await loadHostRegistry(storage, "hosts.json");
  expect(registry.list()).toEqual([
    { connection: "tcp://gpu:6767", label: null, password: "hunter2" },
    { connection: "ssh://me@box", label: null, password: "kept" },
    {
      connection: "wss://paseo.example.com/?x=1",
      label: "Web",
      password: "pw",
    },
  ]);
  expect(storage.text).not.toContain("?password");
  expect(storage.text).not.toContain("&password");
});

it("leaves a hand-formatted file alone when there is nothing to move", async () => {
  const text = '{"hosts":[{"connection":"build:6767","label":"Build"}]}';
  const storage = memory(text);
  await loadHostRegistry(storage, "hosts.json");
  expect(storage.text).toBe(text);
});
