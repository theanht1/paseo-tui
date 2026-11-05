import type { PaseoAgent } from "@getpaseo/client";
export function nextMode(
  agent: Pick<PaseoAgent, "currentModeId" | "availableModes">,
): string | null {
  const modes = agent.availableModes;
  if (modes.length < 2) return null;
  const index = modes.findIndex((mode) => mode.id === agent.currentModeId);
  return modes[(index + 1) % modes.length]?.id ?? null;
}
