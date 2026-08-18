"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_PASTED_TEXT, readClipboard, type PastePayload } from "../lib/clipboard";
import { addImageByUrl, rememberImage, uploadImage } from "../lib/images";
import type { DraggableItem } from "@/types/board";


const PASTED_TEXT_COLOR = "#ffffff";


const ERROR_MS = 6000;

export type PasteStatus =
  | { kind: "busy"; message: string }
  | { kind: "error"; message: string }
  | null;

type Options = {

  token: string | null;

  board: string;

  onPlace: (item: DraggableItem, clientX: number, clientY: number) => void;
};

export function usePasteToBoard({ token, board, onPlace }: Options) {
  const [status, setStatus] = useState<PasteStatus>(null);


  const pointer = useRef<{ x: number; y: number } | null>(null);

  const place = useRef(onPlace);
  useEffect(() => {
    place.current = onPlace;
  }, [onPlace]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };

    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);


  useEffect(() => {
    if (status?.kind !== "error") return;

    const timer = setTimeout(() => setStatus(null), ERROR_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const handle = useCallback(
    async (payload: PastePayload, at: { x: number; y: number }) => {
      const drop = (item: DraggableItem) => place.current(item, at.x, at.y);

      try {
        if (payload.kind === "text") {


          drop({
            kind: "text",
            text: payload.text.slice(0, MAX_PASTED_TEXT),
            color: PASTED_TEXT_COLOR,
          });
          return;
        }

        if (payload.kind === "url") {
          setStatus({ kind: "busy", message: "Fetching that image…" });


          const image = await addImageByUrl(payload.url);
          rememberImage(image);
          drop({ kind: "image", ...image });
          setStatus(null);
          return;
        }

        if (!token) {
          setStatus({
            kind: "error",
            message: "Sign in with Twitch to paste images.",
          });
          return;
        }

        setStatus({ kind: "busy", message: "Uploading pasted image…" });
        const image = await uploadImage(payload.file, token, board);
        rememberImage(image);
        drop({ kind: "image", ...image });
        setStatus(null);
      } catch (problem) {
        setStatus({
          kind: "error",
          message:
            problem instanceof Error ? problem.message : "Couldn't paste that.",
        });
      }
    },
    [token, board],
  );

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {



      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, wa-input, [contenteditable]")
      ) {
        return;
      }

      const payload = readClipboard(event.clipboardData);
      if (!payload) return;

      event.preventDefault();



      void handle(
        payload,
        pointer.current ?? {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        },
      );
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handle]);

  return status;
}
