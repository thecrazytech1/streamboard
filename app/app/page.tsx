"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WaSpinner } from "@awesome.me/webawesome/dist/react";
import TwitchLogin from "./components/TwitchLogin";
import { useTwitchToken } from "./hooks/useTwitchToken";
import {
  fetchModeratedChannels,
  fetchSelf,
  type TwitchChannel,
} from "./lib/twitch";

type Boards =
  | { status: "loading" }
  | {
      status: "ready";
      own: TwitchChannel;
      moderated: TwitchChannel[] | null;
    }
  | { status: "error"; message: string };

const LOADING: Boards = { status: "loading" };

export default function Home() {
  const { token, logout } = useTwitchToken();
  const [boards, setBoards] = useState<Boards>(LOADING);

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();

    const load = async () => {
      try {
        const own = await fetchSelf(token, controller.signal);




        const moderated = await fetchModeratedChannels(
          token,
          own.id,
          controller.signal,
        ).catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }
          console.error("Couldn't list moderated channels:", error);
          return null;
        });

        setBoards({
          status: "ready",
          own,


          moderated:
            moderated?.filter((channel) => channel.id !== own.id) ?? null,
        });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setBoards({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Couldn't reach Twitch just now.",
        });
      }
    };

    void load();
    return () => controller.abort();
  }, [token]);

  return (
    <div className="app-shell">
      <div className="access-gate">
        <div className="access-gate-card home-card">
          <h1>Stream boards</h1>

          {!token && (
            <>
              <p>
                Log in with Twitch to see the boards you can edit — your own
                channel&apos;s, and any channel you moderate.
              </p>
              <TwitchLogin />
            </>
          )}

          {token && boards.status === "loading" && (
            <>
              <p>Asking Twitch which boards are yours…</p>
              <WaSpinner style={{ fontSize: "2rem" }} />
            </>
          )}

          {token && boards.status === "error" && (
            <>
              <p>{boards.message}</p>
              <button className="twitch-login" onClick={logout}>
                Log in again
              </button>
            </>
          )}

          {token && boards.status === "ready" && (
            <>
              <p className="home-label">Your channel</p>
              <ul className="home-boards">
                <li>
                  <Link href={`/b/${boards.own.login}`}>
                    {boards.own.name}
                  </Link>
                </li>
              </ul>

              {boards.moderated === null ? (
                <>
                  <p className="home-label">Channels you moderate</p>
                  <p>
                    Twitch wouldn&apos;t tell us. This browser&apos;s login is
                    probably from before the board asked for permission to read
                    your moderator status — signing in again fixes it.
                  </p>
                  <button className="twitch-login" onClick={logout}>
                    Sign in again
                  </button>
                </>
              ) : (
                <>
                  <p className="home-label">
                    {boards.moderated.length > 0
                      ? "Channels you moderate"
                      : "You don't moderate any other channels."}
                  </p>
                  {boards.moderated.length > 0 && (
                    <ul className="home-boards">
                      {boards.moderated.map((channel) => (
                        <li key={channel.id}>
                          <Link href={`/b/${channel.login}`}>
                            {channel.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button className="twitch-login" onClick={logout}>
                    Sign out
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
