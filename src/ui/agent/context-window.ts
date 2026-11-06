import type { AgentUsage } from "@getpaseo/protocol/agent-types";

export type ContextWindow =
  | { kind: "none" }
  | {
      kind: "measured";
      percentage: number;
      usedTokens: number;
      maxTokens: number;
      level: "ok" | "warn" | "error";
      cost: string | null;
    };

function formatCost(usd: number | undefined): string | null {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return null;
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function contextWindow(usage: AgentUsage | undefined): ContextWindow {
  const max = usage?.contextWindowMaxTokens;
  const used = usage?.contextWindowUsedTokens;
  if (
    max === undefined ||
    used === undefined ||
    !Number.isFinite(max) ||
    !Number.isFinite(used) ||
    max <= 0
  )
    return { kind: "none" };
  const percentage = (used / max) * 100;
  return {
    kind: "measured",
    percentage,
    usedTokens: used,
    maxTokens: max,
    level: percentage > 90 ? "error" : percentage >= 70 ? "warn" : "ok",
    cost: formatCost(usage?.totalCostUsd),
  };
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1e6) return `${Math.round(tokens / 1e6)}m`;
  if (tokens >= 1e3) return `${Math.round(tokens / 1e3)}k`;
  return String(Math.round(tokens));
}

export function contextMeterText(window: ContextWindow): string {
  if (window.kind === "none") return "";
  return `ctx ${Math.round(window.percentage)}% ${formatTokenCount(window.usedTokens)}/${formatTokenCount(window.maxTokens)}`;
}

export function contextDetailRows(window: ContextWindow): string[] {
  if (window.kind === "none") return ["No context data"];
  return [
    `${Math.round(window.percentage)}% used`,
    `${formatTokenCount(window.usedTokens)} / ${formatTokenCount(window.maxTokens)} tokens`,
    ...(window.cost ? [`Session cost ${window.cost}`] : []),
  ];
}
