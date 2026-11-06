import type { Block } from "../timeline/blocks.js";
import {
  findPathMentions,
  findUrlMentions,
  type PathMention,
  resolvePath,
} from "./detect.js";

export interface FileLink {
  /** Absolute, or `~/…` for the daemon host's home. */
  path: string;
  line: number | null;
  col: number | null;
  /** The text as it appears in the chat. */
  raw: string;
  /** Tool calls name files explicitly; text mentions still need an existence check. */
  source: "tool" | "text";
}

/** A web link; it opens in the browser of the machine running the TUI. */
export interface UrlLink {
  kind: "url";
  url: string;
  /** The text as it appears on screen (the URL, or a markdown link's label). */
  raw: string;
}
export type ChatLink = (FileLink & { kind: "file" }) | UrlLink;
/** A link found in one line of screen text. */
export interface LinkSpan {
  start: number;
  end: number;
  raw: string;
  link: ChatLink;
}

function toolLink(block: Extract<Block, { kind: "tool" }>, cwd: string) {
  const detail = block.call.detail;
  if (
    detail.type !== "read" &&
    detail.type !== "edit" &&
    detail.type !== "write"
  )
    return [];
  return [
    {
      path: resolvePath(detail.filePath, cwd),
      line: detail.type === "read" ? (detail.offset ?? null) : null,
      col: null,
      raw: detail.filePath,
      source: "tool" as const,
    },
  ];
}

/** File mentions in chat order: tool-call file paths and assistant text mentions. */
export function timelineLinks(
  blocks: readonly Block[],
  cwd: string,
): FileLink[] {
  return blocks.flatMap((block): FileLink[] => {
    if (block.kind === "tool") return toolLink(block, cwd);
    if (block.kind !== "assistant") return [];
    return findPathMentions(block.text).map((mention) => ({
      path: resolvePath(mention.path, cwd),
      line: mention.line,
      col: mention.col,
      raw: mention.raw,
      source: "text",
    }));
  });
}

const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
/**
 * Web link targets of markdown links by label: the chat draws `[label](url)` as just
 * `label`, so a label on screen still leads to its URL.
 */
export function markdownUrlLabels(
  blocks: readonly Block[],
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const block of blocks) {
    const text =
      block.kind === "assistant" || block.kind === "plan" ? block.text : null;
    if (!text) continue;
    for (const match of text.matchAll(MARKDOWN_LINK)) {
      const label = match[1]?.trim();
      const target = match[2] ?? "";
      const [url] = findUrlMentions(target);
      if (label && url?.raw === target) labels.set(label, url.url);
    }
  }
  return labels;
}
const WORD = /[\p{L}\p{N}_]/u;
function labelSpans(text: string, labels: ReadonlyMap<string, string>) {
  const spans: LinkSpan[] = [];
  for (const [label, url] of labels) {
    for (
      let start = text.indexOf(label);
      start >= 0;
      start = text.indexOf(label, start + 1)
    ) {
      const end = start + label.length;
      const before = text[start - 1];
      const after = text[end];
      if ((before && WORD.test(before)) || (after && WORD.test(after)))
        continue;
      spans.push({
        start,
        end,
        raw: label,
        link: { kind: "url", url, raw: label },
      });
    }
  }
  return spans;
}

/** Existing files, most recent mention first, once per path and line. */
export function chatFiles(
  links: readonly FileLink[],
  exists: (link: FileLink) => boolean,
): FileLink[] {
  const seen = new Set<string>();
  const result: FileLink[] = [];
  for (const link of [...links].reverse()) {
    const key = `${link.path}\0${link.line ?? ""}`;
    if (seen.has(key) || !exists(link)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}

const PROTECTED =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\[[^\]]*\]\([^)]*\)|<[^>\s]+>/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

function linkifyPlain(
  text: string,
  cwd: string,
  isFile: (path: string) => boolean,
) {
  let result = "";
  let at = 0;
  for (const mention of findPathMentions(text)) {
    if (/__|\*\*/.test(mention.raw) || !isFile(resolvePath(mention.path, cwd)))
      continue;
    result += `${text.slice(at, mention.start)}[${mention.raw}](${mention.raw})`;
    at = mention.end;
  }
  return result + text.slice(at);
}

function linkifyLine(
  line: string,
  cwd: string,
  isFile: (path: string) => boolean,
) {
  let result = "";
  let at = 0;
  for (const match of line.matchAll(PROTECTED)) {
    result += linkifyPlain(line.slice(at, match.index), cwd, isFile);
    const code = match[1] ? match[2]?.trim() : undefined;
    const [only] = code ? findPathMentions(code) : [];
    result +=
      code &&
      only?.raw === code &&
      !/__|\*\*/.test(code) &&
      isFile(resolvePath(only.path, cwd))
        ? `[${code}](${code})`
        : match[0];
    at = match.index + match[0].length;
  }
  return result + linkifyPlain(line.slice(at), cwd, isFile);
}

/**
 * Rewrites existing file mentions as self-labelled markdown links (`[p](p)`), which the
 * renderer shows as just `p` in the link style. Fenced code, links and URLs are untouched.
 */
export function linkifyMarkdown(
  text: string,
  cwd: string,
  isFile: (path: string) => boolean,
): string {
  let fence: string | null = null;
  return text
    .split("\n")
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length)
          fence = null;
        return line;
      }
      if (marker) {
        fence = marker;
        return line;
      }
      return linkifyLine(line, cwd, isFile);
    })
    .join("\n");
}

/** Decides which mentions are links: tool-call paths, plus mentions `exists` confirms. */
export function fileResolver(
  links: readonly FileLink[],
  cwd: string,
  exists: (path: string) => boolean,
  urlLabels: ReadonlyMap<string, string> = new Map(),
) {
  const trusted = new Set(
    links.filter((link) => link.source === "tool").map((link) => link.path),
  );
  function isFile(path: string) {
    return trusted.has(path) || exists(path);
  }
  function resolve(mention: PathMention): FileLink | null {
    const path = resolvePath(mention.path, cwd);
    return isFile(path)
      ? {
          path,
          line: mention.line,
          col: mention.col,
          raw: mention.raw,
          source: "text",
        }
      : null;
  }
  /** Links in one line of screen text, in order: URLs, then link labels, then files. */
  function linksIn(text: string): LinkSpan[] {
    const spans: LinkSpan[] = findUrlMentions(text).map((mention) => ({
      start: mention.start,
      end: mention.end,
      raw: mention.raw,
      link: { kind: "url", url: mention.url, raw: mention.raw },
    }));
    const free = (span: { start: number; end: number }) =>
      spans.every(
        (taken) => span.end <= taken.start || span.start >= taken.end,
      );
    for (const span of labelSpans(text, urlLabels))
      if (free(span)) spans.push(span);
    for (const mention of findPathMentions(text)) {
      const file = free(mention) ? resolve(mention) : null;
      if (file)
        spans.push({
          start: mention.start,
          end: mention.end,
          raw: mention.raw,
          link: { kind: "file", ...file },
        });
    }
    return spans.sort((a, b) => a.start - b.start);
  }
  return {
    isFile,
    resolve,
    linksIn,
    /** The link drawn at column `col` of a screen line. */
    resolveAt(line: string, col: number): ChatLink | null {
      return (
        linksIn(line).find((span) => col >= span.start && col < span.end)
          ?.link ?? null
      );
    },
    files: () => chatFiles(links, (link) => isFile(link.path)),
  };
}
export type FileResolver = ReturnType<typeof fileResolver>;
