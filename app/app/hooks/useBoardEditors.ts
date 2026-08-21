"use client";

import { useCallback, useEffect, useState } from "react";
import { socket } from "../../utils/socket";

/** Someone the broadcaster has invited to this board. */
export type InvitedEditor = { id: string; login: string };

/**
 * How this client got into the board. Only a broadcaster — or whoever runs the
 * server — may change the invite list, so the app has to know which it is.
 */
export type BoardRole = "override" | "broadcaster" | "invited" | "moderator";

/**
 * The board's own editor list, on top of the channel's Twitch moderators.
 *
 * Both the list and the role arrive on connect and are pushed on every change,
 * so nothing here polls or fetches. The server is the one enforcing who may
 * edit the list; `canInvite` only decides whether to offer the button.
 */
export function useBoardEditors() {
  const [invited, setInvited] = useState<InvitedEditor[]>([]);
  const [role, setRole] = useState<BoardRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onEditors = (list: InvitedEditor[]) =>
      setInvited(Array.isArray(list) ? list : []);
    const onRole = (data: { via?: BoardRole }) => setRole(data?.via ?? null);
    const onError = (message: string) => setError(String(message));

    socket.on("editors:state", onEditors);
    socket.on("board:role", onRole);
    socket.on("editor:error", onError);

    return () => {
      socket.off("editors:state", onEditors);
      socket.off("board:role", onRole);
      socket.off("editor:error", onError);
    };
  }, []);

  const add = useCallback((editor: InvitedEditor) => {
    setError(null);
    socket.emit("editor:add", editor);
  }, []);

  const remove = useCallback((id: string) => {
    setError(null);
    socket.emit("editor:remove", { id });
  }, []);

  return {
    invited,
    role,
    error,
    /** The server refuses anyone else regardless; this only hides the UI. */
    canInvite: role === "broadcaster" || role === "override",
    add,
    remove,
    dismissError: useCallback(() => setError(null), []),
  };
}
