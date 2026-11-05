import type { ProviderUsageWindow } from "@getpaseo/protocol/messages";
import type { UsageReportEntry } from "../../connection/ports.js";

type Report = UsageReportEntry["report"];
type Available = Extract<Report, { status: "available" }>;
type Balance = NonNullable<Available["balances"]>[number];

export function usedPercent(window: ProviderUsageWindow): number | null {
  if (window.usedPct != null) return window.usedPct;
  if (window.remainingPct != null) return 100 - window.remainingPct;
  return null;
}
/** `<1m`, `45m`, `3h`, `4d`: the largest whole unit. */
export function relativeDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
function resetsIn(window: ProviderUsageWindow, now: number): string | null {
  if (!window.resetsAt) return null;
  const at = Date.parse(window.resetsAt);
  return Number.isNaN(at) ? null : relativeDuration(Math.max(0, at - now));
}
/** The provider's summary window, else its most-used one. */
function headline(windows: readonly ProviderUsageWindow[]) {
  const measured = windows.filter((window) => usedPercent(window) !== null);
  return (
    measured.find((window) => window.summary === true) ??
    measured.reduce<ProviderUsageWindow | null>(
      (best, window) =>
        !best || (usedPercent(window) ?? 0) > (usedPercent(best) ?? 0)
          ? window
          : best,
      null,
    )
  );
}
function percentText(window: ProviderUsageWindow): string {
  return `${Math.round(usedPercent(window) ?? 0)}%`;
}
/** Status bar text, e.g. `claude 62% · resets 3h`; empty when no provider reports usage. */
export function usageMeters(
  reports: readonly UsageReportEntry[],
  now: number,
): string {
  return reports
    .flatMap((entry) => {
      if (entry.report.status !== "available") return [];
      const window = headline(entry.report.windows);
      if (!window) return [];
      const reset = resetsIn(window, now);
      return [
        `${entry.sourceLabel.toLowerCase()} ${percentText(window)}${reset ? ` · resets ${reset}` : ""}`,
      ];
    })
    .join("  ");
}

function amount(value: number, unit: Balance["unit"]): string {
  return unit === "usd" ? `$${value.toFixed(2)}` : `${value} ${unit}`;
}
function balanceText(balance: Balance): string {
  if (balance.remaining != null)
    return balance.limit != null
      ? `${amount(balance.remaining, balance.unit)} left of ${amount(balance.limit, balance.unit)}`
      : `${amount(balance.remaining, balance.unit)} left`;
  if (balance.used != null)
    return balance.limit != null
      ? `${amount(balance.used, balance.unit)} used of ${amount(balance.limit, balance.unit)}`
      : `${amount(balance.used, balance.unit)} used`;
  return "unknown";
}
function problemText(report: Exclude<Report, Available>): string {
  if (report.status === "error") return report.error;
  switch (report.problem.kind) {
    case "no_quota":
      return report.problem.detail;
    case "expired":
      return "Sign-in expired; sign in again";
    case "rejected":
      return `Credentials rejected (HTTP ${report.problem.status})`;
  }
}
export interface UsageRow {
  id: string;
  title: string;
  subtitle: string;
}
/** One row per window, balance, detail or problem, for the Provider usage view. */
export function usageDetailRows(
  reports: readonly UsageReportEntry[],
  now: number,
): UsageRow[] {
  return reports.flatMap((entry): UsageRow[] => {
    const name = entry.sourceLabel;
    const report = entry.report;
    if (report.status !== "available")
      return [
        {
          id: `${entry.id}:problem`,
          title: `${name} · ${report.status}`,
          subtitle: problemText(report),
        },
      ];
    const plan = report.planLabel ?? "";
    return [
      ...report.windows.map((window) => {
        const reset = resetsIn(window, now);
        return {
          id: `${entry.id}:window:${window.id}`,
          title: `${name} · ${window.label}${usedPercent(window) === null ? "" : ` ${percentText(window)}`}`,
          subtitle: [plan, reset ? `resets in ${reset}` : null]
            .filter(Boolean)
            .join(" · "),
        };
      }),
      ...(report.balances ?? []).map((balance) => ({
        id: `${entry.id}:balance:${balance.id}`,
        title: `${name} · ${balance.label} ${balanceText(balance)}`,
        subtitle: plan,
      })),
      ...(report.details ?? []).map((detail) => ({
        id: `${entry.id}:detail:${detail.id}`,
        title: `${name} · ${detail.label}: ${detail.value}`,
        subtitle: plan,
      })),
    ];
  });
}
