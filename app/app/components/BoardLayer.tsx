"use client";

import { useEffect, useRef } from "react";
import { socket } from "../../utils/socket";
import { emoteUrl } from "../lib/sevenTv";
import { resolveImageSrc } from "../lib/images";
import {
  centreOf,
  type FlipAxis,
  flipTransforms,
  itemTransformCss,
  moveTransforms,
  scaleRotateTransforms,
  selectionBounds,
} from "../lib/selection";
import {
  itemHeight,
  screenToWorld,
  type View,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../lib/world";
import type {
  BoardItem,
  ItemTransform,
  ReorderDirection,
} from "@/types/board";

type Props = {
  items: Record<string, BoardItem>;
  
  view: View;
  readOnly?: boolean;
  selectedIds?: ReadonlySet<string>;
  
  onSelect?: (ids: string[]) => void;
  
  onLocalTransform?: (transforms: ItemTransform[]) => void;
  onReorder?: (ids: string[], direction: ReorderDirection) => void;
  onRemove?: (ids: string[]) => void;
};


const TRANSFORM_THROTTLE_MS = 40;


const TOOLBAR_GAP = 24;


const SIZE_STEP = 1.1;

const FINE_SIZE_STEP = 1.02;

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function emitTransforms(
  lastEmit: { current: number },
  transforms: ItemTransform[],
  force = false,
): void {
  if (transforms.length === 0) return;

  const now = performance.now();
  if (!force && now - lastEmit.current < TRANSFORM_THROTTLE_MS) return;
  lastEmit.current = now;

  if (transforms.length === 1) {
    socket.emit("item:transform", transforms[0]);
  } else {
    socket.emit("items:transform", transforms);
  }
}

export default function BoardLayer({
  items,
  view,
  readOnly = false,
  selectedIds = EMPTY_SELECTION,
  onSelect,
  onLocalTransform,
  onReorder,
  onRemove,
}: Props) {
  const lastEmit = useRef(0);

  const selected = [...selectedIds]
    .map((id) => items[id])
    .filter((item): item is BoardItem => item !== undefined);

  const bounds = readOnly ? null : selectionBounds(selected);



  useEffect(() => {
    if (readOnly || selectedIds.size === 0) return;

    const live = [...selectedIds].filter((id) => items[id]);
    if (live.length !== selectedIds.size) onSelect?.(live);
  }, [readOnly, selectedIds, items, onSelect]);

  const commit = (transforms: ItemTransform[], force = false) => {
    onLocalTransform?.(transforms);
    emitTransforms(lastEmit, transforms, force);
  };

  const flip = (axis: FlipAxis) => {
    if (!bounds || selected.length === 0) return;
    commit(flipTransforms(selected, axis, centreOf(bounds)), true);
  };

  const scaleBy = (ratio: number) => {
    if (!bounds || selected.length === 0) return;
    commit(scaleRotateTransforms(selected, centreOf(bounds), ratio, 0), true);
  };





  const flipRef = useRef(flip);
  const scaleRef = useRef(scaleBy);
  useEffect(() => {
    flipRef.current = flip;
    scaleRef.current = scaleBy;
  });

  useEffect(() => {
    if (readOnly || selectedIds.size === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {

      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, wa-input")) return;

      const ids = [...selectedIds];

      if (event.key === "Escape") onSelect?.([]);
      if (event.key === "Delete" || event.key === "Backspace") {
        onRemove?.(ids);
        onSelect?.([]);
      }
      if (event.key === "]") onReorder?.(ids, "front");
      if (event.key === "[") onReorder?.(ids, "back");



      if (!event.ctrlKey && !event.metaKey) {
        const step = event.altKey ? FINE_SIZE_STEP : SIZE_STEP;

        if (event.key === "+" || event.key === "=") scaleRef.current(step);
        if (event.key === "-" || event.key === "_") scaleRef.current(1 / step);
      }


      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "h" || event.key === "H") flipRef.current("x");
      if (event.key === "v" || event.key === "V") flipRef.current("y");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly, selectedIds, onSelect, onReorder, onRemove]);

  const runGesture = (
    element: HTMLElement,
    pointerId: number,
    compute: (event: PointerEvent) => ItemTransform[],
  ) => {
    element.setPointerCapture(pointerId);

    const onMove = (event: PointerEvent) => commit(compute(event));

    const onEnd = (event: PointerEvent) => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onEnd);
      element.removeEventListener("pointercancel", onEnd);
      commit(compute(event), true);
    };

    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onEnd);
    element.addEventListener("pointercancel", onEnd);
  };

  const startMove = (
    item: BoardItem,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (readOnly || event.button !== 0) return;
    event.preventDefault();

    event.stopPropagation();

    const additive = event.shiftKey || event.ctrlKey || event.metaKey;



    if (additive && selectedIds.has(item.id)) {
      onSelect?.([...selectedIds].filter((id) => id !== item.id));
      return;
    }



    const dragging = additive
      ? [...selected, item]
      : selectedIds.has(item.id)
        ? selected
        : [item];

    onSelect?.(dragging.map((entry) => entry.id));



    const grab = screenToWorld(view, event.clientX, event.clientY);

    runGesture(event.currentTarget, event.pointerId, (e) => {
      const world = screenToWorld(view, e.clientX, e.clientY);
      return moveTransforms(
        dragging,
        (world.x - grab.x) / WORLD_WIDTH,
        (world.y - grab.y) / WORLD_HEIGHT,
      );
    });
  };

  const startTransform = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !bounds || selected.length === 0) return;
    event.preventDefault();
    event.stopPropagation(); // don't let the move gesture underneath also start

    const pivot = centreOf(bounds);

    const pivotX = pivot.x * WORLD_WIDTH;
    const pivotY = pivot.y * WORLD_HEIGHT;

    const angleAt = (clientX: number, clientY: number) => {
      const w = screenToWorld(view, clientX, clientY);
      return (Math.atan2(w.y - pivotY, w.x - pivotX) * 180) / Math.PI;
    };
    const distanceAt = (clientX: number, clientY: number) => {
      const w = screenToWorld(view, clientX, clientY);
      return Math.hypot(w.x - pivotX, w.y - pivotY);
    };

    const startAngle = angleAt(event.clientX, event.clientY);

    const startDistance = Math.max(distanceAt(event.clientX, event.clientY), 1);
    const grabbed = selected;

    runGesture(event.currentTarget, event.pointerId, (e) =>
      scaleRotateTransforms(
        grabbed,
        pivot,
        e.altKey ? 1 : distanceAt(e.clientX, e.clientY) / startDistance,
        e.shiftKey ? 0 : angleAt(e.clientX, e.clientY) - startAngle,
      ),
    );
  };

  const topZ =
    Object.values(items).reduce((highest, item) => Math.max(highest, item.z), 0) +
    1;

  const single = selected.length === 1 ? selected[0] : null;

  return (
    <div className={`board-layer${readOnly ? " is-read-only" : ""}`}>
      {Object.values(items).map((item) => {
        const isSelected = !readOnly && selectedIds.has(item.id);

        return (
          <div
            key={item.id}
            className={`board-item is-${item.kind}${
              isSelected ? " is-selected" : ""
            }`}
            style={{
              left: item.x * WORLD_WIDTH,
              top: item.y * WORLD_HEIGHT,



              ...(item.kind === "text"
                ? { fontSize: item.size, color: item.color }
                : { width: item.size, height: itemHeight(item) }),


              zIndex: item.z,



              transform: itemTransformCss(item),
            }}
            title={
              readOnly
                ? undefined
                : `${item.name} — placed by ${item.placedByName || "someone"}`
            }
            onPointerDown={
              readOnly ? undefined : (event) => startMove(item, event)
            }
            onDoubleClick={readOnly ? undefined : () => onRemove?.([item.id])}
          >
            {item.kind === "text" ? (
              <span className="board-text">{item.text}</span>
            ) : (

              <img
                src={
                  item.kind === "emote"
                    ? emoteUrl(item.emoteId, 4)
                    : resolveImageSrc(item.src)
                }
                alt={item.name}
                draggable={false}
              />
            )}

            {isSelected && single && (
              <button
                type="button"
                className="item-handle"

                style={{
                  transform: `scale(${1 / view.zoom}) translate(50%, 50%)`,
                }}
                aria-label={`Rotate and resize ${item.name}`}
                title="Drag to resize and rotate — Shift for size only, Alt to rotate only.  +  /  −  resize in steps"
                onPointerDown={startTransform}

                onDoubleClick={(event) => event.stopPropagation()}
              />
            )}
          </div>
        );
      })}

      {bounds && selected.length > 1 && (
        <div
          className="selection-frame"
          style={{
            left: bounds.left,
            top: bounds.top,
            width: bounds.right - bounds.left,
            height: bounds.bottom - bounds.top,
            zIndex: topZ,
          }}
        >
          <button
            type="button"
            className="item-handle"
            style={{ transform: `scale(${1 / view.zoom}) translate(50%, 50%)` }}
            aria-label={`Rotate and resize ${selected.length} items`}
            title="Drag to resize and rotate — Shift for size only, Alt to rotate only.  +  /  −  resize in steps"
            onPointerDown={startTransform}
          />
        </div>
      )}

      {bounds && selected.length > 0 && (
        <div
          className="item-toolbar"
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            left: (bounds.left + bounds.right) / 2,
            top: (bounds.top + bounds.bottom) / 2,
            zIndex: topZ,
            transform: `scale(${1 / view.zoom}) translate(-50%, calc(-50% - ${
              ((bounds.bottom - bounds.top) / 2) * view.zoom + TOOLBAR_GAP
            }px))`,
          }}
        >
          {selected.length > 1 && (
            <span className="item-toolbar-count">{selected.length}</span>
          )}
          <button
            type="button"
            onClick={() => flip("x")}
            title="Flip horizontally  H"
          >
            Flip H
          </button>
          <button
            type="button"
            onClick={() => flip("y")}
            title="Flip vertically  V"
          >
            Flip V
          </button>
          <button
            type="button"
            onClick={() => onReorder?.([...selectedIds], "back")}
            title="Send to back  [  "
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => onReorder?.([...selectedIds], "front")}
            title="Bring to front  ]  "
          >
            Front
          </button>
          <button
            type="button"
            className="is-destructive"
            title={
              selected.length > 1
                ? `Delete these ${selected.length} items  Del`
                : "Delete  Del"
            }
            onClick={() => {
              onRemove?.(selected.map((item) => item.id));
              onSelect?.([]);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
