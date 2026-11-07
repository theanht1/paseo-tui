import type { CompletionPort, SlashCommand } from "../../connection/ports.js";

interface Entry {
  request: Promise<SlashCommand[]>;
  settled: boolean;
}

/**
 * Shares an agent's slash-command request between the prompt and the Clear session check.
 * A request still in flight is shared; an answer is dropped when the next completion
 * session opens (`opened`), so new commands appear without a restart.
 */
export function cachedCommands(port: CompletionPort): CompletionPort {
  const byAgent = new Map<string, Entry>();
  return {
    files: (cwd, query) => port.files(cwd, query),
    opened(source) {
      if (source.kind !== "agent") return;
      if (byAgent.get(source.agentId)?.settled) byAgent.delete(source.agentId);
    },
    commands(source) {
      if (source.kind !== "agent") return port.commands(source);
      const known = byAgent.get(source.agentId);
      if (known) return known.request;
      const entry: Entry = { request: port.commands(source), settled: false };
      byAgent.set(source.agentId, entry);
      entry.request.then(
        () => {
          entry.settled = true;
        },
        () => byAgent.delete(source.agentId),
      );
      return entry.request;
    },
  };
}
