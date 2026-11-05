function branchName(ref: string): string {
  return ref
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\//, "")
    .replace(/^origin\//, "");
}
/** Daemon-reported base (checkout status `baseRef`) when listed, else main, else master, else the first branch. */
export function defaultBaseBranch(
  branches: readonly string[],
  reported: string | null,
): string | null {
  const base = reported ? branchName(reported) : null;
  if (base && branches.includes(base)) return base;
  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";
  return base ?? branches[0] ?? null;
}
