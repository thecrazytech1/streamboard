"use client";

import TwitchLogin from "./TwitchLogin";
import type { AccessState } from "../hooks/useBoardAccess";

type Props = {
  access: AccessState;
  channelName: string;
  onLogout: () => void;
};

export default function AccessGate({ access, channelName, onLogout }: Props) {
  if (access.status === "allowed") return null;

  return (
    <div className="access-gate">
      <div className="access-gate-card">
        {access.status === "checking" && (
          <>
            <h1>Checking access…</h1>
            <p>Confirming your Twitch account with the server.</p>
          </>
        )}

        {access.status === "anonymous" && (
          <>
            <h1>{channelName}&apos;s stream board</h1>
            <p>Log in with Twitch to continue.</p>
            <TwitchLogin />
          </>
        )}

        {access.status === "denied" && access.reason === "unauthorised" && (
          <>
            <h1>No access</h1>
            <p>
              This board is for {channelName} and their Twitch moderators. If
              you should be one, ask them to mod you — access follows your
              moderator status, so there&apos;s no separate list to be added to.
            </p>
            <button className="twitch-login" onClick={onLogout}>
              Sign in as someone else
            </button>
          </>
        )}

        {access.status === "denied" && access.reason === "scope" && (
          <>
            <h1>One more permission</h1>
            <p>
              Sign in again to let the board check your moderator status with
              Twitch. It only ever reads which channels you moderate.
            </p>
            <button className="twitch-login" onClick={onLogout}>
              Sign in again
            </button>
          </>
        )}

        {access.status === "denied" && access.reason === "unauthenticated" && (
          <>
            <h1>Session expired</h1>
            <p>Twitch no longer recognises your login.</p>
            <button className="twitch-login" onClick={onLogout}>
              Log in again
            </button>
          </>
        )}

        {/* Not a failure: socket.io is still retrying, and most of the time it
            succeeds a moment later. Saying "can't reach the server" here is what
            made an ordinary load look broken. */}
        {access.status === "connecting" && !access.slow && (
          <>
            <h1>Connecting…</h1>
            <p>Opening the board.</p>
          </>
        )}

        {/* Still going after a few seconds, so say so — but it's still trying,
            and will come up on its own if the server comes back. */}
        {access.status === "connecting" && access.slow && (
          <>
            <h1>Still connecting…</h1>
            <p>
              The board server isn&apos;t answering yet. This keeps retrying, so
              leave it open — it&apos;ll come up on its own once the server is
              reachable.
            </p>
          </>
        )}

        {/* A rejection with no wording of its own, which in practice means the
            two halves disagree about something rather than the user doing
            anything wrong. */}
        {access.status === "denied" && access.reason === "refused" && (
          <>
            <h1>Connection refused</h1>
            <p>
              The server turned this connection away without saying why. If this
              board&apos;s address was typed by hand, check it — otherwise the
              app and the server are probably running different versions.
            </p>
            <button className="twitch-login" onClick={onLogout}>
              Sign in again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
