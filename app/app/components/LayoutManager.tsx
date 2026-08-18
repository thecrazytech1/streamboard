"use client";

import { useState } from "react";
import {
  WaButton,
  WaDialog,
  WaInput,
  WaRelativeTime,
} from "@awesome.me/webawesome/dist/react";
import type { BoardLayout } from "@/types/board";

type Props = {
  open: boolean;
  onClose: () => void;
  layouts: BoardLayout[];
  
  error: string | null;
  
  itemCount: number;
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
};

export default function LayoutManager({
  open,
  onClose,
  layouts,
  error,
  itemCount,
  onSave,
  onLoad,
  onDelete,
}: Props) {
  const [name, setName] = useState("");
  
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const trimmed = name.trim();

  const overwriting = layouts.some(
    (layout) => layout.name.toLowerCase() === trimmed.toLowerCase(),
  );

  const save = () => {
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
  };

  const load = (id: string) => {
    onLoad(id);
    onClose();
  };

  return (
    <WaDialog
      className="layout-manager"
      label="Layouts"
      open={open}
      onWaHide={() => {
        setConfirmingDelete(null);
        onClose();
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <WaInput
            className="grow"
            placeholder="Name this arrangement…"
            value={name}
            withClear
            maxlength={40}
            onInput={(event) => setName(event.currentTarget.value ?? "")}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
            }}
          />
          <WaButton variant="brand" disabled={!trimmed} onClick={save}>
            {overwriting ? "Overwrite" : "Save"}
          </WaButton>
        </div>

        <p className="text-xs opacity-60">
          {overwriting
            ? `Replaces “${trimmed}” with the board as it looks now (${itemCount} items).`
            : `Saves all ${itemCount} items where they are — positions, sizes, rotation and stacking.`}
        </p>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {layouts.length === 0 ? (
          <p className="py-2 text-sm opacity-60">
            No layouts saved yet. Arrange the board, give it a name, and it&apos;ll
            show up here.
          </p>
        ) : (
          <>
            <p className="text-xs opacity-60">
              Loading a layout replaces the board for everyone, overlay
              included. Ctrl+Z puts it back.
            </p>

            <ul className="layout-list">
              {layouts.map((layout) => (
                <li key={layout.id} className="layout-row">
                  <div className="layout-row-text">
                    <span className="layout-row-name">{layout.name}</span>
                    <span className="layout-row-meta">
                      {layout.itemCount}{" "}
                      {layout.itemCount === 1 ? "item" : "items"} · saved{" "}
                      <WaRelativeTime
                        date={new Date(layout.savedAt).toISOString()}
                        sync
                      />
                      {layout.savedByName && ` by ${layout.savedByName}`}
                    </span>
                  </div>

                  <WaButton
                    size="small"
                    variant="neutral"
                    onClick={() => load(layout.id)}
                  >
                    Load
                  </WaButton>

                  {confirmingDelete === layout.id ? (
                    <WaButton
                      size="small"
                      variant="danger"
                      onClick={() => {
                        onDelete(layout.id);
                        setConfirmingDelete(null);
                      }}
                    >
                      Sure?
                    </WaButton>
                  ) : (
                    <WaButton
                      size="small"
                      appearance="plain"
                      variant="danger"
                      onClick={() => setConfirmingDelete(layout.id)}
                    >
                      Delete
                    </WaButton>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <WaButton slot="footer" appearance="outlined" onClick={onClose}>
        Close
      </WaButton>
    </WaDialog>
  );
}
