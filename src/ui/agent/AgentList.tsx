import type { PaseoProject } from "@getpaseo/client";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useContext, useEffect, useRef } from "react";
import {
  backgroundProp,
  foregroundProp,
  scrollbarOptions,
  ThemeContext,
} from "../render/theme.js";
import type { ProjectNode, WorkspaceRow } from "../workspace/workspaces.js";
import type { Indicator } from "./attention.js";
import { StatusGlyph } from "./WorkingIndicator.js";
export interface AgentListProps {
  projects: readonly ProjectNode[];
  indicators: ReadonlyMap<string, Indicator>;
  selectedId: string | null;
  openId: string | null;
  onSelect(workspace: WorkspaceRow): void;
  onCreate?(project: PaseoProject): void;
  onContext?(workspace: WorkspaceRow, x: number, y: number): void;
}
export function AgentList({
  projects,
  indicators,
  selectedId,
  openId,
  onSelect,
  onCreate,
  onContext,
}: AgentListProps) {
  const scroll = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    if (selectedId)
      scroll.current?.scrollChildIntoView(`workspace:${selectedId}`);
  }, [selectedId]);
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  return (
    <scrollbox
      ref={scroll}
      flexGrow={1}
      scrollX={false}
      scrollbarOptions={scrollbarOptions(theme)}
    >
      {projects.length === 0 ? (
        <text fg={foregroundProp(theme.muted)}>
          No projects. Open a repository in Paseo.
        </text>
      ) : (
        projects.map(({ project, workspaces }) => (
          <box key={project.projectId} flexDirection="column" flexShrink={0}>
            <box height={1} flexDirection="row">
              <text
                minWidth={0}
                flexGrow={1}
                wrapMode="none"
                fg={foregroundProp(theme.accent)}
              >
                <strong>
                  {project.projectCustomName || project.projectDisplayName}
                </strong>
              </text>
              <text
                id={`project-add:${project.projectId}`}
                width={3}
                flexShrink={0}
                fg={foregroundProp(theme.accent)}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  if (event.button === 0) onCreate?.(project);
                }}
              >
                {" "}
                +{" "}
              </text>
            </box>
            {workspaces.map((workspace) => (
              <box
                key={workspace.id}
                id={`workspace:${workspace.id}`}
                height={1}
                backgroundColor={backgroundProp(
                  workspace.id === selectedId
                    ? theme.cursorBg
                    : workspace.id === openId
                      ? theme.selectionBg
                      : "",
                )}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  if (event.button === 2)
                    onContext?.(workspace, event.x, event.y);
                  else if (event.button === 0) onSelect(workspace);
                }}
              >
                <text
                  wrapMode="none"
                  attributes={workspace.id === selectedId ? 1 : 0}
                  fg={foregroundProp(
                    workspace.id === selectedId ? theme.cursorFg : theme.fg,
                  )}
                >
                  {" "}
                  <StatusGlyph
                    indicator={indicators.get(workspace.id) ?? { kind: "none" }}
                    idle={workspace.id === openId ? "›" : " "}
                  />{" "}
                  {workspace.title || workspace.name}
                </text>
              </box>
            ))}
          </box>
        ))
      )}
    </scrollbox>
  );
}
