import {
  BoxRenderable,
  type CliRenderer,
  fg,
  type MarkdownOptions,
  StyledText,
  type TextChunk,
  TextRenderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useContext, useMemo } from "react";
import { highlightChunks } from "./code.js";
import {
  backgroundProp,
  foregroundProp,
  type Theme,
  ThemeContext,
} from "./theme.js";

export function buildCodeBlock(
  renderer: CliRenderer,
  token: { text: string; lang?: string },
  theme: Theme,
): BoxRenderable {
  const box = new BoxRenderable(renderer, {
    flexDirection: "column",
    backgroundColor: backgroundProp(theme.codeBg),
    paddingX: 1,
  });
  if (token.lang)
    box.add(
      new TextRenderable(renderer, {
        content: token.lang,
        fg: foregroundProp(theme.faint),
      }),
    );
  const chunks: TextChunk[] = [];
  for (const [index, line] of highlightChunks(
    token.text,
    token.lang ?? "",
    theme,
  ).entries()) {
    if (index) chunks.push({ __isChunk: true, text: "\n" });
    for (const chunk of line)
      chunks.push(
        chunk.fg
          ? fg(chunk.fg)(chunk.text)
          : { __isChunk: true, text: chunk.text },
      );
  }
  box.add(
    new TextRenderable(renderer, {
      content: new StyledText(chunks),
      fg: foregroundProp(theme.fg),
    }),
  );
  return box;
}

export interface MarkdownProps {
  text: string;
  streaming?: boolean;
  dim?: boolean;
}
export function Markdown({
  text,
  streaming = false,
  dim = false,
}: MarkdownProps) {
  const renderer = useRenderer();
  const context = useContext(ThemeContext);
  if (!context) throw new Error("Markdown requires ThemeContext");
  const { theme, syntaxStyle } = context;
  const renderNode = useMemo<MarkdownOptions["renderNode"]>(
    () => (token) =>
      token.type === "code" && "text" in token && typeof token.text === "string"
        ? buildCodeBlock(
            renderer,
            {
              text: token.text,
              lang:
                "lang" in token && typeof token.lang === "string"
                  ? token.lang
                  : undefined,
            },
            theme,
          )
        : null,
    [renderer, theme],
  );
  return (
    <markdown
      content={text}
      syntaxStyle={syntaxStyle}
      streaming={streaming}
      conceal
      renderNode={renderNode}
      fg={foregroundProp(dim ? theme.muted : theme.fg)}
    />
  );
}
