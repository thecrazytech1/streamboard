export type BoardItemKind = "emote" | "text" | "image" | "embed" | "shape";

export type BoardItem = {

  id: string;
  kind: BoardItemKind;

  emoteId: string;

  text: string;
  src: string;
  aspect: number;

  /**
   * Embedded video: `provider` picks a url template in lib/embeds.ts and
   * `embedId` fills it. The item never carries a url, so nothing a client sends
   * can put an arbitrary page in an iframe. Empty for every other kind.
   */
  provider: string;
  embedId: string;
  /** Whether the embed plays sound on the overlay. */
  muted: boolean;

  /**
   * Which shape this is, from the fixed set in lib/shapes.ts. Empty for other
   * kinds — colour lives in `color` and proportions in `aspect`.
   */
  shape: string;
  /** Outline rather than filled. Ignored by shapes that are only a stroke. */
  outline: boolean;

  color: string;

  name: string;
  x: number;
  y: number;

  size: number;

  rotation: number;
  flipX: boolean;
  flipY: boolean;

  z: number;
  placedBy: string;
  placedByName: string;
};


export type ItemTransform = {
  id: string;
  x: number;
  y: number;
  /** Width in world pixels, or font size for text. */
  size: number;
  /**
   * Width ÷ height. Part of the transform because resizing one axis changes it
   * — a gesture, not a property of what the item is.
   */
  aspect: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
};

/**
 * What editing a placed text item can change. Narrow on purpose: an emote's id
 * and an image's src are what the item is, not how it reads.
 */
export type TextEdit = {
  id: string;
  text: string;
  color: string;
};

export type ReorderDirection = "front" | "back";

export type BoardLayout = {
  id: string;
  name: string;

  savedAt: number;
  savedByName: string;
  itemCount: number;
};


export type DraggableItem =
  | { kind: "emote"; emoteId: string; name: string }
  | { kind: "text"; text: string; color: string }
  | { kind: "image"; src: string; aspect: number; name: string }
  | {
      kind: "shape";
      shape: string;
      color: string;
      aspect: number;
      outline: boolean;
      name: string;
    }
  | {
      kind: "embed";
      provider: string;
      embedId: string;
      aspect: number;
      name: string;
    };
