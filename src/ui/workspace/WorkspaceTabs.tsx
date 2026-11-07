import type { ScrollBoxRenderable } from "@opentui/core";
import { useContext, useEffect, useRef } from "react";
import type { Indicator } from "../agent/attention.js";
import { StatusGlyph } from "../agent/WorkingIndicator.js";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "../render/theme.js";
import {
  fitToWidth,
  stripLayout,
  tabKindIcon,
  tabNameWidth,
} from "./tab-layout.js";
import { tabName, type WorkspaceTab } from "./workspaces.js";

const ADD_BUTTON_WIDTH = 3;
export function WorkspaceTabs({
  id,
  scope,
  width,
  dimmed = false,
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
  /** Columns of the whole strip, including the `+` button. */
  width: number;
  /** Strip of an unfocused pane. */
  dimmed?: boolean;
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
  const { tabWidth } = stripLayout(width - ADD_BUTTON_WIDTH, tabs.length);
  const nameWidth = tabNameWidth(tabWidth);
  useEffect(() => {
    if (selected && tabWidth)
      scroll.current?.scrollChildIntoView(`tab:${prefix}${selected}`);
  }, [selected, prefix, tabWidth]);
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  return (
    <box
      id={id}
      height={1}
      width={width}
      flexShrink={0}
      flexDirection="row"
      backgroundColor={backgroundProp(theme.tabStripBg)}
    >
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
          const active = tab.key === selected;
          const fg = active
            ? dimmed
              ? theme.muted
              : theme.tabActiveFg
            : dimmed
              ? theme.faint
              : theme.muted;
          return (
            <box
              key={tab.key}
              id={`tab:${prefix}${tab.key}`}
              width={tabWidth - 1}
              marginRight={1}
              flexShrink={0}
              flexDirection="row"
              backgroundColor={backgroundProp(
                active && !dimmed ? theme.tabActiveBg : theme.tabBg,
              )}
              onMouseDown={(event) => {
                event.stopPropagation();
                if (event.button === 2) onContext?.(tab, event.x, event.y);
                else if (event.button === 0) onSelect(tab);
              }}
            >
              <text
                attributes={active ? 1 : 0}
                wrapMode="none"
                flexShrink={0}
                fg={foregroundProp(fg)}
              >
                <span fg={foregroundProp(dimmed ? theme.muted : theme.accent)}>
                  {active ? "▎" : " "}
                </span>
                <StatusGlyph indicator={indicator} idle=" " />
                {` ${tabKindIcon(tab.kind)} ${fitToWidth(tabName(tab), nameWidth)} `}
              </text>
              {onClose ? (
                <text
                  id={`tab-close:${prefix}${tab.key}`}
                  flexShrink={0}
                  fg={foregroundProp(fg)}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.button === 0) onClose(tab);
                  }}
                >
                  ×
                </text>
              ) : null}
            </box>
          );
        })}
      </scrollbox>
      <text
        id={`tab-add${scope ? `:${scope}` : ""}`}
        width={ADD_BUTTON_WIDTH}
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
