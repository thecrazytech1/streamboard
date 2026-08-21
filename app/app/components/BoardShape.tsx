"use client";

import { isShapeKind, strokeWidth } from "../lib/shapes";
import type { BoardItem } from "@/types/board";

/**
 * A shape item, as inline SVG.
 *
 * The viewBox is the item's own world dimensions, so every coordinate below —
 * including the stroke width — is in world units and scales with the board.
 * That's what makes an outline look the same on a 1080p overlay as it does
 * zoomed right in on the canvas.
 *
 * `preserveAspectRatio="none"` is deliberate: the box already has the item's
 * proportions from `aspect`, so the drawing should fill it rather than
 * letterbox inside it.
 */
export default function BoardShape({
  item,
  width,
  height,
}: {
  item: BoardItem;
  width: number;
  height: number;
}) {
  if (!isShapeKind(item.shape)) return null;

  const stroke = strokeWidth(width, height);
  const inset = stroke / 2;

  // Filled shapes paint to the edge; an outline has to sit half a stroke inside
  // it, or half the line falls outside the item's own box.
  const outlined = item.outline;
  const paint = outlined
    ? { fill: "none", stroke: item.color, strokeWidth: stroke }
    : { fill: item.color };

  const w = width;
  const h = height;
  const edge = outlined ? inset : 0;

  return (
    <svg
      className="board-shape"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {item.shape === "rect" && (
        <rect
          x={edge}
          y={edge}
          width={Math.max(0, w - edge * 2)}
          height={Math.max(0, h - edge * 2)}
          {...paint}
        />
      )}

      {item.shape === "ellipse" && (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(0, w / 2 - edge)}
          ry={Math.max(0, h / 2 - edge)}
          {...paint}
        />
      )}

      {item.shape === "triangle" && (
        <polygon
          points={`${w / 2},${edge} ${w - edge},${h - edge} ${edge},${h - edge}`}
          strokeLinejoin="round"
          {...paint}
        />
      )}

      {/* Shaft plus head as one polygon, so a filled arrow has no seam and an
          outlined one traces the whole silhouette rather than two pieces. */}
      {item.shape === "arrow" &&
        (() => {
          const head = Math.min(h * 0.9, w * 0.45);
          const shaft = h * 0.28;
          const midY = h / 2;
          const tail = edge;
          const neck = Math.max(tail, w - head);

          return (
            <polygon
              points={[
                `${tail},${midY - shaft}`,
                `${neck},${midY - shaft}`,
                `${neck},${edge}`,
                `${w - edge},${midY}`,
                `${neck},${h - edge}`,
                `${neck},${midY + shaft}`,
                `${tail},${midY + shaft}`,
              ].join(" ")}
              strokeLinejoin="round"
              {...paint}
            />
          );
        })()}

      {/* Always a stroke: a filled line is nothing. Rotate the item to angle it. */}
      {item.shape === "line" && (
        <line
          x1={inset}
          y1={h / 2}
          x2={w - inset}
          y2={h / 2}
          stroke={item.color}
          strokeWidth={stroke * 2}
          strokeLinecap="round"
        />
      )}

      {item.shape === "star" && (
        <polygon points={starPoints(w, h, edge)} strokeLinejoin="round" {...paint} />
      )}
    </svg>
  );
}

/** A five-pointed star inscribed in the box, points up. */
function starPoints(width: number, height: number, inset: number): string {
  const cx = width / 2;
  const cy = height / 2;
  const outerX = cx - inset;
  const outerY = cy - inset;
  // 0.382 is the ratio that gives a five-pointed star its usual proportions.
  const innerRatio = 0.382;

  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    // Start at the top and alternate outer and inner vertices.
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const scale = i % 2 === 0 ? 1 : innerRatio;
    points.push(
      `${cx + Math.cos(angle) * outerX * scale},${
        cy + Math.sin(angle) * outerY * scale
      }`,
    );
  }
  return points.join(" ");
}
