import type { PaseoProject } from "@getpaseo/client";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useContext, useEffect, useRef } from "react";
import {
  backgroundProp,
  foregroundProp,
  scrollbarOptions,
  ThemeContext,
} from "../render/theme.js";
import type { WorkspaceRow } from "../workspace/workspaces.js";
import type { Indicator } from "./attention.js";
import type { SidebarSection } from "./sidebar-sections.js";
import { StatusGlyph } from "./WorkingIndicator.js";
import { setupTag, workspaceMeta } from "./workspace-meta.js";
export interface AgentListProps {
  sections: readonly SidebarSection[];
  indicators: ReadonlyMap<string, Indicator>;
  /** Pending permission and question requests per workspace. */
  pending: ReadonlyMap<string, number>;
  selectedId: string | null;
  openId: string | null;
  onSelect(workspace: WorkspaceRow): void;
  onCreate?(project: PaseoProject): void;
  onContext?(workspace: WorkspaceRow, x: number, y: number): void;
}
export function AgentList({
  sections,
  indicators,
  pending,
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
      {sections.length === 0 ? (
        <text fg={foregroundProp(theme.muted)}>
          No projects. Open a repository in Paseo.
        </text>
      ) : (
        sections.map((section) => (
          <box key={section.key} flexDirection="column" flexShrink={0}>
            {section.kind === "project" ? (
              <box height={1} flexDirection="row">
                <text
                  minWidth={0}
                  flexGrow={1}
                  wrapMode="none"
                  fg={foregroundProp(theme.accent)}
                >
                  <strong>
                    {section.project.projectCustomName ||
                      section.project.projectDisplayName}
                  </strong>
                </text>
                <text
                  id={`project-add:${section.project.projectId}`}
                  width={3}
                  flexShrink={0}
                  fg={foregroundProp(theme.accent)}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.button === 0) onCreate?.(section.project);
                  }}
                >
                  {" "}
                  +{" "}
                </text>
              </box>
            ) : (
              <text
                height={1}
                wrapMode="none"
                fg={foregroundProp(theme.accent)}
              >
                <strong>{section.title}</strong> {section.workspaces.length}
              </text>
            )}
            {section.workspaces.map((workspace) => {
              const meta = workspaceMeta(workspace);
              const setup = setupTag(workspace);
              const count = pending.get(workspace.id) ?? 0;
              return (
                <box
                  key={workspace.id}
                  id={`workspace:${workspace.id}`}
                  height={meta || setup ? 2 : 1}
                  flexDirection="column"
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
                      indicator={
                        indicators.get(workspace.id) ?? { kind: "none" }
                      }
                      idle={workspace.id === openId ? "›" : " "}
                    />
                    {count > 1 ? count : ""} {workspace.title || workspace.name}
                  </text>
                  {meta || setup ? (
                    <text
                      id={`workspace-meta:${workspace.id}`}
                      wrapMode="none"
                      fg={foregroundProp(theme.muted)}
                    >
                      {"   "}
                      {meta}
                      {meta && setup ? " · " : ""}
                      {setup ? (
                        <span fg={foregroundProp(theme.status[setup.tone])}>
                          {setup.text}
                        </span>
                      ) : null}
                    </text>
                  ) : null}
                </box>
              );
            })}
          </box>
        ))
      )}
    </scrollbox>
  );
}
