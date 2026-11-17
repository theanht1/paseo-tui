import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { createContext, useContext } from "react";

/** The plugin view being rendered: whether it has the keyboard, and where its failures go. */
export interface ViewHost {
  focused: boolean;
  /** Replaces the view with the failure, like an error thrown while rendering. */
  fail(error: unknown): void;
}
export const ViewHostContext = createContext<ViewHost>({
  focused: false,
  fail(error) {
    throw error;
  },
});

/** `useKeyboard` for a plugin view: the handler only runs while the view is focused. */
export function useViewKeyboard(handler: (key: KeyEvent) => void) {
  const { focused, fail } = useContext(ViewHostContext);
  useKeyboard((key) => {
    if (!focused) return;
    try {
      handler(key);
    } catch (error) {
      fail(error);
    }
  });
}
