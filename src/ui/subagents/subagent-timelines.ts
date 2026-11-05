import type { TimelineStore } from "../../state/timeline-store.js";

/** Timeline stores for provider subagent chats shown in panes, opened on first use. */
export function createSubagentTimelines(
  open: (parentAgentId: string, subagentId: string) => TimelineStore,
) {
  const stores = new Map<string, TimelineStore>();
  function key(parentAgentId: string, subagentId: string) {
    return `${parentAgentId}\0${subagentId}`;
  }
  return {
    get(descriptor: { parentAgentId: string; id: string }): TimelineStore {
      const id = key(descriptor.parentAgentId, descriptor.id);
      const existing = stores.get(id);
      if (existing) return existing;
      const created = open(descriptor.parentAgentId, descriptor.id);
      stores.set(id, created);
      void created.open();
      return created;
    },
    /** Closes every timeline except the views still shown. */
    retain(views: Iterable<{ parentAgentId: string; subagentId: string }>) {
      const live = new Set(
        [...views].map((view) => key(view.parentAgentId, view.subagentId)),
      );
      for (const [id, store] of stores)
        if (!live.has(id)) {
          store.close();
          stores.delete(id);
        }
    },
    close() {
      for (const store of stores.values()) store.close();
      stores.clear();
    },
  };
}
