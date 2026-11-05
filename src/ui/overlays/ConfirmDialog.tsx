import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useContext } from "react";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "../render/theme.js";
import { popupRect } from "./popup-layout.js";

export function ConfirmDialog({
  id,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  id: string;
  title: string;
  message: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  const { width, height } = useTerminalDimensions();
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  useKeyboard((event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.sequence === "y") onConfirm();
    else if (event.sequence === "n" || event.name === "escape") onCancel();
  });
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      zIndex={30}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <box
        id={`${id}-confirmation`}
        position="absolute"
        {...popupRect(width, height, 64, 8)}
        border
        borderColor={foregroundProp(theme.accent)}
        backgroundColor={backgroundProp(theme.codeBg)}
        paddingX={1}
        flexDirection="column"
        gap={1}
      >
        <text fg={foregroundProp(theme.fg)} attributes={1}>
          {title}
        </text>
        <text fg={foregroundProp(theme.fg)}>{message}</text>
        <box flexDirection="row" gap={3}>
          <text
            id={`${id}-confirm`}
            fg={foregroundProp(theme.error)}
            onMouseDown={(event) => {
              event.stopPropagation();
              if (event.button === 0) onConfirm();
            }}
          >
            Confirm [y]
          </text>
          <text
            id={`${id}-cancel`}
            fg={foregroundProp(theme.accent)}
            onMouseDown={(event) => {
              event.stopPropagation();
              if (event.button === 0) onCancel();
            }}
          >
            Cancel [n / Esc]
          </text>
        </box>
      </box>
    </box>
  );
}
