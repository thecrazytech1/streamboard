"use client";

import { useState } from "react";
import {
  WaButton,
  WaDialog,
  WaInput,
} from "@awesome.me/webawesome/dist/react";
import { MAX_TEXT_LENGTH, TEXT_COLOURS } from "../lib/text";
import type { BoardItem } from "@/types/board";

type Props = {
  /** The text item being edited, or null when the dialog is closed. */
  item: BoardItem | null;
  onClose: () => void;
  onSave: (id: string, text: string, color: string) => void;
};

/**
 * Changing a placed item's appearance: the words on a text item, and the colour
 * of either a text item or a shape. Those are the only two kinds whose look is
 * stored on the item rather than fetched from somewhere.
 *
 * The draft lives here rather than on the item, and one save sends one event —
 * so nobody watching the board (or the stream) sees it typed out a character at
 * a time, and undo steps over the whole edit rather than each keystroke.
 */
type Draft = { id: string; text: string; color: string };

export default function TextEditor({ item, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);

  /**
   * The draft is stamped with the item it belongs to, and falls back to what the
   * item currently says. So the dialog is seeded without an effect syncing state
   * into state — the same trick useBoardAccess and useOverlayLink use — and
   * opening a different item can't leave the previous one's words on screen.
   */
  const editing = item && draft?.id === item.id ? draft : null;
  const text = editing?.text ?? item?.text ?? "";
  const color = editing?.color ?? item?.color ?? TEXT_COLOURS[0];

  const edit = (changes: Partial<Omit<Draft, "id">>) => {
    if (!item) return;
    setDraft({ id: item.id, text, color, ...changes });
  };

  // Dropped on the way out, so reopening reads the item again rather than
  // restoring a draft that was abandoned.
  const close = () => {
    setDraft(null);
    onClose();
  };

  const isText = item?.kind === "text";
  const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
  // An empty text item would be invisible on the board, and clearing the box is
  // not how you delete something — so saving stays disabled instead. A shape
  // has no words to empty.
  const canSave = !isText || trimmed.length > 0;

  const save = () => {
    if (!item || !canSave) return;
    onSave(item.id, trimmed, color);
    close();
  };

  return (
    <WaDialog
      className="text-editor"
      label={isText ? "Edit text" : "Recolour"}
      open={item !== null}
      onWaHide={close}
      lightDismiss
    >
      {isText && (
        <WaInput
          placeholder="Type something…"
          value={text}
          withClear
          maxlength={MAX_TEXT_LENGTH}
          onInput={(event) => edit({ text: event.currentTarget.value ?? "" })}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
        />
      )}

      <div className="text-editor-swatches">
        {TEXT_COLOURS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`text-swatch${color === swatch ? " is-active" : ""}`}
            style={{ background: swatch }}
            aria-label={`Use ${swatch}`}
            aria-pressed={color === swatch}
            onClick={() => edit({ color: swatch })}
          />
        ))}
      </div>

      {/* The same treatment the board gives it, so the colour choice is a
          preview rather than a guess. Size isn't matched — that's the handle's
          job, and a 700px line wouldn't fit in a dialog. */}
      {isText && canSave && (
        <p className="text-editor-preview board-text" style={{ color }}>
          {trimmed}
        </p>
      )}

      <WaButton slot="footer" appearance="outlined" onClick={close}>
        Cancel
      </WaButton>
      <WaButton slot="footer" variant="brand" disabled={!canSave} onClick={save}>
        Save
      </WaButton>
    </WaDialog>
  );
}
