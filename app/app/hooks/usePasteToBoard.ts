"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_PASTED_TEXT, readClipboard, type PastePayload } from "../lib/clipboard";
import { EMBED_PROVIDERS, embedName } from "../lib/embeds";
import { addImageByUrl, rememberImage, uploadImage } from "../lib/images";
import type { DraggableItem } from "@/types/board";


const PASTED_TEXT_COLOR = "#ffffff";


const ERROR_MS = 6000;

/**
 * How long after a middle click a paste is taken to have come from it. The
 * paste follows the release almost immediately; this only has to outlast that
 * and fall short of somebody middle-clicking and then reaching for ctrl+V.
 */
const MIDDLE_CLICK_PASTE_MS = 500;

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

  /**
   * When the middle button was last pressed.
   *
   * On Linux, middle-clicking pastes the primary selection and the browser
   * raises a real paste event for it — so panning the canvas with the middle
   * button flings whatever text happened to be selected onto the board. Pastes
   * that follow one of these are ignored.
   */
  const middleClick = useRef(0);

  const place = useRef(onPlace);
  useEffect(() => {
    place.current = onPlace;
  }, [onPlace]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };

    const onDown = (event: PointerEvent) => {
      if (event.button === 1) middleClick.current = performance.now();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
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

        if (payload.kind === "embed") {
          const { provider, embedId } = payload.embed;
          drop({
            kind: "embed",
            provider,
            embedId,
            aspect: EMBED_PROVIDERS[provider].aspect,
            name: embedName(provider, embedId),
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

      // A middle click just happened, so this is the primary selection being
      // pasted rather than somebody asking for it. Ignored here rather than
      // suppressed outright: middle-click paste still works in a text field,
      // where it's the behaviour people expect.
      if (performance.now() - middleClick.current < MIDDLE_CLICK_PASTE_MS) {
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
