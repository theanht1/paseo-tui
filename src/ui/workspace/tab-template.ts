import type { PaseoAgent } from "@getpaseo/client";
import type { CreateAgentInput } from "../../state/ports.js";
import type { WorkspaceRow, WorkspaceTab } from "./workspaces.js";

/**
 * Config for an instant new agent tab: the current agent tab's settings, else the
 * workspace's most recently updated agent. Null when nothing usable can be derived.
 */
export function newTabInput(
  workspace: WorkspaceRow,
  tab: WorkspaceTab | null,
  agents: readonly PaseoAgent[],
): CreateAgentInput | null {
  const source =
    tab?.kind === "agent" && tab.agent.model
      ? tab.agent
      : agents
          .filter(
            (agent) =>
              agent.workspaceId === workspace.id &&
              agent.archivedAt == null &&
              agent.model,
          )
          .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
          .at(0);
  if (!source?.model) return null;
  return {
    provider: source.provider,
    model: source.model,
    modeId: source.currentModeId,
    ...(source.thinkingOptionId
      ? { thinkingOptionId: source.thinkingOptionId }
      : {}),
    cwd: workspace.workspaceDirectory ?? workspace.projectRootPath,
    title: null,
    prompt: null,
  };
}
