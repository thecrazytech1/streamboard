"use client";

import { useEffect, useState } from "react";
import { socket } from "../../utils/socket";

export function useOverlayLink(board: string): string | null {
  const [received, setReceived] = useState<{
    board: string;
    key: string;
  } | null>(null);

  useEffect(() => {
    const onKey = (data: { key?: string }) => {
      if (data?.key) setReceived({ board, key: data.key });
    };

    socket.on("overlay:key", onKey);
    return () => {
      socket.off("overlay:key", onKey);
    };
  }, [board]);

  if (!received || received.board !== board) return null;

  return `${window.location.origin}/overlay?board=${encodeURIComponent(
    board,
  )}&key=${encodeURIComponent(received.key)}`;
}
