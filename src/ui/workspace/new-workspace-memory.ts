import { join } from "node:path";
import type { PreferenceStorage } from "../agent/thinking-preference.js";

/** What the last New workspace was created with; the next one offers it first. */
export interface NewWorkspaceChoice {
  /** The project as listed in the New workspace step (the merged view key). */
  projectId: string;
  /** The host it was created on; null with a single daemon. */
  hostId: string | null;
  provider: string;
  model: string;
  thinkingOptionId: string | null;
}
export interface NewWorkspaceMemory {
  last(): NewWorkspaceChoice | null;
  set(choice: NewWorkspaceChoice): void;
  flush(): Promise<void>;
}

export function newWorkspacePath(env: NodeJS.ProcessEnv, home: string): string {
  return join(
    env.XDG_STATE_HOME || join(home, ".local", "state"),
    "paseo-tui",
    "new-workspace.json",
  );
}

function text(record: object, key: string): string | null | undefined {
  if (!(key in record)) return undefined;
  const value: unknown = Reflect.get(record, key);
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}
function parseFile(contents: string | null): NewWorkspaceChoice | null {
  if (contents === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 2
  )
    return null;
  const projectId = text(parsed, "projectId");
  const hostId = text(parsed, "hostId");
  const provider = text(parsed, "provider");
  const model = text(parsed, "model");
  const thinkingOptionId = text(parsed, "thinkingOptionId");
  if (
    !projectId ||
    hostId === undefined ||
    !provider ||
    !model ||
    thinkingOptionId === undefined
  )
    return null;
  return { projectId, hostId, provider, model, thinkingOptionId };
}

export async function loadNewWorkspaceMemory(
  storage: PreferenceStorage,
): Promise<NewWorkspaceMemory> {
  let choice = parseFile(await storage.read());
  let pending = Promise.resolve();
  return {
    last: () => choice,
    set(next) {
      choice = next;
      const contents = `${JSON.stringify({ version: 2, ...next })}\n`;
      pending = pending.catch(() => {}).then(() => storage.write(contents));
      void pending.catch(() => {});
    },
    flush: () => pending,
  };
}
