"use client";

import { useCallback, useEffect, useState } from "react";
import { socket } from "../../utils/socket";

export function useBoardHistory() {
  const [state, setState] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    const onState = (next: { canUndo: boolean; canRedo: boolean }) =>
      setState(next);

    socket.on("history:state", onState);
    return () => {
      socket.off("history:state", onState);
    };
  }, []);

  const undo = useCallback(() => socket.emit("undo"), []);
  const redo = useCallback(() => socket.emit("redo"), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;


      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, wa-input")) return;


      event.preventDefault();


      if (key === "y" || event.shiftKey) redo();
      else undo();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  return { ...state, undo, redo };
}
