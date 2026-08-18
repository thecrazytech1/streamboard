export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;

export const STAGING_MARGIN = 2;
export const MIN_COORD = -STAGING_MARGIN;
export const MAX_COORD = 1 + STAGING_MARGIN;

export type View = {

  x: number;
  y: number;
  zoom: number;
};

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));


export function screenToWorld(
  view: View,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: (screenX - view.x) / view.zoom,
    y: (screenY - view.y) / view.zoom,
  };
}


export function screenToFraction(
  view: View,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  const world = screenToWorld(view, screenX, screenY);
  return {
    x: clamp(world.x / WORLD_WIDTH, MIN_COORD, MAX_COORD),
    y: clamp(world.y / WORLD_HEIGHT, MIN_COORD, MAX_COORD),
  };
}


const TEXT_WIDTH_RATIO = 0.6;

type Sized = {
  kind?: string;

  size: number;
  text?: string;

  aspect?: number;
};

export function itemWidth(item: Sized): number {
  if (item.kind === "text") {
    return (item.text?.length ?? 0) * item.size * TEXT_WIDTH_RATIO;
  }
  return item.size;
}

export function itemHeight(item: Sized): number {
  if (item.kind === "image") {
    const aspect = item.aspect && item.aspect > 0 ? item.aspect : 1;
    return item.size / aspect;
  }
  return item.size;
}

export function isOnStream(
  item: Sized & { x: number; y: number },
): boolean {
  const halfW = itemWidth(item) / 2 / WORLD_WIDTH;
  const halfH = itemHeight(item) / 2 / WORLD_HEIGHT;

  return (
    item.x + halfW > 0 &&
    item.x - halfW < 1 &&
    item.y + halfH > 0 &&
    item.y - halfH < 1
  );
}

export function fitView(
  viewportWidth: number,
  viewportHeight: number,
  padding = 0.72,
): View {
  const zoom = clamp(
    Math.min(viewportWidth / WORLD_WIDTH, viewportHeight / WORLD_HEIGHT) *
    padding,
    MIN_ZOOM,
    MAX_ZOOM,
  );

  return {
    zoom,
    x: (viewportWidth - WORLD_WIDTH * zoom) / 2,
    y: (viewportHeight - WORLD_HEIGHT * zoom) / 2,
  };
}
