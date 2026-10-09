/**
 * Filter items: a region that alters whatever is painted beneath it.
 *
 * Implemented with CSS `backdrop-filter`, which is the whole story and also the
 * whole limitation. It filters the page's own backdrop — board items with a
 * lower stacking order, and the stream player behind the frame while editing.
 * It cannot reach anything OBS composites *under* the browser source, because
 * the page never sees those pixels. A camera that is an OBS source below the
 * overlay is unaffected; a camera embedded as a board item is not.
 */

export type FilterKind =
  | "grayscale"
  | "blur"
  | "sepia"
  | "invert"
  | "saturate"
  | "hue-rotate"
  | "brightness"
  | "contrast";

type FilterSpec = {
  label: string;
  /** What a freshly placed one uses, as a fraction of `max`. */
  strength: number;
  /** Turns 0..1 into the value the CSS function takes. */
  css: (strength: number) => string;
  hint: string;
};

export const FILTERS: Record<FilterKind, FilterSpec> = {
  grayscale: {
    label: "Grayscale",
    strength: 1,
    css: (s) => `grayscale(${s})`,
    hint: "Drains the colour out",
  },
  blur: {
    label: "Blur",
    strength: 0.4,
    // 20px at full strength: enough to hide a face, not so much that a light
    // touch does nothing.
    css: (s) => `blur(${(s * 20).toFixed(1)}px)`,
    hint: "Softens detail — censor bars, privacy",
  },
  sepia: {
    label: "Sepia",
    strength: 1,
    css: (s) => `sepia(${s})`,
    hint: "Old-film warmth",
  },
  invert: {
    label: "Invert",
    strength: 1,
    css: (s) => `invert(${s})`,
    hint: "Flips every colour",
  },
  saturate: {
    label: "Saturate",
    strength: 0.5,
    // 1 is unchanged, so this runs 1 → 4 and a light touch still does something.
    css: (s) => `saturate(${(1 + s * 3).toFixed(2)})`,
    hint: "Pushes colour harder",
  },
  "hue-rotate": {
    label: "Hue shift",
    strength: 0.5,
    css: (s) => `hue-rotate(${Math.round(s * 360)}deg)`,
    hint: "Spins the colour wheel",
  },
  brightness: {
    label: "Brighten",
    strength: 0.5,
    css: (s) => `brightness(${(1 + s).toFixed(2)})`,
    hint: "Lifts what's underneath",
  },
  contrast: {
    label: "Contrast",
    strength: 0.5,
    css: (s) => `contrast(${(1 + s * 2).toFixed(2)})`,
    hint: "Crushes the midtones",
  },
};

export const FILTER_KINDS = Object.keys(FILTERS) as FilterKind[];

export const isFilterKind = (value: string): value is FilterKind =>
  Object.prototype.hasOwnProperty.call(FILTERS, value);

/** The `backdrop-filter` value for an item, or null if it isn't one we know. */
export function filterCss(filter: string, strength: number): string | null {
  if (!isFilterKind(filter)) return null;
  const clamped = Math.min(1, Math.max(0, strength));
  return FILTERS[filter].css(clamped);
}

/**
 * The region a filter covers, as a clip-path. Reuses the shape vocabulary, but
 * only the shapes that enclose an area — a filter shaped like a line is nothing.
 */
export const FILTER_SHAPES = ["rect", "ellipse", "triangle", "star"] as const;
export type FilterShape = (typeof FILTER_SHAPES)[number];

export const isFilterShape = (value: string): value is FilterShape =>
  (FILTER_SHAPES as readonly string[]).includes(value);

/** Percentages, so one string works at any size the item is dragged to. */
const STAR_POINTS = (() => {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? 50 : 50 * 0.382;
    points.push(
      `${(50 + Math.cos(angle) * radius).toFixed(2)}% ${(
        50 + Math.sin(angle) * radius
      ).toFixed(2)}%`,
    );
  }
  return points.join(", ");
})();

export function filterClipPath(shape: string): string | undefined {
  switch (shape) {
    case "ellipse":
      return "ellipse(50% 50% at 50% 50%)";
    case "triangle":
      return "polygon(50% 0%, 100% 100%, 0% 100%)";
    case "star":
      return `polygon(${STAR_POINTS})`;
    default:
      // A rectangle needs no clipping, which is also the fallback for a shape
      // this build doesn't recognise.
      return undefined;
  }
}
