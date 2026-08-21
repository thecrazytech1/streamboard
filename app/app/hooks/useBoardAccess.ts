"use client";

import { useEffect, useState } from "react";
import {
  classifyConnectError,
  connectAsEditor,
  connectAsOverlay,
  socket,
  type AccessDenial,
} from "../../utils/socket";

export type AccessState =
  /** No credentials to present yet — show the login button. */
  | { status: "anonymous" }
  /** Credentials sent, first answer still outstanding. */
  | { status: "checking" }
  /**
   * Couldn't reach the server, and socket.io is retrying on a backoff. `slow`
   * flips once it's been going long enough to be worth mentioning, so a blink
   * during load reads as "connecting" and a dead server eventually says so.
   */
  | { status: "connecting"; slow: boolean }
  | { status: "allowed" }
  | { status: "denied"; reason: AccessDenial };

/** How long to keep quiet about retrying before admitting it's not going well. */
const SLOW_AFTER_MS = 6000;

type Credentials =
  | { kind: "editor"; token: string | null; board: string }
  | { kind: "overlay"; key: string | null; board: string | null };

export function useBoardAccess(credentials: Credentials): AccessState {
  const secret =
    credentials.kind === "editor" ? credentials.token : credentials.key;
  const board = credentials.board;

  const missing = !secret || !board;

  const [verdict, setVerdict] = useState<{
    secret: string;
    board: string;
    state: AccessState;
  } | null>(null);

  useEffect(() => {
    if (!secret || !board) {
      socket.disconnect();
      return;
    }

    const onConnect = () =>
      setVerdict({ secret, board, state: { status: "allowed" } });

    const onConnectError = (error: Error) => {
      const failure = classifyConnectError(error);

      if (failure.kind === "denied") {
        console.error("Board refused the connection:", error.message);
      }

      setVerdict((previous) => {
        if (failure.kind === "denied") {
          return {
            secret,
            board,
            state: { status: "denied", reason: failure.reason },
          };
        }

        // Already retrying: keep the state we have, including how long it's been
        // going. socket.io retries on a backoff, and replacing this each attempt
        // would restart the clock every time and never reach `slow`.
        if (
          previous?.secret === secret &&
          previous.board === board &&
          previous.state.status === "connecting"
        ) {
          return previous;
        }

        return {
          secret,
          board,
          state: { status: "connecting", slow: false },
        };
      });
    }

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);

    if (credentials.kind === "editor") {
      connectAsEditor(secret, board);
    } else {
      connectAsOverlay(secret, board);
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
    };
  }, [credentials.kind, secret, board]);

  // Promotes a quiet retry to a loud one. Left until the state has settled, so
  // it never fires against a connection that has since been accepted.
  useEffect(() => {
    const state = verdict?.state;
    if (state?.status !== "connecting" || state.slow) return;

    const timer = setTimeout(() => {
      setVerdict((previous) =>
        previous?.state.status === "connecting"
          ? { ...previous, state: { status: "connecting", slow: true } }
          : previous,
      );
    }, SLOW_AFTER_MS);

    return () => clearTimeout(timer);
  }, [verdict]);

  if (missing || !secret || !board) return { status: "anonymous" };

  if (verdict?.secret !== secret || verdict.board !== board) {
    return { status: "checking" };
  }
  return verdict.state;
}
