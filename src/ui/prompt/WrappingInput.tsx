import type { InputRenderable } from "@opentui/core";
import type { InputProps } from "@opentui/react";
import { useRef, useState } from "react";
import { fitInput } from "./input-rows.js";

interface WrappingInputProps extends Omit<InputProps, "ref"> {
  maxRows?: number;
  inputRef?(node: InputRenderable | null): void;
}
/** A single-line field whose long text wraps onto more rows instead of scrolling sideways. */
export function WrappingInput({
  maxRows = 3,
  inputRef,
  ...props
}: WrappingInputProps) {
  const node = useRef<InputRenderable | null>(null);
  const [rows, setRows] = useState(1);
  function measure() {
    if (node.current) setRows(fitInput(node.current, maxRows));
  }
  return (
    <input
      {...props}
      ref={(next: InputRenderable | null) => {
        node.current = next;
        if (next) {
          next.wrapMode = "word";
          next.height = rows;
        }
        inputRef?.(next);
      }}
      flexShrink={0}
      onInput={(value: string) => {
        props.onInput?.(value);
        measure();
      }}
      onSizeChange={measure}
    />
  );
}
