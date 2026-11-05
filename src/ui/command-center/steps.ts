import type { CommandStep } from "./registry.js";
export interface StackEntry {
  step: CommandStep;
  query: string;
  selected: number;
}
export function push(
  stack: readonly StackEntry[],
  step: CommandStep,
): StackEntry[] {
  return [
    ...stack,
    {
      step,
      query: step.kind === "input" ? (step.initial ?? "") : "",
      selected: 0,
    },
  ];
}
export function back(stack: readonly StackEntry[]): StackEntry[] | null {
  return stack.length > 1 ? stack.slice(0, -1) : null;
}
/** Title plus as many trailing step titles as fit in `width` cells, eliding older ones with "…". */
export function breadcrumb(
  title: string,
  steps: readonly string[],
  width: number,
): string {
  const full = [title, ...steps].join(" › ");
  if (full.length <= width) return full;
  for (let start = 1; start < steps.length; start++) {
    const text = [title, "…", ...steps.slice(start)].join(" › ");
    if (text.length <= width) return text;
  }
  return `${title} › …`;
}
