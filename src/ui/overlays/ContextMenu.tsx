import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useContext } from "react";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "../render/theme.js";
import { menuRect } from "./popup-layout.js";
export function ContextMenu({
  x,
  y,
  onRename,
  onArchive,
  onClose,
}: {
  x: number;
  y: number;
  onRename(): void;
  onArchive?(): void;
  onClose(): void;
}) {
  const { width, height } = useTerminalDimensions();
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  useKeyboard((event) => {
    if (event.name === "escape" || event.sequence === "q") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.name === "return" || event.sequence === "r") {
      event.preventDefault();
      event.stopPropagation();
      onRename();
    }
  });
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      zIndex={25}
      onMouseDown={onClose}
    >
      <box
        id="context-menu"
        position="absolute"
        {...menuRect(x, y, width, height, onArchive ? 4 : 3)}
        flexDirection="column"
        border
        borderColor={foregroundProp(theme.accent)}
        backgroundColor={backgroundProp(theme.codeBg)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <text
          id="context-rename"
          fg={foregroundProp(theme.accent)}
          onMouseDown={(event) => {
            event.stopPropagation();
            onRename();
          }}
        >
          {" "}
          Rename
        </text>
        {onArchive && (
          <text
            id="context-archive"
            fg={foregroundProp(theme.error)}
            onMouseDown={(event) => {
              event.stopPropagation();
              if (event.button === 0) onArchive();
            }}
          >
            {" "}
            Archive workspace
          </text>
        )}
      </box>
    </box>
  );
}
