import { everyMsToFiveFieldCron } from "@getpaseo/protocol/schedule/cadence";
import { validateCronExpression } from "@getpaseo/protocol/schedule/cron-expression";
import type { ScheduleCadence } from "@getpaseo/protocol/schedule/types";

export type ParsedCadence =
  | { kind: "ok"; cron: string }
  | { kind: "error"; message: string };
const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const INTERVAL = /^(?:every\s+)?(\d+)\s*([smhd])$/i;
function isUnit(unit: string): unit is keyof typeof UNIT_MS {
  return unit in UNIT_MS;
}

/** `5m`, `every 2h`, `1d` or a five-field cron expression, as the cron the daemon receives. */
export function parseCadence(text: string): ParsedCadence {
  const trimmed = text.trim();
  if (!trimmed)
    return {
      kind: "error",
      message: "Enter an interval like 5m or a cron expression",
    };
  const interval = INTERVAL.exec(trimmed);
  if (interval) {
    const [, count, rawUnit] = interval;
    const unit = rawUnit?.toLowerCase() ?? "";
    const cron = isUnit(unit)
      ? everyMsToFiveFieldCron(Number(count) * UNIT_MS[unit])
      : null;
    return cron
      ? { kind: "ok", cron }
      : {
          kind: "error",
          message: `${trimmed} doesn't divide evenly into cron; use a cron expression`,
        };
  }
  const error = validateCronExpression(trimmed);
  return error
    ? { kind: "error", message: error }
    : { kind: "ok", cron: trimmed.replace(/\s+/g, " ") };
}

function interval(ms: number): string {
  for (const [unit, size] of [
    ["d", UNIT_MS.d],
    ["h", UNIT_MS.h],
    ["m", UNIT_MS.m],
  ] as const)
    if (ms >= size && ms % size === 0) return `${ms / size}${unit}`;
  return `${Math.round(ms / 1000)}s`;
}
export function cadenceLabel(cadence: ScheduleCadence): string {
  return cadence.type === "every"
    ? `every ${interval(cadence.everyMs)}`
    : `cron ${cadence.expression}${cadence.timezone ? ` (${cadence.timezone})` : ""}`;
}
