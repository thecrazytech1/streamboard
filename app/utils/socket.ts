import { io } from "socket.io-client";

export const SERVER_URL = "https://sb.chrissquartz.xyz";

export const socket = io(SERVER_URL, {
  autoConnect: false,
  path: '/websocket/socket.io',
  transports: ["websocket", "polling"],
});

/**
 * Why the server turned us away — every one of these is final, and every one of
 * them is something the server said on purpose.
 *
 * `refused` is the catch-all: a rejection we don't have wording for, which in
 * practice means a client and server that disagree about something (an unknown
 * board id, or a reason added on one side and not the other).
 */
export type AccessDenial =
  | "unauthenticated"
  | "unauthorised"
  | "scope"
  | "refused";

/** A handshake that didn't succeed, split by whether it's worth waiting out. */
export type ConnectFailure =
  /** The server answered and said no. Nothing to wait for. */
  | { kind: "denied"; reason: AccessDenial }
  /** Couldn't reach it, or the attempt died in transit. Still trying. */
  | { kind: "retrying" };

const DENIALS: readonly AccessDenial[] = [
  "unauthenticated",
  "unauthorised",
  "scope",
];

/**
 * Sorts a `connect_error` into "no" and "not yet".
 *
 * `socket.active` is the honest discriminator, and the reason this isn't just a
 * match on the message: socket.io only keeps retrying a connection it thinks
 * could still succeed. A refusal from the handshake middleware switches the
 * socket inactive, while a transport failure — server restarting, tunnel
 * blinking, a flaky first upgrade — leaves it retrying on a backoff.
 *
 * Reading the message alone is what made an ordinary reconnect look like a dead
 * server: the first failed attempt would surface as a hard error a second
 * before the retry succeeded.
 */
export function classifyConnectError(error: Error): ConnectFailure {
  if (socket.active) return { kind: "retrying" };

  const reason = DENIALS.find((denial) => denial === error.message);
  return { kind: "denied", reason: reason ?? "refused" };
}

function reconnectWith(auth: Record<string, string>): void {


  if (socket.connected) socket.disconnect();
  socket.auth = auth;
  socket.connect();
}

export function connectAsEditor(token: string, board: string): void {
  reconnectWith({ token, board });
}

export function connectAsOverlay(overlayKey: string, board: string): void {
  reconnectWith({ overlayKey, board });
}

export function disconnectSocket(): void {
  socket.disconnect();
}
