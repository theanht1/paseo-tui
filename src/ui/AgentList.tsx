import type { PaseoAgent } from "@getpaseo/client";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useContext, useEffect, useRef } from "react";
import type { WorkspaceGroup } from "../state/agents-store.js";
import { agentAge, agentGlyph, agentName, shortPath } from "./agent-display.js";
import {
  backgroundProp,
  foregroundProp,
  scrollbarOptions,
  ThemeContext,
} from "./render/theme.js";
export interface AgentListProps {
  groups: readonly WorkspaceGroup[];
  selectedId: string | null;
  openId: string | null;
  onSelect(id: string): void;
  onOpen(agent: PaseoAgent): void;
}
export function AgentList({
  groups,
  selectedId,
  openId,
  onSelect,
  onOpen,
}: AgentListProps) {
  const scroll = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    if (selectedId) scroll.current?.scrollChildIntoView(`agent:${selectedId}`);
  }, [selectedId]);
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  return (
    <scrollbox
      scrollbarOptions={scrollbarOptions(theme)}
      ref={scroll}
      flexGrow={1}
      scrollX={false}
    >
      {groups.length === 0 ? (
        <text fg={foregroundProp(theme.fg)}>
          No agents. Start one with the app or CLI.
        </text>
      ) : (
        groups.map((group) => (
          <box key={group.key} flexDirection="column" flexShrink={0}>
            <text fg={foregroundProp(theme.accent)} wrapMode="none">
              <strong>{shortPath(group.agents[0]?.cwd ?? group.key)}</strong>
            </text>
            {group.agents.map((agent) => (
              <box
                key={agent.id}
                id={`agent:${agent.id}`}
                height={1}
                backgroundColor={backgroundProp(
                  agent.id === selectedId ? theme.selectionBg : "",
                )}
                onMouseDown={() => {
                  onSelect(agent.id);
                  if (agent.id === selectedId) onOpen(agent);
                }}
              >
                <text fg={foregroundProp(theme.fg)} wrapMode="none">
                  <span
                    fg={foregroundProp(
                      agent.pendingPermissions.length
                        ? theme.warn
                        : theme.status[
                            agent.status === "running"
                              ? "running"
                              : agent.status === "error" ||
                                  agent.status === "closed"
                                ? "error"
                                : "idle"
                          ],
                    )}
                  >
                    {agentGlyph(agent).glyph}
                  </span>{" "}
                  {agent.id === openId ? "●" : " "} {agentName(agent)}{" "}
                  <span fg={foregroundProp(theme.muted)}>
                    {agentAge(agent.updatedAt)} · {agent.provider}
                  </span>
                </text>
              </box>
            ))}
          </box>
        ))
      )}
    </scrollbox>
  );
}
