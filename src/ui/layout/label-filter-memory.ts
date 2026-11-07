import { join } from "node:path";
import type { PreferenceStorage } from "../agent/thinking-preference.js";
import type { ExternalStore } from "../use-store.js";

/** The sidebar's label filter (label keys, `""` for Unlabelled), across restarts. */
export interface LabelFilterMemory extends ExternalStore<readonly string[]> {
  set(keys: readonly string[]): void;
  flush(): Promise<void>;
}

export function labelFilterPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(
    env.XDG_STATE_HOME || join(home, ".local", "state"),
    "paseo-tui",
    "label-filter.json",
  );
}

const NONE: readonly string[] = [];
function parseFile(text: string | null): readonly string[] {
  if (text === null) return NONE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NONE;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("labels" in parsed) ||
    !Array.isArray(parsed.labels)
  )
    return NONE;
  return parsed.labels.filter(
    (key: unknown): key is string => typeof key === "string",
  );
}

export async function loadLabelFilterMemory(
  storage: PreferenceStorage,
): Promise<LabelFilterMemory> {
  return createLabelFilterMemory(storage, parseFile(await storage.read()));
}
function createLabelFilterMemory(
  storage: PreferenceStorage,
  initial: readonly string[],
): LabelFilterMemory {
  let keys = initial;
  const listeners = new Set<() => void>();
  let pending = Promise.resolve();
  return {
    getSnapshot: () => keys,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (
        next.length === keys.length &&
        next.every((key, index) => key === keys[index])
      )
        return;
      keys = next;
      const contents = `${JSON.stringify({ version: 1, labels: keys })}\n`;
      pending = pending.catch(() => {}).then(() => storage.write(contents));
      void pending.catch(() => {});
      for (const listener of listeners) listener();
    },
    async flush() {
      await pending;
    },
  };
}

/** A filter kept for this run only. */
export function sessionLabelFilterMemory(): LabelFilterMemory {
  return createLabelFilterMemory(
    { read: async () => null, write: async () => {} },
    NONE,
  );
}
