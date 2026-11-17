import { Component, type ReactNode, useMemo, useState } from "react";
import { foregroundProp, type Theme } from "../render/theme.js";
import type { TuiPluginView } from "./api.js";
import { ViewHostContext } from "./view-keyboard.js";

interface BoundaryProps {
  title: string;
  theme: Theme;
  children: ReactNode;
}
/** Shows a view's failure in its place; React only catches render errors in a class. */
class ViewBoundary extends Component<
  BoundaryProps,
  { failure: string | null }
> {
  override state = { failure: null };
  static getDerivedStateFromError(error: unknown) {
    return { failure: error instanceof Error ? error.message : String(error) };
  }
  override render() {
    return this.state.failure === null ? (
      this.props.children
    ) : (
      <text fg={foregroundProp(this.props.theme.error)}>
        {`${this.props.title} failed: ${this.state.failure}`}
      </text>
    );
  }
}
function ViewBody({
  view,
  focused,
}: {
  view: TuiPluginView;
  focused: boolean;
}) {
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const host = useMemo(
    () => ({ focused, fail: (error: unknown) => setFailure({ error }) }),
    [focused],
  );
  if (failure) throw failure.error;
  const View = view.render;
  return (
    <ViewHostContext value={host}>
      <View focused={focused} />
    </ViewHostContext>
  );
}
/**
 * A plugin view filling the pane area; whatever it throws stays inside it.
 * Hidden (another tab is selected) it stays mounted, so it keeps its state.
 */
export function PluginView({
  view,
  visible,
  focused,
  theme,
}: {
  view: TuiPluginView;
  visible: boolean;
  focused: boolean;
  theme: Theme;
}) {
  return (
    <box
      visible={visible}
      flexGrow={1}
      flexDirection="column"
      overflow="hidden"
    >
      <ViewBoundary title={view.title} theme={theme}>
        <ViewBody view={view} focused={focused} />
      </ViewBoundary>
    </box>
  );
}
