import { type ReactNode, useContext } from "react";
import type { Indicator } from "../agent/attention.js";
import { foregroundProp, ThemeContext } from "../render/theme.js";
import { WorkspaceTabs } from "../workspace/WorkspaceTabs.js";
import type { WorkspaceTab } from "../workspace/workspaces.js";

export interface PaneFrameProps {
  paneId: string;
  rect: { x: number; y: number; width: number; height: number };
  visible: boolean;
  /** Whether this is the focused pane; unfocused strips scope their tab ids. */
  focusedPane: boolean;
  /** Focused and receiving input: draws the focused border. */
  active: boolean;
  /** Shown while pane numbers are displayed (prefix q). */
  number: number | null;
  tabs: readonly WorkspaceTab[];
  indicators: ReadonlyMap<string, Indicator>;
  selectedTab: string | null;
  onMouseDown(): void;
  onSelectTab(tab: WorkspaceTab): void;
  onCloseTab(tab: WorkspaceTab): void;
  onCreateTab(): void;
  onTabContext(tab: WorkspaceTab, x: number, y: number): void;
  children: ReactNode;
}
/** A split pane: absolutely placed, with its workspace tab strip above a bordered body. */
export function PaneFrame(props: PaneFrameProps) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  const { paneId, rect } = props;
  return (
    <box
      id={`pane:${paneId}`}
      position="absolute"
      left={rect.x}
      top={rect.y}
      width={rect.width}
      height={rect.height}
      visible={props.visible}
      flexDirection="column"
      onMouseDown={props.onMouseDown}
    >
      <WorkspaceTabs
        id={`pane-tabs:${paneId}`}
        scope={props.focusedPane ? undefined : paneId}
        tabs={props.tabs}
        indicators={props.indicators}
        selected={props.selectedTab}
        onSelect={props.onSelectTab}
        onClose={props.onCloseTab}
        onCreate={props.onCreateTab}
        onContext={props.onTabContext}
      />
      <box
        id={`pane-body:${paneId}`}
        flexGrow={1}
        minHeight={0}
        border
        borderColor={foregroundProp(
          props.active ? theme.borderFocused : theme.border,
        )}
        flexDirection="column"
      >
        {props.number !== null ? (
          <text fg={foregroundProp(theme.fg)}>{props.number}</text>
        ) : null}
        {props.children}
      </box>
    </box>
  );
}
