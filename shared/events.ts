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

export interface ClientToServerEvents {
  identify: (data: { username: string; color: string }) => void;

  cursor: (data: { x: number; y: number }) => void;

  "item:place": (data: {
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
  }) => void;


  "item:transform": (data: ItemTransform) => void;
  "items:transform": (data: ItemTransform[]) => void;
  "item:reorder": (data: { id: string; direction: ReorderDirection }) => void;
  "items:reorder": (data: {
    ids: string[];
    direction: ReorderDirection;
  }) => void;
  "item:remove": (id: string) => void;
  "items:remove": (ids: string[]) => void;

  undo: () => void;
  redo: () => void;
}

export interface ServerToClientEvents {
  cursor: (data: {
    id: string;
    x: number;
    y: number;
    username: string;
    color: string;
  }) => void;

  "user-left": (id: string) => void;
  "item:sync": (items: BoardItem[]) => void;
  "item:placed": (item: BoardItem) => void;
  "item:transformed": (data: ItemTransform) => void;
  "items:transformed": (data: ItemTransform[]) => void;
  "item:reordered": (data: { id: string; z: number }) => void;
  "items:reordered": (data: Array<{ id: string; z: number }>) => void;
  "item:removed": (id: string) => void;
  "items:removed": (ids: string[]) => void;
  "history:state": (data: { canUndo: boolean; canRedo: boolean }) => void;
}
