/** A small TUI plugin for App tests: two views and a few actions on the `fixture` server plugin. */
import { useState } from "react";
import {
  defineTuiPlugin,
  type TuiPlugin,
  type TuiPluginContext,
  type TuiPluginViewProps,
  useViewKeyboard,
} from "../plugin.js";

function Panel({
  ctx,
  focused,
}: TuiPluginViewProps & { ctx: TuiPluginContext }) {
  const [keys, setKeys] = useState("");
  useViewKeyboard((key) => setKeys((previous) => previous + key.name));
  return (
    <box flexDirection="column">
      <text fg={ctx.theme.accent || undefined}>
        {`Fixture on ${ctx.host.label} ${focused ? "focused" : "idle"}`}
      </text>
      <text>{`typed:${keys}`}</text>
    </box>
  );
}
function Broken(): never {
  throw Error("view exploded");
}

export function fixturePlugin(): TuiPlugin {
  return defineTuiPlugin({
    id: "fixture",
    apiVersion: 1,
    activate(ctx) {
      ctx.registerView({
        id: "panel",
        title: "Fixture panel",
        render: (props) => <Panel ctx={ctx} {...props} />,
      });
      ctx.registerView({ id: "broken", title: "Broken", render: Broken });
      ctx.registerAction({
        id: "open",
        title: "Open fixture panel",
        defaultKeys: ["B"],
        run: () => ctx.openView("panel"),
      });
      ctx.registerAction({
        id: "open-broken",
        title: "Open broken view",
        run: () => ctx.openView("broken"),
      });
      ctx.registerAction({
        id: "ping",
        title: "Ping fixture server",
        async run() {
          ctx.notify(
            `Fixture said ${JSON.stringify(await ctx.rpc("ping", { n: 1 }))}`,
          );
        },
      });
      ctx.registerAction({
        id: "boom",
        title: "Explode fixture",
        run() {
          throw Error("action exploded");
        },
      });
    },
  });
}
