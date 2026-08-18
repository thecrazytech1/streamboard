export type BoardItemKind = "emote" | "text" | "image";

export type BoardItem = {

  id: string;
  kind: BoardItemKind;

  emoteId: string;

  text: string;
  src: string;
  aspect: number;

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
  size: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
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
  | { kind: "image"; src: string; aspect: number; name: string };
