import type { TimelineStore } from "../../state/timeline-store.js";
export type Focus =
  | { pane: "list" }
  | { pane: "timeline" }
  | { pane: "prompt" }
  | { pane: "permission"; requestId: string };

export function watchPermissions(
  store: TimelineStore,
  update: (transition: (focus: Focus) => Focus) => void,
) {
  let previous: readonly string[] = [];
  function changed() {
    const requests = store.getSnapshot().pendingPermissions;
    const incoming = requests.find((request) => !previous.includes(request.id));
    previous = requests.map((request) => request.id);
    update((focus) => {
      if (incoming) return { pane: "permission", requestId: incoming.id };
      if (focus.pane !== "permission") return focus;
      if (requests.some((request) => request.id === focus.requestId))
        return focus;
      const next = requests[0];
      if (next) return { pane: "permission", requestId: next.id };
      return { pane: "timeline" };
    });
  }
  changed();
  return store.subscribe(changed);
}
