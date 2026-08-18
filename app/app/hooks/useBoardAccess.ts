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

  | { status: "anonymous" }

  | { status: "checking" }
  | { status: "allowed" }
  | { status: "denied"; reason: AccessDenial };

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
      console.error(error)
      setVerdict({
        secret,
        board,
        state: { status: "denied", reason: classifyConnectError(error) },
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

  if (missing || !secret || !board) return { status: "anonymous" };

  if (verdict?.secret !== secret || verdict.board !== board) {
    return { status: "checking" };
  }
  return verdict.state;
}
