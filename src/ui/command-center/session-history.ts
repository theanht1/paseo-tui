import type { HistoryEntry, HistoryPage } from "../../connection/ports.js";
import { agentAge, agentName, shortPath } from "../agent/agent-display.js";
import type { CommandItem, CommandStep } from "./registry.js";

/** Past sessions from every host, newest first. */
export interface SessionHistory {
  /** False when no host has `agentHistorySearch`; `list` then ignores the query. */
  searchable: boolean;
  list(query: string): Promise<HistoryPage & { hostErrors: string[] }>;
  unarchive(agentId: string): Promise<void>;
}
export interface SessionHistoryContext {
  history: Pick<SessionHistory, "searchable" | "list">;
  now(): number;
  /** App decides whether the agent opens live or as an archived view. */
  open(entry: HistoryEntry): void;
}
/** Sessions in the port's order (search steps are not re-ranked), then status rows. */
export function sessionHistoryStep(
  context: SessionHistoryContext,
): CommandStep {
  const step: CommandStep = {
    kind: "search",
    title: "History",
    placeholder: "Search sessions…",
    tall: true,
    async search(query) {
      const { history, now, open } = context;
      const page = await history.list(query);
      const typed = query.trim() !== "";
      const status = (id: string, title: string): CommandItem => ({
        id: `history-status:${id}`,
        group: "Agents",
        title,
        run: () => step,
      });
      const rows = page.entries.map((entry): CommandItem => {
        const { agent, projectName } = entry;
        return {
          id: `history:${agent.id}`,
          group: "Agents",
          title: agentName(agent),
          subtitle: [
            projectName ?? shortPath(agent.cwd),
            agent.provider,
            agent.archivedAt ? "archived" : agent.status,
            agentAge(agent.updatedAt, now()),
          ].join(" · "),
          run(): undefined {
            open(entry);
          },
        };
      });
      return [
        ...(typed && !history.searchable
          ? [
              status(
                "unsupported",
                "Search needs a newer daemon (agentHistorySearch)",
              ),
            ]
          : []),
        ...rows,
        ...(rows.length
          ? []
          : [
              typed
                ? status("none", "No sessions match")
                : status("empty", "No sessions yet"),
            ]),
        ...(page.truncated
          ? [status("truncated", "Too many matches — narrow your search")]
          : []),
        ...page.hostErrors.map((error, index) =>
          status(`error:${index}`, `! ${error}`),
        ),
      ];
    },
  };
  return step;
}
export function sessionHistoryCommand(
  context: SessionHistoryContext,
): CommandItem {
  return {
    id: "history",
    group: "Agents",
    title: "History…",
    keywords: ["sessions", "archived", "closed", "resume"],
    action: { type: "history.open" },
    run: () => sessionHistoryStep(context),
  };
}
