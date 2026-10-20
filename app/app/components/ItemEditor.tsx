"use client";

import { useState } from "react";
import {
  WaButton,
  WaDialog,
  WaInput,
} from "@awesome.me/webawesome/dist/react";
import { MAX_TEXT_LENGTH, TEXT_COLOURS } from "../lib/text";
import {
  FILTER_KINDS,
  FILTERS,
  MAX_FILTER_CHAIN,
  parseChain,
  serialiseChain,
  type FilterKind,
  type FilterStep,
} from "../lib/filters";
import type { BoardItem } from "@/types/board";

type Props = {
  /** The item being edited, or null when the dialog is closed. */
  item: BoardItem | null;
  onClose: () => void;
  onSave: (
    id: string,
    changes: { text: string; color: string; filter: string },
  ) => void;
};

/**
 * Changing a placed item's appearance: the words on a text item, the colour of
 * a text item or a shape, and the chain of effects on a filter. Those are the
 * kinds whose look is stored on the item rather than fetched from somewhere.
 *
 * The draft lives here rather than on the item, and one save sends one event —
 * so nobody watching the board (or the stream) sees it edited keystroke by
 * keystroke, and undo steps over the whole change.
 */
type Draft = { id: string; text: string; color: string; chain: FilterStep[] };

export default function ItemEditor({ item, onClose, onSave }: Props) {
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
  const chain =
    editing?.chain ?? (item ? parseChain(item.filter, item.strength) : []);

  const edit = (changes: Partial<Omit<Draft, "id">>) => {
    if (!item) return;
    setDraft({ id: item.id, text, color, chain, ...changes });
  };

  const setStep = (index: number, step: Partial<FilterStep>) =>
    edit({
      chain: chain.map((existing, at) =>
        at === index ? { ...existing, ...step } : existing,
      ),
    });

  // Dropped on the way out, so reopening reads the item again rather than
  // restoring a draft that was abandoned.
  const close = () => {
    setDraft(null);
    onClose();
  };

  const isText = item?.kind === "text";
  const isFilter = item?.kind === "filter";
  const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
  // An empty text item would be invisible on the board, and clearing the box is
  // not how you delete something — so saving stays disabled instead. A shape
  // has no words to empty.
  const canSave = !isText || trimmed.length > 0;

  const save = () => {
    if (!item || !canSave) return;
    onSave(item.id, {
      text: trimmed,
      color,
      filter: serialiseChain(chain),
    });
    close();
  };

  return (
    <WaDialog
      className="text-editor"
      label={isText ? "Edit text" : isFilter ? "Edit filter" : "Recolour"}
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

      {isFilter && (
        <>
          <p className="text-sm">
            Effects apply in order, in one pass over whatever is underneath.
          </p>

          {chain.length === 0 && (
            <p className="py-2 text-sm opacity-60">
              Nothing here yet — add an effect below.
            </p>
          )}

          {chain.map((step, index) => (
            <div className="filter-step" key={`${step.kind}-${index}`}>
              <div className="filter-step-head">
                <span className="filter-step-name">
                  {FILTERS[step.kind].label}
                </span>
                <span className="filter-step-amount">
                  {Math.round(step.strength * 100)}%
                </span>
                <WaButton
                  size="small"
                  appearance="plain"
                  variant="danger"
                  onClick={() =>
                    edit({ chain: chain.filter((_, at) => at !== index) })
                  }
                >
                  Remove
                </WaButton>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(step.strength * 100)}
                onChange={(event) =>
                  setStep(index, {
                    strength: Number(event.target.value) / 100,
                  })
                }
              />
            </div>
          ))}

          {chain.length < MAX_FILTER_CHAIN && (
            <div className="filter-add">
              {FILTER_KINDS.map((kind: FilterKind) => (
                <WaButton
                  key={kind}
                  size="small"
                  appearance="outlined"
                  title={FILTERS[kind].hint}
                  onClick={() =>
                    edit({
                      chain: [
                        ...chain,
                        { kind, strength: FILTERS[kind].strength },
                      ],
                    })
                  }
                >
                  + {FILTERS[kind].label}
                </WaButton>
              ))}
            </div>
          )}
        </>
      )}

      <div className="text-editor-swatches" hidden={isFilter}>
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
