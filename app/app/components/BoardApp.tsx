"use client";
import { useCallback, useEffect, useState } from "react";
import { socket } from "../../utils/socket";
import { useBoardAccess } from "../hooks/useBoardAccess";
import AccessGate from "./AccessGate";
import Cursor from "./Cursor";
import {
  WaButton,
  WaDialog,
  WaDrawer,
  WaSpinner,
} from "@awesome.me/webawesome/dist/react";
import BoardLayer from "./BoardLayer";
import BoardShape from "./BoardShape";
import EmotePicker from "./EmotePicker";
import LayoutManager from "./LayoutManager";
import Navbar from "./Navbar";
import EditorManager from "./EditorManager";
import OverlaySetup from "./OverlaySetup";
import TextEditor from "./TextEditor";
import TwitchPlayer from "./TwitchPlayer";
import { useCanvasView } from "../hooks/useCanvasView";
import { useBoardItems } from "../hooks/useBoardItems";
import { useBoardHistory } from "../hooks/useBoardHistory";
import { useBoardLayouts } from "../hooks/useBoardLayouts";
import { useBoardEditors } from "../hooks/useBoardEditors";
import { useOverlayLink } from "../hooks/useOverlayLink";
import { usePasteToBoard } from "../hooks/usePasteToBoard";
import { emoteUrl } from "../lib/sevenTv";
import { resolveImageSrc } from "../lib/images";
import { itemBounds, overlaps, type Rect } from "../lib/selection";
import { shapePreviewItem } from "../lib/shapes";
import { CLIENT_ID, type TwitchChannel } from "../lib/twitch";
import {
  screenToWorld,
  screenToFraction,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../lib/world";
import type { DraggableItem, ReorderDirection } from "@/types/board";

type RemoteCursor = {
  id: string;
  x: number;
  y: number;
  username: string;
  color: string;
};

interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
  email?: string;
  color?: string;
}


const EMOTE_SIZE = 96;

const TEXT_SIZE = 64;
const IMAGE_SIZE = 220;


/**
 * Width in world pixels for a freshly dropped embed. Wide enough to actually
 * watch — three eighths of the frame — since a stream shrunk to emote size is
 * just a smear.
 */
const EMBED_SIZE = 480;

/** Width in world pixels for a freshly dropped shape. */
const SHAPE_SIZE = 260;

const dropSize = (item: DraggableItem): number => {
  if (item.kind === "text") return TEXT_SIZE;
  if (item.kind === "embed") return EMBED_SIZE;
  if (item.kind === "shape") return SHAPE_SIZE;
  return item.kind === "image" ? IMAGE_SIZE : EMOTE_SIZE;
};

type Props = {
  channel: TwitchChannel;
  board: string;
  
  token: string | null;
  onLogout: () => void;
};

export default function BoardApp({ channel, board, token, onLogout }: Props) {
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({});
  const [user, setUser] = useState<TwitchUser | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState(false);

  const { items: boardItems, applyTransforms } = useBoardItems();


  const history = useBoardHistory();


  const layouts = useBoardLayouts();
  const { view, containerRef, startPan, zoomBy, reset } = useCanvasView();

  const access = useBoardAccess({ kind: "editor", token, board });
  
  const [carried, setCarried] = useState<DraggableItem | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [pickerRevision, setPickerRevision] = useState(0);
  
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [editorsOpen, setEditorsOpen] = useState(false);
  /** The board's own editor list, plus how this client got in. */
  const editors = useBoardEditors();
  /** Which text item the editor is open on, by id. */
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const overlayLink = useOverlayLink(board);

  const openDrawer = () => {
    setPickerRevision((revision) => revision + 1);
    setIsOpen(true);
  };


  useEffect(() => {
    if (!token) return;

    const fetchUserData = async () => {
      setLoading(true);
      try {
        const response = await fetch("https://api.twitch.tv/helix/users", {
          headers: {
            "Client-ID": CLIENT_ID,
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const userResult = await response.json();
          if (!userResult.data || userResult.data.length === 0) return;

          const profileData = userResult.data[0];

          const colorResponse = await fetch(
            `https://api.twitch.tv/helix/chat/color?user_id=${profileData.id}`,
            {
              headers: {
                "Client-ID": CLIENT_ID,
                Authorization: `Bearer ${token}`,
              },
            },
          );

          let chatColor = "#9146FF"; // Fallback to Twitch Purple if request fails or color is empty

          if (colorResponse.ok) {
            const colorResult = await colorResponse.json();
            if (
              colorResult.data &&
              colorResult.data.length > 0 &&
              colorResult.data[0].color
            ) {
              chatColor = colorResult.data[0].color;
            }
          }


          setUser({
            ...profileData,
            color: chatColor,
          });
        } else if (response.status === 401) {

          onLogout();
        }
      } catch (error) {
        console.error("Failed to fetch Twitch user data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [token, onLogout]);

  const handleLogout = () => {
    setUser(null);
    onLogout();
  };

  useEffect(() => {
    const identify = () => {
      socket.emit("identify", {
        username: user ? user.display_name : "Guest",
        color: user?.color || "#9146FF",
      });
    };

    identify();
    socket.on("connect", identify);

    return () => {
      socket.off("connect", identify);
    };
  }, [user]);

  /**
   * A refusal the server chose to explain — placing a fifth embed, so far.
   * Shown in the same pill a paste uses, since it's the same kind of report on
   * something that just happened.
   */
  const [itemError, setItemError] = useState<string | null>(null);

  useEffect(() => {
    const onItemError = (message: string) => setItemError(String(message));

    socket.on("item:error", onItemError);
    return () => {
      socket.off("item:error", onItemError);
    };
  }, []);

  useEffect(() => {
    if (!itemError) return;

    const timer = setTimeout(() => setItemError(null), 6000);
    return () => clearTimeout(timer);
  }, [itemError]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      socket.emit("cursor", {
        x: e.clientX,
        y: e.clientY,
      });
    };

    window.addEventListener("pointermove", handleMove);

    return () => {
      window.removeEventListener("pointermove", handleMove);
    };
  }, []);

  const placeItem = useCallback(
    (item: DraggableItem, clientX: number, clientY: number) => {


      const { x, y } = screenToFraction(view, clientX, clientY);

      socket.emit("item:place", {
        kind: item.kind,
        emoteId: item.kind === "emote" ? item.emoteId : "",
        text: item.kind === "text" ? item.text : "",
        src: item.kind === "image" ? item.src : "",
        aspect:
          item.kind === "image" ||
          item.kind === "embed" ||
          item.kind === "shape"
            ? item.aspect
            : 1,
        provider: item.kind === "embed" ? item.provider : "",
        embedId: item.kind === "embed" ? item.embedId : "",
        // Silent on arrival. Unmuting is a deliberate act, done once it's placed.
        muted: true,
        color:
          item.kind === "text" || item.kind === "shape"
            ? item.color
            : "#ffffff",
        shape: item.kind === "shape" ? item.shape : "",
        outline: item.kind === "shape" ? item.outline : false,
        name: item.kind === "text" ? item.text : item.name,
        x,
        y,
        size: dropSize(item),
      });
    },
    [view],
  );

  
  const pasteStatus = usePasteToBoard({ token, board, onPlace: placeItem });

  const handlePickUp = (item: DraggableItem, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();

    setIsOpen(false);
    setCarried(item);
    setGhost({ x: event.clientX, y: event.clientY });
  };

  useEffect(() => {
    if (!carried) return;

    const onMove = (e: PointerEvent) => setGhost({ x: e.clientX, y: e.clientY });

    const onUp = (e: PointerEvent) => {
      placeItem(carried, e.clientX, e.clientY);
      setCarried(null);
      setGhost(null);
    };

    const onCancel = () => {
      setCarried(null);
      setGhost(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown);
    };




  }, [carried, placeItem]);

  const handleSelect = useCallback(
    (ids: string[]) => setSelectedIds(new Set(ids)),
    [],
  );



  const handleReorderItems = useCallback(
    (ids: string[], direction: ReorderDirection) => {
      if (ids.length === 0) return;
      if (ids.length === 1) socket.emit("item:reorder", { id: ids[0], direction });
      else socket.emit("items:reorder", { ids, direction });
    },
    [],
  );

  /**
   * No optimistic update: the draft lived in the dialog, so there's nothing on
   * the board to keep in step until the server's echo arrives — and it also
   * clamps and cleans the text, so its version is the one to render.
   */
  const handleSaveText = useCallback(
    (id: string, text: string, color: string) => {
      socket.emit("item:edit", { id, text, color });
    },
    [],
  );

  const handleMute = useCallback((id: string, muted: boolean) => {
    socket.emit("item:mute", { id, muted });
  }, []);

  const handleRemoveItems = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    if (ids.length === 1) socket.emit("item:remove", ids[0]);
    else socket.emit("items:remove", ids);
  }, []);

  const handleClearBoard = useCallback(() => {
    setConfirmingClear(false);
    handleRemoveItems(Object.keys(boardItems));
    setSelectedIds(new Set());
  }, [boardItems, handleRemoveItems]);

  const startMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);

    const originX = event.clientX;
    const originY = event.clientY;

    const base = new Set(selectedIds);

    const boxAt = (e: PointerEvent): Rect => ({
      left: Math.min(originX, e.clientX),
      right: Math.max(originX, e.clientX),
      top: Math.min(originY, e.clientY),
      bottom: Math.max(originY, e.clientY),
    });

    const onMove = (e: PointerEvent) => {
      const box = boxAt(e);
      setMarquee(box);



      const topLeft = screenToWorld(view, box.left, box.top);
      const bottomRight = screenToWorld(view, box.right, box.bottom);
      const world: Rect = {
        left: topLeft.x,
        top: topLeft.y,
        right: bottomRight.x,
        bottom: bottomRight.y,
      };

      const caught = Object.values(boardItems)
        .filter((item) => overlaps(itemBounds(item), world))
        .map((item) => item.id);

      setSelectedIds(new Set([...base, ...caught]));
    };

    const onEnd = () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onEnd);
      element.removeEventListener("pointercancel", onEnd);
      setMarquee(null);
    };

    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onEnd);
    element.addEventListener("pointercancel", onEnd);
  };

  const handleCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 0 && event.shiftKey) {
      event.preventDefault();
      startMarquee(event);
      return;
    }
    startPan(event);
  };



  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "a" || !(event.ctrlKey || event.metaKey)) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, wa-input")) return;

      event.preventDefault();
      setSelectedIds(new Set(Object.keys(boardItems)));
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [boardItems]);





  useEffect(() => {
    if (selectedIds.size === 0) return;

    const onPointerDown = (event: PointerEvent) => {


      if (event.shiftKey) return;

      const target = event.target as HTMLElement | null;


      if (
        !target?.closest(".board-item, .item-toolbar, .selection-frame")
      ) {
        setSelectedIds(new Set());
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [selectedIds]);

  useEffect(() => {
    const onCursor = (cursor: RemoteCursor) => {
      setCursors((prev) => ({
        ...prev,
        [cursor.id]: cursor,
      }));
    };

    const onUserLeft = (id: string) => {
      setCursors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    };

    socket.on("cursor", onCursor);
    socket.on("user-left", onUserLeft);

    return () => {
      socket.off("cursor", onCursor);
      socket.off("user-left", onUserLeft);
    };
  }, []);

  if (access.status !== "allowed") {
    return (
      <div className="app-shell">
        <AccessGate
          access={access}
          channelName={channel.name}
          onLogout={handleLogout}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Navbar
        user={user}
        loading={loading}
        onLogout={handleLogout}
        onZoomIn={() => zoomBy(1.25)}
        onZoomOut={() => zoomBy(1 / 1.25)}
        onResetView={reset}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
        canClear={Object.keys(boardItems).length > 0}
        onClear={() => setConfirmingClear(true)}
        onOpenLayouts={() => setLayoutsOpen(true)}
        layoutCount={layouts.layouts.length}
        onOpenOverlay={() => setOverlayOpen(true)}
        // Offered only to the broadcaster. The server refuses everyone else
        // regardless — this just doesn't dangle a button that would fail.
        onOpenEditors={
          editors.canInvite ? () => setEditorsOpen(true) : undefined
        }
      />

      <div
        className="app-canvas"
        ref={containerRef}
        onPointerDown={handleCanvasPointerDown}
      >
        <div
          className="app-world"
          style={{
            width: WORLD_WIDTH,
            height: WORLD_HEIGHT,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          }}
        >
          <div className="app-frame">
            <TwitchPlayer channel={channel.login} />
          </div>

          <BoardLayer
            items={boardItems}
            view={view}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onLocalTransform={applyTransforms}
            onReorder={handleReorderItems}
            onRemove={handleRemoveItems}
            onEditText={setEditingId}
            onMute={handleMute}
          />
        </div>
      </div>

      {marquee && (
        <div
          className="marquee"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.right - marquee.left,
            height: marquee.bottom - marquee.top,
          }}
        />
      )}

      {itemError && (
        <div className="paste-status is-error" role="status">
          {itemError}
        </div>
      )}

      {pasteStatus && (
        <div
          className={`paste-status${
            pasteStatus.kind === "error" ? " is-error" : ""
          }`}
          role="status"
        >
          {pasteStatus.kind === "busy" && (
            <WaSpinner style={{ fontSize: "1rem" }} />
          )}
          {pasteStatus.message}
        </div>
      )}

      {Object.values(cursors).map((cursor) => (
        <div
          key={cursor.id}
          style={{
            position: "fixed",
            left: cursor.x,
            top: cursor.y,


            zIndex: 30,
            pointerEvents: "none", // Prevents the element from blocking mouse events
            transform: "translate(-5px, -5px)", // Center the pointer point
            transition: "transform 0.1s linear",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          {}
          <Cursor fillColor={cursor.color || "#9146FF"} />

          {}
          <span
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.75)",
              color: "white",
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "12px",
              marginTop: "4px",
              whiteSpace: "nowrap",
            }}
          >
            {cursor.username || `User (${cursor.id.substring(0, 4)})`}
          </span>
        </div>
      ))}

      <LayoutManager
        open={layoutsOpen}
        onClose={() => setLayoutsOpen(false)}
        layouts={layouts.layouts}
        error={layouts.error}
        itemCount={Object.keys(boardItems).length}
        onSave={layouts.save}
        onLoad={layouts.load}
        onDelete={layouts.remove}
      />

      <TextEditor
        item={editingId ? (boardItems[editingId] ?? null) : null}
        onClose={() => setEditingId(null)}
        onSave={handleSaveText}
      />

      <EditorManager
        open={editorsOpen}
        onClose={() => {
          setEditorsOpen(false);
          editors.dismissError();
        }}
        channelName={channel.name}
        invited={editors.invited}
        error={editors.error}
        token={token}
        onAdd={editors.add}
        onRemove={editors.remove}
      />

      <OverlaySetup
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        channelName={channel.name}
        link={overlayLink}
      />

      <WaDialog
        label="Clear the board?"
        open={confirmingClear}
        onWaHide={() => setConfirmingClear(false)}
      >
        This removes all {Object.keys(boardItems).length} items for everyone,
        including the stream overlay. You can undo it with Ctrl+Z.
        <WaButton
          slot="footer"
          appearance="outlined"
          onClick={() => setConfirmingClear(false)}
        >
          Cancel
        </WaButton>
        <WaButton slot="footer" variant="danger" onClick={handleClearBoard}>
          Clear board
        </WaButton>
      </WaDialog>

      <WaButton
        className="drawer-tab"
        variant="neutral"
        onClick={openDrawer}
      >
        Menu
      </WaButton>
      <WaDrawer
        className="app-drawer"
        label="Menu"
        id="drawer-overview"
        open={isOpen}
        onWaHide={() => setIsOpen(false)}
        lightDismiss
        placement="end"
      >
        {}
        <EmotePicker
          channelId={channel.id}
          channelName={channel.name}
          revision={pickerRevision}
          token={token}
          board={board}
          onPickUp={handlePickUp}
        />
        <WaButton
          slot="footer"
          variant="brand"
          data-drawer="close"
          onClick={() => setIsOpen(false)}
        >
          Close
        </WaButton>
      </WaDrawer>

      {carried && ghost && carried.kind === "shape" && (
        <span
          className="item-ghost"
          style={{
            left: ghost.x,
            top: ghost.y,
            width: dropSize(carried) * view.zoom,
            height: (dropSize(carried) / carried.aspect) * view.zoom,
          }}
        >
          <BoardShape
            item={shapePreviewItem({
              shape: carried.shape,
              color: carried.color,
              outline: carried.outline,
              aspect: carried.aspect,
              size: dropSize(carried),
            })}
            width={dropSize(carried)}
            height={dropSize(carried) / carried.aspect}
          />
        </span>
      )}

      {carried && ghost && carried.kind === "embed" && (
        <span
          className="item-ghost embed-ghost"
          style={{
            left: ghost.x,
            top: ghost.y,
            width: dropSize(carried) * view.zoom,
            height: (dropSize(carried) / carried.aspect) * view.zoom,
          }}
        >
          {carried.name}
        </span>
      )}

      {carried &&
        ghost &&
        (carried.kind === "emote" || carried.kind === "image") && (
        <img
          className="item-ghost"
          src={
            carried.kind === "emote"
              ? emoteUrl(carried.emoteId, 4)
              : resolveImageSrc(carried.src)
          }
          alt=""
          style={{
            left: ghost.x,
            top: ghost.y,
            width: dropSize(carried) * view.zoom,
          }}
        />
      )}

      {carried && ghost && carried.kind === "text" && (
        <span
          className="item-ghost board-text"
          style={{
            left: ghost.x,
            top: ghost.y,
            fontSize: TEXT_SIZE * view.zoom,
            color: carried.color,
          }}
        >
          {carried.text}
        </span>
      )}
    </div>
  );
}
