import { useContext } from "react";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "../render/theme.js";
import { AgentList, type AgentListProps } from "./AgentList.js";

export interface SidebarProps extends AgentListProps {
  /** Total width including the one-column drag divider. */
  width: number;
  focused: boolean;
  onResize(width: number): void;
}
/** The project/workspace list plus the divider that drags its width. */
export function Sidebar({ width, focused, onResize, ...list }: SidebarProps) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  return (
    <>
      <box
        id="sidebar"
        title="Projects"
        border
        borderColor={foregroundProp(focused ? theme.accent : theme.faint)}
        width={Math.max(0, width - 1)}
        flexShrink={0}
      >
        <AgentList {...list} />
      </box>
      <box
        id="sidebar-divider"
        width={1}
        height="100%"
        flexShrink={0}
        backgroundColor={backgroundProp(theme.border)}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseDrag={(event) => {
          onResize(event.x + 1);
          event.preventDefault();
          event.stopPropagation();
        }}
      />
    </>
  );
}
