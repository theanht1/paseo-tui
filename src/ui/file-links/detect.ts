import { posix } from "node:path";

export interface PathMention {
  /** Offsets of `raw` in the scanned text. */
  start: number;
  end: number;
  /** The mention as written, including any `:line[:col]` or `#L` suffix. */
  raw: string;
  /** The path part as written (relative, absolute or `~/`). */
  path: string;
  line: number | null;
  col: number | null;
}

const TOKEN = /[^\s'"`()<>[\]{},;|*=]+/g;
const TRAILING = /[.,:;!?]+$/;
const LOCATION =
  /^(.*?)(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?)$/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:(?!\d)/;
const BARE_FILE = /^[\w.+@-]*[\w]\.[A-Za-z0-9]{1,12}$/;
const EXTENSIONLESS: ReadonlySet<string> = new Set([
  "Makefile",
  "Dockerfile",
  "Containerfile",
  "Gemfile",
  "Rakefile",
  "Procfile",
  "Justfile",
  "LICENSE",
]);

function plausiblePath(path: string): boolean {
  if (/[:#]/.test(path) || path.startsWith("//") || path.endsWith("/"))
    return false;
  if (!/[A-Za-z]/.test(path)) return false;
  if (path.includes("/"))
    return path.split("/").some((segment) => /[A-Za-z]/.test(segment));
  if (EXTENSIONLESS.has(path)) return true;
  if (!BARE_FILE.test(path)) return false;
  const dot = path.lastIndexOf(".");
  const extension = path.slice(dot + 1);
  return dot >= 2 && /[A-Za-z]/.test(extension);
}

function toMention(token: string, offset: number): PathMention | null {
  if (token.includes("://") || SCHEME.test(token)) return null;
  const raw = token.replace(TRAILING, "");
  if (!raw) return null;
  const location = LOCATION.exec(raw);
  const path = location?.[1] ?? raw;
  const line = location?.[2] ?? location?.[4];
  const col = location?.[3] ?? location?.[5];
  if (!plausiblePath(path)) return null;
  return {
    start: offset,
    end: offset + raw.length,
    raw,
    path,
    line: line ? Number(line) : null,
    col: col ? Number(col) : null,
  };
}

/** Syntactically plausible file paths in free text; existence is checked separately. */
export function findPathMentions(text: string): PathMention[] {
  const mentions: PathMention[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const mention = toMention(match[0], match.index);
    if (mention) mentions.push(mention);
  }
  return mentions;
}

/** The mention covering column `col` of a single line, if any. */
export function mentionAt(line: string, col: number): PathMention | null {
  return (
    findPathMentions(line).find(
      (mention) => col >= mention.start && col < mention.end,
    ) ?? null
  );
}

export interface UrlMention {
  /** Offsets of `raw` in the scanned text. */
  start: number;
  end: number;
  raw: string;
  /** The parsed `http:`/`https:` URL, normalized. */
  url: string;
}

const URL_TOKEN = /(?<![A-Za-z0-9+.-])https?:\/\/[^\s<>"'`]+/gi;
const URL_TRAILING = /[.,:;!?]+$/;

function count(text: string, char: string) {
  return text.split(char).length - 1;
}
/** Drops trailing punctuation and closing brackets that the URL did not open. */
function trimUrl(token: string): string {
  let raw = token;
  for (;;) {
    const next = raw.replace(URL_TRAILING, "");
    const last = next.at(-1);
    const pairs = { ")": "(", "]": "[", "}": "{" } as const;
    const open =
      last === ")" || last === "]" || last === "}" ? pairs[last] : null;
    const trimmed =
      open && last && count(next, last) > count(next, open)
        ? next.slice(0, -1)
        : next;
    if (trimmed === raw) return raw;
    raw = trimmed;
  }
}

/** `http://` and `https://` URLs in free text; other schemes are never links. */
export function findUrlMentions(text: string): UrlMention[] {
  const mentions: UrlMention[] = [];
  for (const match of text.matchAll(URL_TOKEN)) {
    const raw = trimUrl(match[0]);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.host)
      continue;
    mentions.push({
      start: match.index,
      end: match.index + raw.length,
      raw,
      url: url.href,
    });
  }
  return mentions;
}

/** The URL covering column `col` of a single line, if any. */
export function urlAt(line: string, col: number): UrlMention | null {
  return (
    findUrlMentions(line).find(
      (mention) => col >= mention.start && col < mention.end,
    ) ?? null
  );
}

/** Absolute path, or a normalized `~/` path the daemon expands itself. */
export function resolvePath(path: string, cwd: string): string {
  if (path.startsWith("~/")) return `~/${posix.normalize(path.slice(2))}`;
  if (path.startsWith("/")) return posix.normalize(path);
  return posix.join(cwd, path);
}
