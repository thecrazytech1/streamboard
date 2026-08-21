import type { BoardItem, BoardItemKind, ItemTransform } from "@/types/board";
import {
  clamp,
  itemHeight,
  itemWidth,
  MAX_COORD,
  MIN_COORD,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./world";

export const MIN_SIZE = 24;
export const MAX_PICTURE_SIZE = 4 * WORLD_WIDTH;
export const MAX_TEXT_SIZE = WORLD_HEIGHT;

export const maxSizeFor = (kind: BoardItemKind): number =>
  kind === "text" ? MAX_TEXT_SIZE : MAX_PICTURE_SIZE;

export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export const normaliseRotation = (degrees: number): number =>
  ((degrees % 360) + 360) % 360;

export function itemBounds(item: BoardItem): Rect {
  const halfW = itemWidth(item) / 2;
  const halfH = itemHeight(item) / 2;
  const x = item.x * WORLD_WIDTH;
  const y = item.y * WORLD_HEIGHT;

  return {
    left: x - halfW,
    right: x + halfW,
    top: y - halfH,
    bottom: y + halfH,
  };
}

export function selectionBounds(items: readonly BoardItem[]): Rect | null {
  if (items.length === 0) return null;

  return items.reduce<Rect | null>((box, item) => {
    const bounds = itemBounds(item);
    if (!box) return bounds;
    return {
      left: Math.min(box.left, bounds.left),
      top: Math.min(box.top, bounds.top),
      right: Math.max(box.right, bounds.right),
      bottom: Math.max(box.bottom, bounds.bottom),
    };
  }, null);
}


export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left <= b.right &&
    a.right >= b.left &&
    a.top <= b.bottom &&
    a.bottom >= b.top
  );
}


export function centreOf(box: Rect): { x: number; y: number } {
  return {
    x: (box.left + box.right) / 2 / WORLD_WIDTH,
    y: (box.top + box.bottom) / 2 / WORLD_HEIGHT,
  };
}


const carry = (item: BoardItem) => ({
  id: item.id,
  size: item.size,
  aspect: item.aspect,
  rotation: item.rotation,
  flipX: item.flipX,
  flipY: item.flipY,
});

export function moveTransforms(
  items: readonly BoardItem[],
  dx: number,
  dy: number,
): ItemTransform[] {
  if (items.length === 0) return [];

  const xs = items.map((item) => item.x);
  const ys = items.map((item) => item.y);

  const clampedX = clamp(
    dx,
    MIN_COORD - Math.min(...xs),
    MAX_COORD - Math.max(...xs),
  );
  const clampedY = clamp(
    dy,
    MIN_COORD - Math.min(...ys),
    MAX_COORD - Math.max(...ys),
  );

  return items.map((item) => ({
    ...carry(item),
    x: item.x + clampedX,
    y: item.y + clampedY,
  }));
}

export function scaleRotateTransforms(
  items: readonly BoardItem[],
  pivot: { x: number; y: number },
  ratio: number,
  deltaDegrees: number,
): ItemTransform[] {
  const radians = (deltaDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const pivotX = pivot.x * WORLD_WIDTH;
  const pivotY = pivot.y * WORLD_HEIGHT;

  return items.map((item) => {

    const offsetX = item.x * WORLD_WIDTH - pivotX;
    const offsetY = item.y * WORLD_HEIGHT - pivotY;

    const x = pivotX + (offsetX * cos - offsetY * sin) * ratio;
    const y = pivotY + (offsetX * sin + offsetY * cos) * ratio;

    return {
      id: item.id,
      x: clamp(x / WORLD_WIDTH, MIN_COORD, MAX_COORD),
      y: clamp(y / WORLD_HEIGHT, MIN_COORD, MAX_COORD),
      size: clamp(item.size * ratio, MIN_SIZE, maxSizeFor(item.kind)),
      // Scaling is uniform, so the proportions ride along untouched.
      aspect: item.aspect,
      rotation: normaliseRotation(item.rotation + deltaDegrees),
      flipX: item.flipX,
      flipY: item.flipY,
    };
  });
}

export type FlipAxis = "x" | "y";

export function flipTransforms(
  items: readonly BoardItem[],
  axis: FlipAxis,
  pivot: { x: number; y: number },
): ItemTransform[] {
  return items.map((item) => ({
    id: item.id,
    x: axis === "x" ? 2 * pivot.x - item.x : item.x,
    y: axis === "y" ? 2 * pivot.y - item.y : item.y,
    size: item.size,
    aspect: item.aspect,
    rotation: normaliseRotation(-item.rotation),
    flipX: axis === "x" ? !item.flipX : item.flipX,
    flipY: axis === "y" ? !item.flipY : item.flipY,
  }));
}

export function itemTransformCss(item: {
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}): string {
  const scaleX = item.flipX ? -1 : 1;
  const scaleY = item.flipY ? -1 : 1;

  return (
    `translate(-50%, -50%) rotate(${item.rotation}deg)` +
    (scaleX === 1 && scaleY === 1 ? "" : ` scale(${scaleX}, ${scaleY})`)
  );
}

/**
 * Bounds on proportions, mirroring MIN/MAX_ASPECT on the server. A ratio beyond
 * these divides the height into something kilometres tall on every client.
 */
export const MIN_ASPECT = 0.05;
export const MAX_ASPECT = 20;

/**
 * Resizes one item to a given width and height in world pixels.
 *
 * Anchored on the item's centre, like scaling is: the position doesn't move, so
 * a resize can't walk an item across the board. Both dimensions are clamped in
 * their own right, and the aspect they imply is clamped again — which is what
 * stops a 5120-wide item 24 tall from becoming a hairline.
 *
 * Text has no business here: its box comes from the font, not from `aspect`.
 */
export function resizeTransform(
  item: BoardItem,
  width: number,
  height: number,
): ItemTransform {
  const limit = maxSizeFor(item.kind);
  const clampedWidth = clamp(width, MIN_SIZE, limit);
  const clampedHeight = clamp(height, MIN_SIZE, limit);

  return {
    ...carry(item),
    x: item.x,
    y: item.y,
    size: clampedWidth,
    aspect: clamp(clampedWidth / clampedHeight, MIN_ASPECT, MAX_ASPECT),
  };
}
