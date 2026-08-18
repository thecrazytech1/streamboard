"use client";

import { useSyncExternalStore } from "react";
import BoardLayer from "../components/BoardLayer";
import { useBoardAccess } from "../hooks/useBoardAccess";
import { useBoardItems } from "../hooks/useBoardItems";
import { isOnStream, WORLD_HEIGHT, WORLD_WIDTH } from "../lib/world";

const subscribeToResize = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

const getViewport = () => `${window.innerWidth}x${window.innerHeight}`;

const getServerViewport = () => null;

const getOverlayKey = () =>
  new URLSearchParams(window.location.search).get("key");
const getServerOverlayKey = () => null;

const getOverlayBoard = () =>
  new URLSearchParams(window.location.search).get("board");
const getServerOverlayBoard = () => null;

export default function OverlayPage() {
  const overlayKey = useSyncExternalStore(

    () => () => {},
    getOverlayKey,
    getServerOverlayKey,
  );
  const overlayBoard = useSyncExternalStore(
    () => () => {},
    getOverlayBoard,
    getServerOverlayBoard,
  );
  const access = useBoardAccess({
    kind: "overlay",
    key: overlayKey,
    board: overlayBoard,
  });
  const { items } = useBoardItems();
  const viewport = useSyncExternalStore(
    subscribeToResize,
    getViewport,
    getServerViewport,
  );

  const onStream = Object.fromEntries(
    Object.entries(items).filter(([, item]) => isOnStream(item)),
  );

  if (!viewport || access.status !== "allowed") {
    return <div className="emote-overlay" />;
  }

  const [width, height] = viewport.split("x").map(Number);
  const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);

  return (
    <div className="emote-overlay">
      <div
        className="app-world"
        style={{
          width: WORLD_WIDTH,
          height: WORLD_HEIGHT,


          left: (width - WORLD_WIDTH * scale) / 2,
          top: (height - WORLD_HEIGHT * scale) / 2,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <BoardLayer
          items={onStream}
          view={{ x: 0, y: 0, zoom: scale }}
          readOnly
        />
      </div>
    </div>
  );
}
