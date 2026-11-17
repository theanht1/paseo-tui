import { posix } from "node:path";

/** How a chat file link opens: in the terminal editor, with the OS opener, or not at all. */
export type FileOpen =
  | { kind: "editor" }
  | { kind: "system"; path: string }
  | { kind: "unavailable"; message: string };

/** Images, video, audio, PDFs, office documents and fonts; everything else is edited as text. */
const NON_TEXT = new Set([
  ...["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico"],
  ...["heic", "heif", "avif", "psd", "raw"],
  ...["mp4", "m4v", "mov", "avi", "mkv", "webm", "wmv", "flv", "mpg", "mpeg"],
  ...["mp3", "wav", "flac", "aac", "ogg", "oga", "opus", "m4a", "aiff"],
  ...["pdf", "epub", "doc", "docx", "xls", "xlsx", "ppt", "pptx"],
  ...["odt", "ods", "odp", "key", "pages", "numbers"],
  ...["ttf", "otf", "woff", "woff2"],
]);

function isText(path: string) {
  const extension = posix.extname(path).slice(1).toLowerCase();
  return !NON_TEXT.has(extension);
}

/**
 * Text opens in the terminal editor on the daemon host. Other files open with the
 * OS opener of the machine running the TUI, which only reaches them when the
 * agent's daemon runs on this machine too.
 */
export function fileOpen(
  path: string,
  where: { remote: boolean; home: string },
): FileOpen {
  if (isText(path)) return { kind: "editor" };
  if (where.remote)
    return {
      kind: "unavailable",
      message: `${posix.basename(path)} is not a text file and lives on another machine`,
    };
  return {
    kind: "system",
    path: path.startsWith("~/") ? posix.join(where.home, path.slice(2)) : path,
  };
}
