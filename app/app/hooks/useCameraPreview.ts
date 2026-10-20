"use client";

import { useEffect, useState } from "react";
import { socket } from "../../utils/socket";

/**
 * The last picture the overlay sent of what a camera item is showing.
 *
 * Only the overlay can open a camera — one device, one consumer — so this is
 * how the board gets to see it at all. Frames are relayed and dropped, never
 * stored, and null until one arrives: no overlay running means no preview.
 */
export function useCameraPreview(id: string): string | null {
  const [frame, setFrame] = useState<string | null>(null);

  useEffect(() => {
    const onFrame = (data: { id?: string; frame?: string }) => {
      if (data?.id !== id || typeof data.frame !== "string") return;
      setFrame(data.frame);
    };

    socket.on("camera:frame", onFrame);
    return () => {
      socket.off("camera:frame", onFrame);
      // Belongs to the item it came from; a different one starts blank.
      setFrame(null);
    };
  }, [id]);

  return frame;
}

/** Who is connected to this board, in both directions. */
export type Presence = { editors: number; overlays: number };

const NOBODY: Presence = { editors: 0, overlays: 0 };

/**
 * Who else is on this board.
 *
 * The overlay uses `editors` to decide whether to spend CPU on camera previews
 * — browser sources here are software-rendered, so "nobody is looking" is worth
 * knowing. The board uses `overlays` to say whether anything is actually on
 * stream to receive what it sends.
 */
export function usePresence(): Presence {
  const [presence, setPresence] = useState<Presence>(NOBODY);

  useEffect(() => {
    const onPresence = (data: { editors?: number; overlays?: number }) =>
      setPresence({
        editors: Number(data?.editors ?? 0),
        overlays: Number(data?.overlays ?? 0),
      });

    socket.on("board:watchers", onPresence);
    return () => {
      socket.off("board:watchers", onPresence);
    };
  }, []);

  return presence;
}
