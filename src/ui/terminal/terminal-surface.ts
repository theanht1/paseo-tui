import {
  EmbeddedTerminalRenderable,
  KeyEvent,
  type OptimizedBuffer,
  TextAttributes,
} from "@opentui/core";

/**
 * Shift that only produced a printable character ("J") is used up, as real
 * terminals report it: otherwise apps that enable the kitty keyboard protocol
 * (lazygit) receive `CSI 106;2u`, shift+j, and their `J` bindings never match.
 */
export function consumeShift(key: KeyEvent): KeyEvent {
  const printable =
    [...key.sequence].length === 1 && !/\p{Cc}/u.test(key.sequence);
  if (
    !key.shift ||
    !printable ||
    key.ctrl ||
    key.meta ||
    key.option ||
    key.super ||
    key.hyper
  )
    return key;
  return new KeyEvent({ ...key, shift: false });
}

export class TerminalSurfaceRenderable extends EmbeddedTerminalRenderable {
  private viewport = { cols: 80, rows: 24 };
  private replaying = false;

  override encodeKey(key: KeyEvent): Uint8Array {
    return super.encodeKey(consumeShift(key));
  }

  protected override onResize(cols: number, rows: number): void {
    this.viewport = { cols, rows };
    if (!this.replaying) super.onResize(cols, rows);
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer);
    if (this.focused || !this.visible) return;
    const { cursor } = this.screen();
    if (!cursor.visible) return;
    buffer.withBuffers((cells) => {
      if (cursor.x >= cells.width || cursor.y >= cells.height) return;
      const cell = cursor.y * cells.width + cursor.x;
      cells.attributes[cell] =
        (cells.attributes[cell] ?? 0) ^ TextAttributes.INVERSE;
    });
  }

  beginReplay(cols?: number, rows?: number): void {
    this.replaying = true;
    const notifyResize = this.onTerminalResize;
    this.onTerminalResize = undefined;
    try {
      super.onResize(cols ?? this.viewport.cols, rows ?? this.viewport.rows);
      this.write("\x1bc");
    } finally {
      this.onTerminalResize = notifyResize;
    }
  }

  endReplay(): void {
    this.replaying = false;
    super.onResize(this.viewport.cols, this.viewport.rows);
  }
}
