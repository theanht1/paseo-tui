/** How the TUI alerts the terminal: OSC 9 (iTerm2, WezTerm, Ghostty, Windows Terminal…), OSC 777 (foot, VTE, rxvt), or a bell. */
export type NotifyStyle = "osc9" | "osc777" | "bell" | "off";
const STYLES: readonly NotifyStyle[] = ["osc9", "osc777", "bell", "off"];
export function parseNotifyStyle(value: string | undefined): NotifyStyle {
  const style = STYLES.find((style) => style === (value ?? "osc9"));
  if (!style) throw new Error(`--notify must be one of ${STYLES.join(", ")}`);
  return style;
}
function clean(text: string): string {
  return [...text.replace(/\s+/g, " ")]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
}
/** The bytes that raise one desktop notification; empty for `off`. */
export function notificationSequence(
  style: NotifyStyle,
  notification: { title: string; body: string },
  env: NodeJS.ProcessEnv,
): string {
  const title = clean(notification.title);
  const body = clean(notification.body);
  const osc =
    style === "osc9"
      ? `\x1b]9;${title}: ${body}\x07`
      : style === "osc777"
        ? `\x1b]777;notify;${title.replaceAll(";", ",")};${body.replaceAll(";", ",")}\x07`
        : null;
  if (osc === null) return style === "bell" ? "\x07" : "";
  return env.TMUX
    ? `\x1bPtmux;${osc.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`
    : osc;
}
