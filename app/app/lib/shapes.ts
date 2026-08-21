/**
 * Shapes: the board's vector items, for pointing at things on stream and for
 * blocks of flat colour behind other items.
 *
 * Everything here is data only — the SVG itself is drawn by BoardShape, which
 * needs JSX. An item stores which shape it is, its colour, and whether it's
 * filled or an outline; nothing about a shape is free-form, so there's no
 * sanitising to do beyond checking the name is one of these.
 */

import type { BoardItem } from "@/types/board";

export type ShapeKind =
  | "rect"
  | "ellipse"
  | "triangle"
  | "arrow"
  | "line"
  | "star";

type ShapeSpec = {
  label: string;
  /**
   * Width ÷ height a freshly dropped one gets. Arrows and lines want to be wide
   * — you rotate them to point, rather than drawing them at an angle.
   */
  aspect: number;
  /** A stroke either way: filling a line means nothing. */
  strokeOnly?: boolean;
};

export const SHAPES: Record<ShapeKind, ShapeSpec> = {
  rect: { label: "Rectangle", aspect: 1.6 },
  ellipse: { label: "Ellipse", aspect: 1 },
  triangle: { label: "Triangle", aspect: 1 },
  arrow: { label: "Arrow", aspect: 3 },
  line: { label: "Line", aspect: 4, strokeOnly: true },
  star: { label: "Star", aspect: 1 },
};

export const SHAPE_KINDS = Object.keys(SHAPES) as ShapeKind[];

export const isShapeKind = (value: string): value is ShapeKind =>
  Object.prototype.hasOwnProperty.call(SHAPES, value);

/**
 * Proportions offered when adding one, since a placed shape can only be scaled
 * uniformly — the handle changes `size`, and `aspect` is fixed at drop time.
 */
export const ASPECT_PRESETS = [
  { label: "Wide", value: 16 / 9 },
  { label: "Square", value: 1 },
  { label: "Tall", value: 9 / 16 },
];

/**
 * How thick an outline or a line is, in world units, derived from the shape's
 * own dimensions rather than stored.
 *
 * World units matter: the whole board is CSS-scaled, so a stroke expressed here
 * scales with everything else and looks the same on a 1080p overlay as it does
 * zoomed in on the canvas. An SVG `non-scaling-stroke` would pin it to screen
 * pixels and break exactly that.
 */
export const strokeWidth = (width: number, height: number): number =>
  Math.max(2, Math.min(width, height) * 0.06);

/**
 * A stand-in board item, for drawing a shape that isn't placed yet — the tile in
 * the drawer and the ghost that follows the cursor. It never reaches the server;
 * BoardShape only reads `shape`, `color` and `outline`, and the rest is here to
 * satisfy the type.
 */
export function shapePreviewItem(fields: {
  shape: string;
  color: string;
  outline: boolean;
  aspect: number;
  size: number;
}): BoardItem {
  return {
    id: "",
    kind: "shape",
    emoteId: "",
    text: "",
    src: "",
    provider: "",
    embedId: "",
    muted: true,
    name: "",
    x: 0,
    y: 0,
    rotation: 0,
    flipX: false,
    flipY: false,
    z: 0,
    placedBy: "",
    placedByName: "",
    ...fields,
  };
}
