import { io } from "socket.io-client";

export const SERVER_URL = "https://sb.chrissquartz.xyz";

export const socket = io(SERVER_URL, {
  autoConnect: false,
  path: '/websocket/socket.io',
  transports: ["websocket", "polling"],
});

export type AccessDenial =
  | "unauthenticated"
  | "unauthorised"
  | "scope"
  | "offline";

export function classifyConnectError(error: Error): AccessDenial {
  if (error.message === "unauthenticated") return "unauthenticated";
  if (error.message === "unauthorised") return "unauthorised";
  if (error.message === "scope") return "scope";

  return "offline";
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
