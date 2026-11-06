import type { UsageSnapshot, UsageStore } from "../../state/usage-store.js";
import type { CommandItem, CommandStep } from "../command-center/registry.js";
import type { UsageConfig } from "../config/user-config.js";
import { usageDetailRows, usageMeters } from "./usage-meters.js";

export type UsageSource = Pick<UsageStore, "getSnapshot" | "refresh">;
function summary(
  snapshot: UsageSnapshot,
  now: number,
  config?: UsageConfig,
): string {
  if (snapshot.kind === "loading") return "Loading…";
  if (snapshot.kind === "error") return `! ${snapshot.message}`;
  return (
    usageMeters(snapshot.reports, now, config) || "No provider reports usage"
  );
}

/** The Command Center's "Provider usage" view: every window, balance and reset time. */
export function usageCommands(
  usage: UsageSource,
  now: () => number,
  config?: UsageConfig,
): CommandItem[] {
  const step: CommandStep = {
    kind: "choice",
    title: "Provider usage",
    async items() {
      await usage.refresh();
      const snapshot = usage.getSnapshot();
      const reports = snapshot.kind === "loading" ? [] : snapshot.reports;
      const rows: CommandItem[] = usageDetailRows(reports, now(), config).map(
        (row) => ({ ...row, group: "Usage", run: () => step }),
      );
      if (snapshot.kind === "error")
        rows.unshift({
          id: "usage:error",
          group: "Usage",
          title: `! ${snapshot.message}`,
          run: () => step,
        });
      else if (!rows.length)
        rows.push({
          id: "usage:none",
          group: "Usage",
          title: "No provider reports usage",
          run: () => step,
        });
      rows.push({
        id: "usage:refresh",
        group: "Usage",
        title: "Refresh now",
        subtitle: "Ask each provider again, bypassing the daemon's cache",
        run(): undefined {
          void usage.refresh({ force: true });
        },
      });
      return rows;
    },
  };
  return [
    {
      id: "provider-usage",
      group: "Usage",
      title: "Provider usage",
      subtitle: summary(usage.getSnapshot(), now(), config),
      keywords: ["quota", "limits", "usage"],
      run: () => step,
    },
  ];
}
