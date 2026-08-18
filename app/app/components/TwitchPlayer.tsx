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

  return (
    <div className="twitch-player">
      {parent && (
        <iframe
          src={`https://player.twitch.tv/?channel=${encodeURIComponent(
            channel,
          )}&parent=${encodeURIComponent(parent)}&muted=true`}
          title={`${channel} on Twitch`}
          allowFullScreen
        />
      )}
    </div>
  );
}
