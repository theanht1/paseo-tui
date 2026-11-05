import { expect, it } from "vitest";
import {
  loadThinkingPreference,
  type PreferenceStorage,
  thinkingPreferencePath,
} from "./thinking-preference.js";

it("defaults to medium and remembers a selection across separate sessions", async () => {
  let contents: string | null = null;
  const storage: PreferenceStorage = {
    read: async () => contents,
    write: async (value) => {
      contents = value;
    },
  };
  const first = await loadThinkingPreference(storage);
  expect(first.get()).toBe("medium");
  first.set("high");
  await first.flush();
  const restarted = await loadThinkingPreference(storage);
  expect(restarted.get()).toBe("high");
  expect(
    thinkingPreferencePath({ XDG_CONFIG_HOME: "/config" }, "/home/user"),
  ).toBe("/config/paseo-tui/preferences.json");
  expect(thinkingPreferencePath({}, "/home/user")).toBe(
    "/home/user/.config/paseo-tui/preferences.json",
  );
});
it("reports invalid settings and write errors rather than pretending persistence succeeded", async () => {
  await expect(
    loadThinkingPreference({
      read: async () => '{"thinkingLevel":2}',
      write: async () => {},
    }),
  ).rejects.toThrow(/thinking/);
  const preference = await loadThinkingPreference({
    read: async () => null,
    write: async () => {
      throw Error("Disk full");
    },
  });
  preference.set("high");
  await expect(preference.flush()).rejects.toThrow("Disk full");
});
it("persists the local config atomically and reloads it from disk", async () => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { filePreferenceStorage } = await import("./thinking-preference.js");
  const dir = await mkdtemp(join(tmpdir(), "paseo-thinking-"));
  try {
    const storage = filePreferenceStorage(
      join(dir, "nested", "preferences.json"),
    );
    const first = await loadThinkingPreference(storage);
    first.set("high");
    await first.flush();
    expect((await loadThinkingPreference(storage)).get()).toBe("high");
    expect(
      await readFile(join(dir, "nested", "preferences.json"), "utf8"),
    ).toContain('"thinkingLevel":"high"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
