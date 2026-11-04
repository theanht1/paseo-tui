import { homedir } from "node:os";
import type { PaseoAgent } from "@getpaseo/client";
export function agentGlyph(agent: PaseoAgent): {
  glyph: string;
  color: string;
} {
  if (agent.pendingPermissions.length > 0)
    return { glyph: "!", color: "yellow" };
  if (agent.status === "running") return { glyph: "●", color: "green" };
  if (agent.status === "error" || agent.status === "closed")
    return { glyph: "✕", color: "red" };
  return { glyph: "○", color: "gray" };
}
export function agentName(agent: PaseoAgent): string {
  return agent.title ?? agent.id.slice(0, 8);
}
export function shortPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`)
    ? `~${path.slice(home.length)}`
    : path;
}

export function agentAge(updatedAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(updatedAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
