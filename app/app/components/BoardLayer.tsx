"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { socket } from "../../utils/socket";
import { emoteUrl } from "../lib/sevenTv";
import BoardShape from "./BoardShape";
import { embedUrl } from "../lib/embeds";
import { resolveImageSrc } from "../lib/images";
import {
  centreOf,
  type FlipAxis,
  flipTransforms,
  itemTransformCss,
  moveTransforms,
  resizeTransform,
  scaleRotateTransforms,
  selectionBounds,
} from "../lib/selection";
import {
  itemHeight,
  itemWidth,
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
  /** Opens the editor for a placed text item. Text items only. */
  onEditText?: (id: string) => void;
  /** Sound on or off for a placed embed. */
  onMute?: (id: string, muted: boolean) => void;
};


const TRANSFORM_THROTTLE_MS = 40;


const TOOLBAR_GAP = 24;


const SIZE_STEP = 1.1;

const FINE_SIZE_STEP = 1.02;

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/** The hostname Twitch wants as `parent`; it can't change without a reload. */
const subscribeNever = () => () => {};
const getHostname = () => window.location.hostname;
const getServerHostname = () => null;

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

/**
 * One embedded video.
 *
 * The url is built here from the item's provider and id rather than stored on
 * the item — see lib/embeds.ts for why that matters. An item whose pair doesn't
 * validate renders as a labelled box instead of an iframe, which is also what a
 * snapshot from a future version with a provider we don't know looks like.
 *
 * `interactive` is false on the overlay, where nothing is clickable anyway. On
 * the board the iframe takes no pointer events at all and a transparent shim
 * sits over it, so dragging the item doesn't turn into clicking the player —
 * the same trick .twitch-player uses for the frame behind the board.
 */
function BoardEmbed({
  item,
  interactive,
}: {
  item: BoardItem;
  interactive: boolean;
}) {
  // Twitch refuses to frame a player unless the parent matches the host asking,
  // and it isn't known while prerendering.
  const parent = useSyncExternalStore(
    subscribeNever,
    getHostname,
    getServerHostname,
  );

  const src = parent
    ? embedUrl(item.provider, item.embedId, parent, item.muted)
    : null;

  if (!src) {
    return (
      <span className="board-embed-missing">
        {item.name || "Embed unavailable"}
      </span>
    );
  }

  return (
    <div className="board-embed">
      <iframe
        src={src}
        title={item.name}
        // allow-same-origin is required, not a loosening: without it the frame
        // gets an opaque origin, and the player can't fetch its own scripts
        // (CORS fails) or reach its own storage. It grants nothing against us —
        // the frame is cross-origin either way, so the same-origin policy still
        // keeps it out of this page.
        //
        // What the sandbox still blocks is the part worth keeping: no
        // top-level navigation, so a hostile embed can't redirect the whole
        // board out from under the streamer, and no forms or downloads.
        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
        allow="autoplay; fullscreen; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />
      {interactive && <div className="board-embed-shim" />}
    </div>
  );
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
  onEditText,
  onMute,
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

      // F2 rather than Enter: Enter belongs to whatever is focused, and the
      // selection outliving a button press would make it fire twice.
      if (event.key === "F2" && ids.length === 1) {
        const only = items[ids[0]];
        if (only?.kind === "text" || only?.kind === "shape") {
          onEditText?.(only.id);
        }
      }



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
  }, [readOnly, selectedIds, items, onSelect, onReorder, onRemove, onEditText]);

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

  /**
   * Drags one edge of a single item, changing that axis alone.
   *
   * The pointer is converted into the item's *own* frame before being measured,
   * so the right edge of a rotated item still resizes along its own width
   * rather than along the screen's. Anchored on the centre, like scaling, so
   * the item never walks across the board while being resized.
   *
   * Single items only: on a group the two axes would need a shared box, and
   * every rotated member would shear inside it.
   */
  const startResize = (
    axis: "x" | "y",
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0 || !single) return;
    event.preventDefault();
    event.stopPropagation();

    const item = single;
    const centreX = item.x * WORLD_WIDTH;
    const centreY = item.y * WORLD_HEIGHT;

    // Rotating the offset by -rotation puts it in the item's frame.
    const radians = (item.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    runGesture(event.currentTarget, event.pointerId, (e) => {
      const world = screenToWorld(view, e.clientX, e.clientY);
      const dx = world.x - centreX;
      const dy = world.y - centreY;

      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;

      // Doubled because the centre is the anchor: the pointer only ever holds
      // one edge, which is half the item away from the middle. The other axis
      // keeps whatever it already had.
      return [
        resizeTransform(
          item,
          axis === "x" ? Math.abs(localX) * 2 : itemWidth(item),
          axis === "y" ? Math.abs(localY) * 2 : itemHeight(item),
        ),
      ];
    });
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
            ) : item.kind === "embed" ? (
              <BoardEmbed item={item} interactive={!readOnly} />
            ) : item.kind === "shape" ? (
              <BoardShape
                item={item}
                width={item.size}
                height={itemHeight(item)}
              />
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

            {/* One per axis, on the middle of the right and bottom edges.
                Inside the item's own element, so they rotate and flip with it
                and stay on the edge they name. */}
            {isSelected && single && item.kind !== "text" && (
              <>
                <button
                  type="button"
                  className="item-handle is-east"
                  style={{
                    transform: `scale(${1 / view.zoom}) translate(50%, -50%)`,
                  }}
                  aria-label={`Resize the width of ${item.name}`}
                  title="Drag to change width only"
                  onPointerDown={(event) => startResize("x", event)}
                  onDoubleClick={(event) => event.stopPropagation()}
                />
                <button
                  type="button"
                  className="item-handle is-south"
                  style={{
                    transform: `scale(${1 / view.zoom}) translate(-50%, 50%)`,
                  }}
                  aria-label={`Resize the height of ${item.name}`}
                  title="Drag to change height only"
                  onPointerDown={(event) => startResize("y", event)}
                  onDoubleClick={(event) => event.stopPropagation()}
                />
              </>
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
          {/* Only for a lone text item: there's nothing to reword about an
              emote, and editing several at once would mean one box per item. */}
          {/* Audio is the one thing about an embed worth reaching for often —
              and on the overlay it goes through OBS, so it matters. */}
          {single?.kind === "embed" && (
            <button
              type="button"
              onClick={() => onMute?.(single.id, !single.muted)}
              title={
                single.muted
                  ? "Let this play sound on the overlay"
                  : "Mute this on the overlay"
              }
            >
              {single.muted ? "Unmute" : "Mute"}
            </button>
          )}
          {(single?.kind === "text" || single?.kind === "shape") && (
            <button
              type="button"
              onClick={() => onEditText?.(single.id)}
              title={
                single.kind === "text"
                  ? "Edit this text  F2"
                  : "Recolour this shape  F2"
              }
            >
              Edit
            </button>
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
