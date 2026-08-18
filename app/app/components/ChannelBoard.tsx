"use client";

import { useEffect, useState } from "react";
import AccessGate from "./AccessGate";
import BoardApp from "./BoardApp";
import { useTwitchToken } from "../hooks/useTwitchToken";
import { fetchChannel, type TwitchChannel } from "../lib/twitch";

type Lookup =
  | { status: "loading" }
  | { status: "ready"; channel: TwitchChannel }
  | { status: "error"; message: string };

const LOADING: Lookup = { status: "loading" };

export default function ChannelBoard({ login }: { login: string }) {
  const { token, logout } = useTwitchToken();
  const [lookup, setLookup] = useState<Lookup>(LOADING);

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();

    fetchChannel(login, token, controller.signal)
      .then((channel) => setLookup({ status: "ready", channel }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLookup({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Couldn't look that channel up.",
        });
      });

    return () => controller.abort();
  }, [login, token]);




  if (!token) {
    return (
      <div className="app-shell">
        <AccessGate
          access={{ status: "anonymous" }}
          channelName={login}
          onLogout={logout}
        />
      </div>
    );
  }

  if (lookup.status === "loading") {
    return (
      <div className="app-shell">
        <AccessGate
          access={{ status: "checking" }}
          channelName={login}
          onLogout={logout}
        />
      </div>
    );
  }

  if (lookup.status === "error") {
    return (
      <div className="app-shell">
        <div className="access-gate">
          <div className="access-gate-card">
            <h1>No board here</h1>
            <p>{lookup.message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <BoardApp
      channel={lookup.channel}


      board={lookup.channel.id}
      token={token}
      onLogout={logout}
    />
  );
}
