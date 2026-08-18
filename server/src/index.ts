import "dotenv/config";

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import cors from "cors";
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  assertAuthConfig,
  authoriseForBoard,
  matchesKey,
  validateToken,
} from "./auth";
import {
  cleanImageSrc,
  initUploads,
  MAX_UPLOAD_BYTES,
  storeUpload,
  sweepOrphans,
  UPLOAD_DIR,
  UPLOAD_ROUTE,
} from "./uploads";

assertAuthConfig();
initUploads();

const app = express();

app.use(
  cors({
    origin: ["https://sb.chrissquartz.xyz/websocket"],
    credentials: true
  })
);

async function requireEditor(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Sign in with Twitch to upload images." });
    return;
  }

  const identity = await validateToken(token);
  if (!identity) {
    res.status(401).json({ error: "That Twitch session has expired." });
    return;
  }

  const requested = requestedBoardId(req.query.board);
  if (!requested) {
    res.status(400).json({ error: "That upload didn't say which board." });
    return;
  }

  const access = await authoriseForBoard(identity, token, requested);

  if (!access.ok) {
    res.status(403).json({
      error:
        access.reason === "scope"
          ? "Sign in with Twitch again — this board needs a new permission."
          : "Only this channel's broadcaster and moderators can upload.",
    });
    return;
  }

  next();
}

app.post(
  UPLOAD_ROUTE,
  requireEditor,




  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = storeUpload(body);

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.json({ src: result.src });
  },
);



app.use(
  UPLOAD_ROUTE,
  express.static(UPLOAD_DIR, {
    maxAge: "365d",
    immutable: true,
    index: false,
    dotfiles: "ignore",
    fallthrough: false,
  }),
);

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error);

  const status = (error as { status?: number })?.status ?? 500;
  const message =
    status === 413
      ? "That image is over 8 MB."
      : status === 404
        ? "That image is no longer on the server."
        : "Upload failed.";

  if (status >= 500) console.error("Request failed:", error);
  res.status(status).json({ error: message });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  path: "/websocket/socket.io",
  cors: {
    origin: ["https://sb.chrissquartz.xyz"],
    methods: ["GET", "POST"],
    credentials: true
  },
});

type Identity = { username: string; color: string };

type BoardItemKind = "emote" | "text" | "image";

type BoardItem = {
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


type ItemTransform = {
  id: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
};

const readIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.slice(0, MAX_ITEMS).map((id) => String(id ?? ""))
    : [];

const KINDS: readonly BoardItemKind[] = ["emote", "text", "image"];

const readKind = (value: unknown): BoardItemKind =>
  KINDS.includes(value as BoardItemKind) ? (value as BoardItemKind) : "emote";

const DEFAULT_IDENTITY: Identity = { username: "Guest", color: "#9146FF" };

type Board = {
  id: string;
  overlayKey: string;

  room: string;

  editorsRoom: string;

  items: Map<string, BoardItem>;
  layouts: Map<string, Layout>;

  identities: Map<string, Identity>;
  positions: Map<string, { x: number; y: number }>;
  histories: Map<string, History>;

  dirty: boolean;
  itemsPath: string;
  layoutsPath: string;
};

const boards = new Map<string, Board>();
const CHANNEL_ID_PATTERN = /^\d{1,20}$/;

const historyRoom = (board: Board, userId: string): string =>
  `${board.room}:user:${userId}`;

const MAX_ITEMS = 300;
const MIN_ITEM_SIZE = 24;

const MAX_PICTURE_SIZE = 5120;
const MAX_TEXT_SIZE = 720;
const MAX_TEXT_LENGTH = 100;

const maxSizeFor = (kind: BoardItemKind): number =>
  kind === "text" ? MAX_TEXT_SIZE : MAX_PICTURE_SIZE;

const EMOTE_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const HEX_COLOUR_PATTERN = /^#[0-9a-f]{6}$/i;

const STAGING_MARGIN = 2;
const MIN_COORD = -STAGING_MARGIN;
const MAX_COORD = 1 + STAGING_MARGIN;

const clampFraction = (value: unknown): number => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(MAX_COORD, Math.max(MIN_COORD, n));
};

const clampSize = (value: unknown, kind: BoardItemKind): number => {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.min(maxSizeFor(kind), Math.max(MIN_ITEM_SIZE, n))
    : 96;
};

const MIN_ASPECT = 0.05;
const MAX_ASPECT = 20;

const clampAspect = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, n));
};

const cleanText = (value: unknown): string =>
  String(value ?? "")

    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, MAX_TEXT_LENGTH)
    .trim();

const cleanColour = (value: unknown): string => {
  const c = String(value ?? "");
  return HEX_COLOUR_PATTERN.test(c) ? c : "#ffffff";
};


const normaliseRotation = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
};

const zRange = (board: Board): { min: number; max: number } => {
  let min = 0;
  let max = 0;
  let first = true;

  for (const item of board.items.values()) {
    if (first) {
      min = max = item.z;
      first = false;
      continue;
    }
    if (item.z < min) min = item.z;
    if (item.z > max) max = item.z;
  }

  return { min, max };
};

type UndoEntry =
  | { kind: "place"; at: number; ids: string[] }
  | { kind: "remove"; at: number; items: BoardItem[] }
  | { kind: "transform"; at: number; before: ItemTransform[] }
  | { kind: "reorder"; at: number; before: Array<{ id: string; z: number }> }
  | { kind: "restore"; at: number; items: BoardItem[] };

type History = { undo: UndoEntry[]; redo: UndoEntry[] };

const MAX_HISTORY = 50;

const COALESCE_MS = 1000;

const historyFor = (board: Board, userId: string): History => {
  const existing = board.histories.get(userId);
  if (existing) return existing;

  const fresh: History = { undo: [], redo: [] };
  board.histories.set(userId, fresh);
  return fresh;
};

const cloneItem = (item: BoardItem): BoardItem => ({ ...item });

function replaceBoard(board: Board, next: readonly BoardItem[]): BoardItem[] {
  const previous = [...board.items.values()].map(cloneItem);

  board.items.clear();
  for (const item of next) board.items.set(item.id, cloneItem(item));

  board.dirty = true;


  io.to(board.room).emit("item:sync", [...board.items.values()]);

  return previous;
}

const snapshotTransform = (item: BoardItem): ItemTransform => ({
  id: item.id,
  x: item.x,
  y: item.y,
  size: item.size,
  rotation: item.rotation,
  flipX: item.flipX,
  flipY: item.flipY,
});

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

function announceHistory(board: Board, userId: string): void {
  const { undo, redo } = historyFor(board, userId);

  io.to(historyRoom(board, userId)).emit("history:state", {
    canUndo: undo.length > 0,
    canRedo: redo.length > 0,
  });
}

function record(
  board: Board,
  userId: string | undefined,
  entry: UndoEntry,
): void {
  if (!userId) return;

  const history = historyFor(board, userId);
  history.redo.length = 0;

  const top = history.undo[history.undo.length - 1];

  if (
    entry.kind === "transform" &&
    top?.kind === "transform" &&
    entry.at - top.at < COALESCE_MS &&
    sameIds(
      top.before.map((t) => t.id),
      entry.before.map((t) => t.id),
    )
  ) {
    top.at = entry.at;
    announceHistory(board, userId);
    return;
  }

  history.undo.push(entry);
  if (history.undo.length > MAX_HISTORY) history.undo.shift();
  announceHistory(board, userId);
}

function invert(board: Board, entry: UndoEntry): UndoEntry | null {
  const at = Date.now();
  const items = board.items;

  if (entry.kind === "place") {
    const removed: BoardItem[] = [];
    for (const id of entry.ids) {
      const item = items.get(id);
      if (!item) continue;
      items.delete(id);
      removed.push(item);
    }
    if (!removed.length) return null;

    io.to(board.room).emit("items:removed", removed.map((item) => item.id));
    return { kind: "remove", at, items: removed };
  }

  if (entry.kind === "remove") {
    const ids: string[] = [];
    for (const item of entry.items) {
      if (items.has(item.id)) continue;



      if (items.size >= MAX_ITEMS) {
        const oldest = items.keys().next().value;
        if (oldest) {
          items.delete(oldest);
          io.to(board.room).emit("item:removed", oldest);
        }
      }

      items.set(item.id, item);
      ids.push(item.id);
      io.to(board.room).emit("item:placed", item);
    }
    if (!ids.length) return null;

    return { kind: "place", at, ids };
  }



  if (entry.kind === "restore") {
    return { kind: "restore", at, items: replaceBoard(board, entry.items) };
  }

  if (entry.kind === "transform") {
    const before: ItemTransform[] = [];
    const applied: ItemTransform[] = [];

    for (const target of entry.before) {
      const item = items.get(target.id);
      if (!item) continue;

      before.push(snapshotTransform(item));
      item.x = target.x;
      item.y = target.y;
      item.size = target.size;
      item.rotation = target.rotation;
      item.flipX = target.flipX;
      item.flipY = target.flipY;
      applied.push(snapshotTransform(item));
    }
    if (!applied.length) return null;

    io.to(board.room).emit("items:transformed", applied);
    return { kind: "transform", at, before };
  }

  const before: Array<{ id: string; z: number }> = [];
  const applied: Array<{ id: string; z: number }> = [];

  for (const target of entry.before) {
    const item = items.get(target.id);
    if (!item) continue;

    before.push({ id: item.id, z: item.z });
    item.z = target.z;
    applied.push({ id: item.id, z: item.z });
  }
  if (!applied.length) return null;

  io.to(board.room).emit("items:reordered", applied);
  return { kind: "reorder", at, before };
}


function step(board: Board, userId: string, from: "undo" | "redo"): void {
  const history = historyFor(board, userId);
  const source = history[from];
  const target = from === "undo" ? history.redo : history.undo;

  while (source.length) {
    const entry = source.pop();
    if (!entry) break;

    const inverse = invert(board, entry);
    if (inverse) {
      target.push(inverse);
      board.dirty = true;
      break;
    }
  }

  announceHistory(board, userId);
}

const BOARD_DIR = resolve(process.env.BOARD_DIR ?? "./boards");
const SNAPSHOT_INTERVAL_MS = 5000;

function readItem(row: unknown, fallbackZ: number): BoardItem | null {
  const raw = (row ?? null) as Record<string, unknown> | null;

  const id = typeof raw?.id === "string" ? raw.id : "";
  if (!id) return null;


  const kind = readKind(raw?.kind);
  const emoteId = typeof raw?.emoteId === "string" ? raw.emoteId : "";
  const text = cleanText(raw?.text);
  const src = cleanImageSrc(raw?.src);


  if (kind === "emote" && !EMOTE_ID_PATTERN.test(emoteId)) return null;
  if (kind === "text" && !text) return null;
  if (kind === "image" && !src) return null;

  const z = Number(raw?.z);

  return {
    id,
    kind,
    emoteId: kind === "emote" ? emoteId : "",
    text: kind === "text" ? text : "",
    src: kind === "image" ? src : "",
    aspect: kind === "image" ? clampAspect(raw?.aspect) : 1,
    color: cleanColour(raw?.color),
    name: String(raw?.name ?? "").slice(0, 64),
    x: clampFraction(raw?.x),
    y: clampFraction(raw?.y),
    size: clampSize(raw?.size, kind),

    rotation: normaliseRotation(raw?.rotation),
    flipX: raw?.flipX === true,
    flipY: raw?.flipY === true,


    z: Number.isFinite(z) ? z : fallbackZ,


    placedBy: "",
    placedByName: String(raw?.placedByName ?? "").slice(0, 64),
  };
}

function loadSnapshot(board: Board): void {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(board.itemsPath, "utf8"));
  } catch {
    return; // No snapshot yet, or unreadable — start with an empty board.
  }

  if (!Array.isArray(raw)) return;

  let fallbackZ = 0;

  for (const row of raw.slice(-MAX_ITEMS)) {
    const item = readItem(row, fallbackZ);
    if (!item) continue;

    board.items.set(item.id, item);
    fallbackZ += 1;
  }

  console.log(
    `Board ${board.id}: restored ${board.items.size} items from ${board.itemsPath}`,
  );
}

function writeJson(path: string, value: unknown): boolean {
  try {
    const temp = `${path}.tmp`;
    writeFileSync(temp, JSON.stringify(value));
    renameSync(temp, path);
    return true;
  } catch (error) {
    console.error(`Failed to write ${path}:`, error);
    return false;
  }
}

function flushSnapshot(board: Board): void {
  if (!board.dirty) return;
  board.dirty = false;



  if (!writeJson(board.itemsPath, [...board.items.values()])) {
    board.dirty = true;
  }
}


const flushAll = (): void => {
  for (const board of boards.values()) flushSnapshot(board);
};

setInterval(flushAll, SNAPSHOT_INTERVAL_MS).unref();

type Layout = {
  id: string;
  name: string;

  savedAt: number;
  savedByName: string;
  items: BoardItem[];
};

type LayoutSummary = Omit<Layout, "items"> & { itemCount: number };

const MAX_LAYOUTS = 20;
const MAX_LAYOUT_NAME = 40;

const cleanLayoutName = (value: unknown): string =>
  cleanText(value).slice(0, MAX_LAYOUT_NAME).trim();

const layoutSummaries = (board: Board): LayoutSummary[] =>
  [...board.layouts.values()]
    .sort((a, b) => b.savedAt - a.savedAt)
    .map(({ items: saved, ...rest }) => ({ ...rest, itemCount: saved.length }));

const announceLayouts = (board: Board): void => {
  io.to(board.editorsRoom).emit("layouts:state", layoutSummaries(board));
};

const layoutNamed = (board: Board, name: string): Layout | undefined =>
  [...board.layouts.values()].find(
    (layout) => layout.name.toLowerCase() === name.toLowerCase(),
  );

function loadLayouts(board: Board): void {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(board.layoutsPath, "utf8"));
  } catch {
    return; // None saved yet, or unreadable.
  }

  if (!Array.isArray(raw)) return;

  for (const row of raw.slice(0, MAX_LAYOUTS)) {
    const id = typeof row?.id === "string" ? row.id : "";
    const name = cleanLayoutName(row?.name);
    if (!id || !name) continue;

    const saved = Array.isArray(row?.items) ? row.items : [];
    const savedAt = Number(row?.savedAt);

    board.layouts.set(id, {
      id,
      name,
      savedAt: Number.isFinite(savedAt) ? savedAt : 0,
      savedByName: String(row?.savedByName ?? "").slice(0, 64),
      items: saved
        .slice(0, MAX_ITEMS)
        .map((item: unknown, index: number) => readItem(item, index))
        .filter((item: BoardItem | null) => item !== null),
    });
  }

  console.log(
    `Board ${board.id}: restored ${board.layouts.size} layouts from ${board.layoutsPath}`,
  );
}

const flushLayouts = (board: Board): void => {
  writeJson(board.layoutsPath, [...board.layouts.values()]);
};

function boardPaths(id: string): {
  items: string;
  layouts: string;
  config: string;
} {
  const directory = join(BOARD_DIR, id);
  mkdirSync(directory, { recursive: true });
  return {
    items: join(directory, "items.json"),
    layouts: join(directory, "layouts.json"),
    config: join(directory, "board.json"),
  };
}

const OVERLAY_KEY_BYTES = 24;

function overlayKeyFor(configPath: string): string {
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
      overlayKey?: unknown;
    };
    if (typeof raw.overlayKey === "string" && raw.overlayKey.length >= 16) {
      return raw.overlayKey;
    }
  } catch {

  }

  const overlayKey = randomBytes(OVERLAY_KEY_BYTES).toString("base64url");
  writeJson(configPath, { overlayKey });
  console.log(`Minted an overlay key in ${configPath}`);
  return overlayKey;
}

function openBoard(id: string): Board {
  const existing = boards.get(id);
  if (existing) return existing;

  const paths = boardPaths(id);
  const room = `board:${id}`;

  const board: Board = {
    id,
    overlayKey: overlayKeyFor(paths.config),
    room,
    editorsRoom: `${room}:editors`,
    items: new Map(),
    layouts: new Map(),
    identities: new Map(),
    positions: new Map(),
    histories: new Map(),
    dirty: false,
    itemsPath: paths.items,
    layoutsPath: paths.layouts,
  };

  boards.set(id, board);
  loadSnapshot(board);
  loadLayouts(board);

  return board;
}

function openExistingBoards(): void {
  mkdirSync(BOARD_DIR, { recursive: true });

  let names: string[];
  try {
    names = readdirSync(BOARD_DIR);
  } catch (error) {
    console.error(`Couldn't read ${BOARD_DIR}:`, error);
    return;
  }

  for (const name of names) {

    if (!CHANNEL_ID_PATTERN.test(name)) continue;
    openBoard(name);
  }

  console.log(`Opened ${boards.size} board(s) from ${BOARD_DIR}`);
}



openExistingBoards();


const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

const sweep = () => {
  const live = new Set<string>();

  for (const board of boards.values()) {
    for (const item of board.items.values()) live.add(item.src);
    for (const layout of board.layouts.values()) {
      for (const item of layout.items) live.add(item.src);
    }
  }

  sweepOrphans(live);
};

setInterval(sweep, SWEEP_INTERVAL_MS).unref();

sweep();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    flushAll();
    process.exit(0);
  });
}

function requestedBoardId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return CHANNEL_ID_PATTERN.test(value) ? value : null;
}

io.use(async (socket, next) => {
  const auth = socket.handshake.auth ?? {};

  const requested = requestedBoardId(auth.board);
  if (!requested) return next(new Error("unknown board"));



  if (auth.overlayKey !== undefined) {
    const board = boards.get(requested);
    if (!board || !matchesKey(board.overlayKey, auth.overlayKey)) {
      return next(new Error("unauthorised"));
    }

    socket.data.role = "overlay";
    socket.data.boardId = board.id;
    return next();
  }

  const token = typeof auth.token === "string" ? auth.token : "";
  if (!token) return next(new Error("unauthenticated"));

  const identity = await validateToken(token);
  if (!identity) return next(new Error("unauthenticated"));

  const access = await authoriseForBoard(identity, token, requested);

  if (!access.ok) {
    console.log(
      `refused ${identity.login} (${identity.userId}) on board ${requested}: ${access.reason}`,
    );

    return next(new Error(access.reason));
  }

  const board = openBoard(requested);

  socket.data.role = "editor";
  socket.data.boardId = board.id;
  socket.data.userId = identity.userId;
  socket.data.login = identity.login;
  console.log(
    `${identity.login} (${identity.userId}) allowed on board ${board.id} as ${access.via}`,
  );
  return next();
});

io.on("connection", (socket) => {
  const role = socket.data.role as "editor" | "overlay";


  const board = boards.get(socket.data.boardId as string);
  if (!board) return socket.disconnect(true);

  socket.join(board.room);



  const items = board.items;

  console.log(
    `${socket.id} connected to board ${board.id} as ${role}${role === "editor" ? ` (${socket.data.login})` : ""
    }`,
  );

  socket.emit("item:sync", [...items.values()]);

  if (role !== "editor") return;

  const userId = socket.data.userId as string;
  socket.join(historyRoom(board, userId));
  announceHistory(board, userId);

  socket.join(board.editorsRoom);
  socket.emit("layouts:state", layoutSummaries(board));

  socket.emit("overlay:key", { key: board.overlayKey });

  socket.on("identify", (data: Partial<Identity>) => {
    board.identities.set(socket.id, {
      username: data?.username || DEFAULT_IDENTITY.username,
      color: data?.color || DEFAULT_IDENTITY.color,
    });

    const last = board.positions.get(socket.id);
    if (last) {
      socket.to(board.room).emit("cursor", {
        id: socket.id,
        ...last,
        ...board.identities.get(socket.id)!,
      });
    }
  });

  socket.on("cursor", (data) => {
    board.positions.set(socket.id, { x: data.x, y: data.y });

    socket.to(board.room).emit("cursor", {
      id: socket.id,
      x: data.x,
      y: data.y,
      ...(board.identities.get(socket.id) ?? DEFAULT_IDENTITY),
    });
  });

  socket.on("item:place", (data) => {
    const kind = readKind(data?.kind);
    const emoteId = String(data?.emoteId ?? "");
    const text = cleanText(data?.text);
    const src = cleanImageSrc(data?.src);

    if (kind === "emote" && !EMOTE_ID_PATTERN.test(emoteId)) return;
    if (kind === "text" && !text) return;
    if (kind === "image" && !src) return;

    if (items.size >= MAX_ITEMS) {
      const oldest = items.keys().next().value;
      if (oldest) {
        items.delete(oldest);
        io.to(board.room).emit("item:removed", oldest);
      }
    }

    const identity = board.identities.get(socket.id) ?? DEFAULT_IDENTITY;

    const placed: BoardItem = {
      id: randomUUID(),
      kind,
      emoteId: kind === "emote" ? emoteId : "",
      text: kind === "text" ? text : "",
      src: kind === "image" ? src : "",
      aspect: kind === "image" ? clampAspect(data?.aspect) : 1,
      color: cleanColour(data?.color),
      name: (kind === "text" ? text : String(data?.name ?? "")).slice(0, 64),
      x: clampFraction(data?.x),
      y: clampFraction(data?.y),
      size: clampSize(data?.size, kind),
      rotation: 0,
      flipX: false,
      flipY: false,

      z: items.size === 0 ? 0 : zRange(board).max + 1,
      placedBy: socket.id,
      placedByName: identity.username,
    };

    items.set(placed.id, placed);
    board.dirty = true;
    record(board, userId, { kind: "place", at: Date.now(), ids: [placed.id] });
    io.to(board.room).emit("item:placed", placed);
  });

  const applyTransform = (
    data: unknown,
  ): { before: ItemTransform; after: ItemTransform } | null => {
    const raw = data as Record<string, unknown> | null;
    const item = items.get(String(raw?.id ?? ""));
    if (!item) return null;

    const before = snapshotTransform(item);

    item.x = clampFraction(raw?.x);
    item.y = clampFraction(raw?.y);

    item.size = clampSize(raw?.size, item.kind);
    item.rotation = normaliseRotation(raw?.rotation);
    item.flipX = raw?.flipX === true;
    item.flipY = raw?.flipY === true;

    board.dirty = true;

    return { before, after: snapshotTransform(item) };
  };

  socket.on("item:transform", (data) => {
    const applied = applyTransform(data);
    if (!applied) return;

    record(board, userId, {
      kind: "transform",
      at: Date.now(),
      before: [applied.before],
    });

    socket.to(board.room).emit("item:transformed", applied.after);
  });

  socket.on("items:transform", (data) => {
    if (!Array.isArray(data)) return;

    const applied = data
      .slice(0, MAX_ITEMS)
      .map(applyTransform)
      .filter((entry) => entry !== null);

    if (!applied.length) return;

    record(board, userId, {
      kind: "transform",
      at: Date.now(),
      before: applied.map((entry) => entry.before),
    });
    socket.to(board.room).emit(
      "items:transformed",
      applied.map((entry) => entry.after),
    );
  });

  socket.on("item:reorder", (data) => {
    const item = items.get(String(data?.id ?? ""));
    if (!item) return;

    if (items.size <= 1) return;

    const { min, max } = zRange(board);
    const previous = { id: item.id, z: item.z };


    if (data?.direction === "back") {
      if (item.z === min && item.z !== max) return;
      item.z = min - 1;
    } else {
      if (item.z === max && item.z !== min) return;
      item.z = max + 1;
    }

    board.dirty = true;
    record(board, userId, { kind: "reorder", at: Date.now(), before: [previous] });

    io.to(board.room).emit("item:reordered", { id: item.id, z: item.z });
  });

  socket.on("items:reorder", (data) => {
    if (items.size <= 1) return;

    const chosen = readIds(data?.ids)
      .map((id) => items.get(id))
      .filter((item): item is BoardItem => item !== undefined);

    if (!chosen.length) return;




    chosen.sort((a, b) => a.z - b.z);

    const previous = chosen.map((item) => ({ id: item.id, z: item.z }));
    const { min, max } = zRange(board);
    const updates = chosen.map((item, index) => {
      item.z =
        data.direction === "back"
          ? min - chosen.length + index
          : max + 1 + index;
      return { id: item.id, z: item.z };
    });

    board.dirty = true;
    record(board, userId, { kind: "reorder", at: Date.now(), before: previous });
    io.to(board.room).emit("items:reordered", updates);
  });

  socket.on("item:remove", (id) => {


    const item = items.get(String(id ?? ""));
    if (!item) return;

    items.delete(item.id);
    board.dirty = true;
    record(board, userId, { kind: "remove", at: Date.now(), items: [item] });
    io.to(board.room).emit("item:removed", item.id);
  });

  socket.on("items:remove", (ids) => {
    const removed = readIds(ids)
      .map((id) => items.get(id))
      .filter((item) => item !== undefined);

    if (!removed.length) return;

    for (const item of removed) items.delete(item.id);
    board.dirty = true;
    record(board, userId, { kind: "remove", at: Date.now(), items: removed });
    io.to(board.room).emit(
      "items:removed",
      removed.map((item) => item.id),
    );
  });

  socket.on("layout:save", (data) => {
    const name = cleanLayoutName(data?.name);
    if (!name) {
      socket.emit("layout:error", "Give the layout a name.");
      return;
    }

    const existing = layoutNamed(board, name);
    if (!existing && board.layouts.size >= MAX_LAYOUTS) {
      socket.emit(
        "layout:error",
        `All ${MAX_LAYOUTS} layout slots are full — delete one first.`,
      );
      return;
    }

    const identity = board.identities.get(socket.id) ?? DEFAULT_IDENTITY;


    const id = existing?.id ?? randomUUID();

    board.layouts.set(id, {
      id,
      name,
      savedAt: Date.now(),
      savedByName: identity.username,

      items: [...items.values()].map(cloneItem),
    });

    flushLayouts(board);
    announceLayouts(board);
  });

  socket.on("layout:load", (data) => {
    const layout = board.layouts.get(String(data?.id ?? ""));
    if (!layout) return;



    record(board, userId, {
      kind: "restore",
      at: Date.now(),
      items: replaceBoard(board, layout.items),
    });
  });

  socket.on("layout:delete", (data) => {
    if (!board.layouts.delete(String(data?.id ?? ""))) return;

    flushLayouts(board);
    announceLayouts(board);
  });

  socket.on("undo", () => step(board, userId, "undo"));
  socket.on("redo", () => step(board, userId, "redo"));

  socket.on("disconnect", () => {
    board.identities.delete(socket.id);
    board.positions.delete(socket.id);
    io.to(board.room).emit("user-left", socket.id);
  });
});

httpServer.listen(3001, () => {
  console.log("Server running on port 3001");
});