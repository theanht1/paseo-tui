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
