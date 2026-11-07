import { useTerminalDimensions } from "@opentui/react";
import { useContext } from "react";
import { useKeyOwner } from "../input/key-router.js";
import { useListCursor } from "../input/list-keys.js";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "../render/theme.js";
import type { MenuItem } from "./context-menu-items.js";
import { menuRect } from "./popup-layout.js";
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: readonly MenuItem[];
  onClose(): void;
}) {
  const { width, height } = useTerminalDimensions();
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  const list = useListCursor(items.length, items.length);
  useKeyOwner(true, (stroke) => {
    if (list.key(stroke)) return true;
    if (stroke.name === "escape" || stroke.sequence === "q") {
      onClose();
      return true;
    }
    const item =
      stroke.name === "return"
        ? items[list.current()]
        : items.find((entry) => entry.shortcut === stroke.sequence);
    item?.run();
    return item !== undefined;
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
        {...menuRect(x, y, width, height, items.length + 2)}
        flexDirection="column"
        border
        borderColor={foregroundProp(theme.accent)}
        backgroundColor={backgroundProp(theme.codeBg)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {items.map((item, index) => (
          <text
            key={item.id}
            id={`context-${item.id}`}
            fg={foregroundProp(
              item.tone === "danger" ? theme.error : theme.accent,
            )}
            bg={backgroundProp(
              index === list.cursor ? theme.selectionBg : theme.codeBg,
            )}
            onMouseDown={(event) => {
              event.stopPropagation();
              if (event.button === 0) item.run();
            }}
          >
            {index === list.cursor ? "› " : "  "}
            {item.title}
          </text>
        ))}
      </box>
    </box>
  );
}
