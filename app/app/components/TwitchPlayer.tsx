"use client";

import { useSyncExternalStore } from "react";

type Props = {
  channel: string;
};

const neverChanges = () => () => {};
const getHostname = () => window.location.hostname;
const getServerHostname = () => null;

export default function TwitchPlayer({ channel }: Props) {
  const parent = useSyncExternalStore(
    neverChanges,
    getHostname,
    getServerHostname,
  );

  if (!parent) return null;

  const params = new URLSearchParams({
    channel,
    parent,
    autoplay: "true",
    muted: "true",
  });

  return (
    <div className="twitch-player">
      <iframe
        src={`https://player.twitch.tv/?${params.toString()}`}
        title={`${channel} on Twitch`}
        allow="autoplay; fullscreen"
        allowFullScreen
      />
    </div>
  );
}