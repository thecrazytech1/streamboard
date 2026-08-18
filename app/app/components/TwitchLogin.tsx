"use client";

import { CLIENT_ID } from "../lib/twitch";
const SCOPES = "user:read:moderated_channels";

const TwitchLogin = () => {
  const handleLogin = () => {




    const authUrl =
      `https://id.twitch.tv/oauth2/authorize` +
      `?client_id=${CLIENT_ID}` +
      `&redirect_uri=https://sb.chrissquartz.xyz` +
      `&response_type=token` +
      `&scope=${encodeURIComponent(SCOPES)}`;

    window.location.href = authUrl;
  };

  return (
    <button onClick={handleLogin} className="twitch-login">
      Login with Twitch
    </button>
  );
};

export default TwitchLogin;
