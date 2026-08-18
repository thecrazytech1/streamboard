"use client";

import { useCallback, useEffect, useState } from "react";
import { socket } from "../../utils/socket";
import type { BoardLayout } from "@/types/board";

export function useBoardLayouts() {
  const [layouts, setLayouts] = useState<BoardLayout[]>([]);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onState = (next: BoardLayout[]) => {
      setLayouts(Array.isArray(next) ? next : []);


      setError(null);
    };

    const onError = (message: string) => setError(String(message));

    socket.on("layouts:state", onState);
    socket.on("layout:error", onError);

    return () => {
      socket.off("layouts:state", onState);
      socket.off("layout:error", onError);
    };
  }, []);


  const save = useCallback((name: string) => {
    socket.emit("layout:save", { name });
  }, []);

  const load = useCallback((id: string) => {
    socket.emit("layout:load", { id });
  }, []);

  const remove = useCallback((id: string) => {
    socket.emit("layout:delete", { id });
  }, []);

  return { layouts, error, save, load, remove };
}
