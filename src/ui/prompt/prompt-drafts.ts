export interface PromptDraft {
  text: string;
  cursor: number;
}
/** Unsent prompt text per agent, surviving the pane that shows it; kept for the session. */
export interface PromptDrafts {
  get(agentId: string): PromptDraft | undefined;
  /** Remembers the agent's prompt; empty text forgets it. */
  record(agentId: string, draft: PromptDraft): void;
}
export function createPromptDrafts(): PromptDrafts {
  const drafts = new Map<string, PromptDraft>();
  return {
    get: (agentId) => drafts.get(agentId),
    record(agentId, draft) {
      if (draft.text) drafts.set(agentId, draft);
      else drafts.delete(agentId);
    },
  };
}
