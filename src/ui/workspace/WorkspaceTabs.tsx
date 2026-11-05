import type { ScrollBoxRenderable } from "@opentui/core";
import { useContext, useEffect, useRef } from "react";
import { agentName } from "../agent/agent-display.js";
import type { Indicator } from "../agent/attention.js";
import { StatusGlyph } from "../agent/WorkingIndicator.js";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "../render/theme.js";
import { tabName, type WorkspaceTab } from "./workspaces.js";
export function WorkspaceTabs({
  id,
  scope,
  tabs,
  indicators,
  selected,
  onSelect,
  onCreate,
  onClose,
  onContext,
}: {
  id?: string;
  /** Prefixes tab ids so several pane strips can coexist; omitted for the focused pane. */
  scope?: string;
  tabs: readonly WorkspaceTab[];
  indicators: ReadonlyMap<string, Indicator>;
  selected: string | null;
  onSelect(tab: WorkspaceTab): void;
  onCreate?(): void;
  onClose?(tab: WorkspaceTab): void;
  onContext?(tab: WorkspaceTab, x: number, y: number): void;
}) {
  const scroll = useRef<ScrollBoxRenderable>(null);
  const prefix = scope ? `${scope}:` : "";
  useEffect(() => {
    if (selected)
      scroll.current?.scrollChildIntoView(`tab:${prefix}${selected}`);
  }, [selected, prefix]);
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  return (
    <box id={id} height={1} width="100%" flexShrink={0} flexDirection="row">
      <scrollbox
        flexGrow={1}
        flexBasis={0}
        minWidth={0}
        ref={scroll}
        height={1}
        flexShrink={1}
        scrollY={false}
        scrollX
        scrollbarOptions={{ visible: false }}
        contentOptions={{ flexDirection: "row" }}
      >
        {tabs.map((tab) => {
          const indicator = indicators.get(tab.key) ?? { kind: "none" };
          return (
            <box
              key={tab.key}
              id={`tab:${prefix}${tab.key}`}
              flexShrink={0}
              flexDirection="row"
              backgroundColor={backgroundProp(
                tab.key === selected ? theme.cursorBg : theme.codeBg,
              )}
              onMouseDown={(event) => {
                event.stopPropagation();
                if (event.button === 2) onContext?.(tab, event.x, event.y);
                else if (event.button === 0) onSelect(tab);
              }}
            >
              <text
                attributes={tab.key === selected ? 1 : 0}
                wrapMode="none"
                fg={foregroundProp(
                  tab.key === selected ? theme.cursorFg : theme.muted,
                )}
              >
                {" "}
                <StatusGlyph indicator={indicator} idle="" />
                {indicator.kind === "none" ? "" : " "}
                {tab.kind === "agent"
                  ? agentName(tab.agent)
                  : `${tab.kind === "terminal" ? "▣" : "◆"} ${tabName(tab)}`}{" "}
              </text>
              {onClose && (
                <text
                  id={`tab-close:${prefix}${tab.key}`}
                  fg={foregroundProp(
                    tab.key === selected ? theme.cursorFg : theme.muted,
                  )}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.button === 0) onClose(tab);
                  }}
                >
                  ×
                </text>
              )}
              <text fg={foregroundProp(theme.muted)}>{" │ "}</text>
            </box>
          );
        })}
      </scrollbox>
      <text
        id={`tab-add${scope ? `:${scope}` : ""}`}
        width={3}
        flexShrink={0}
        fg={foregroundProp(theme.accent)}
        bg={backgroundProp(theme.selectionBg)}
        onMouseDown={(event) => {
          event.stopPropagation();
          if (event.button === 0) onCreate?.();
        }}
      >
        {" "}
        +{" "}
      </text>
    </box>
  );
}
