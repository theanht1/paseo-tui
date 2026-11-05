import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
export interface PreferenceStorage {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}
export interface ThinkingPreference {
  get(): string;
  set(level: string): void;
  flush(): Promise<void>;
}
export function thinkingPreferencePath(
  env: NodeJS.ProcessEnv,
  home: string,
): string {
  return join(
    env.XDG_CONFIG_HOME || join(home, ".config"),
    "paseo-tui",
    "preferences.json",
  );
}
export function filePreferenceStorage(path: string): PreferenceStorage {
  return {
    async read() {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      }
    },
    async write(contents) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temp = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, contents, { mode: 0o600 });
        await rename(temp, path);
      } finally {
        await rm(temp, { force: true });
      }
    },
  };
}
export async function loadThinkingPreference(
  storage: PreferenceStorage,
): Promise<ThinkingPreference> {
  const contents = await storage.read();
  let level = "medium";
  if (contents !== null) {
    const parsed: unknown = JSON.parse(contents);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw Error("Invalid thinking preference configuration");
    if ("thinkingLevel" in parsed) {
      if (
        typeof parsed.thinkingLevel !== "string" ||
        !parsed.thinkingLevel.trim()
      )
        throw Error("Invalid thinking preference level");
      level = parsed.thinkingLevel;
    }
  }
  let pending = Promise.resolve();
  return {
    get: () => level,
    set(next) {
      level = next;
      pending = pending
        .catch(() => {})
        .then(() =>
          storage.write(`${JSON.stringify({ thinkingLevel: next })}\n`),
        );
      void pending.catch(() => {});
    },
    flush: () => pending,
  };
}
