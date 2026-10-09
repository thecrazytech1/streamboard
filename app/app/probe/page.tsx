"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * A throwaway diagnostic, for answering two questions about the browser inside
 * OBS that can't be answered by reading docs:
 *
 *   1. Will it give a page the webcam? If yes, the camera can live in the board
 *      and the existing filter items work on it directly.
 *   2. Will it open a websocket to obs-websocket on localhost? If yes, the
 *      overlay can drive OBS itself, with no extra software on the machine.
 *
 * Everything reports on the page, in large text: a browser source has no
 * devtools and no console to read. Delete this route once both answers are in.
 */

type Probe =
  | { status: "running" }
  | { status: "ok"; detail: string }
  | { status: "failed"; detail: string };

const RUNNING: Probe = { status: "running" };

/**
 * Browser-only values, read through useSyncExternalStore so the prerender and
 * the first client render agree. Reading them straight from `navigator` or
 * `location` during render is a hydration mismatch — React recovers, but it
 * logs an error, and in a browser source that log is the only thing you see.
 *
 * Neither can change without a reload, so there's nothing to subscribe to.
 */
const subscribeNever = () => () => {};
const getAgent = () => navigator.userAgent;
const getServerAgent = () => "";
const getPort = () =>
  new URLSearchParams(window.location.search).get("port") ?? "4455";
const getServerPort = () => "4455";

/** Long enough for a slow handshake, short enough to not look hung. */
const WS_TIMEOUT_MS = 6000;

export default function ProbePage() {
  const [camera, setCamera] = useState<Probe>(RUNNING);
  const [obs, setObs] = useState<Probe>(RUNNING);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  // The port obs-websocket listens on, in case it was moved off the default.
  const port = useSyncExternalStore(subscribeNever, getPort, getServerPort);
  const agentText = useSyncExternalStore(
    subscribeNever,
    getAgent,
    getServerAgent,
  );

  useEffect(() => {
    let cancelled = false;

    const probeCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera({
          status: "failed",
          detail:
            "navigator.mediaDevices is missing entirely — this browser exposes no camera API here.",
        });
        return;
      }

      try {
        const opened = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }

        const track = opened.getVideoTracks()[0];
        const settings = track?.getSettings?.() ?? {};
        setStream(opened);
        setCamera({
          status: "ok",
          detail: `${track?.label || "unnamed device"} at ${
            settings.width ?? "?"
          }×${settings.height ?? "?"}`,
        });
      } catch (error) {
        const failure = error as DOMException;
        setCamera({
          status: "failed",
          detail: `${failure.name}: ${failure.message}`,
        });
      }
    };

    void probeCamera();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (result: Probe) => {
      if (settled) return;
      settled = true;
      setObs(result);
    };

    // Inside an async function rather than the effect body, so a constructor
    // that throws reports through the same path as every other outcome.
    const start = async () => {
      let opened: WebSocket;
      try {
        opened = new WebSocket(`ws://127.0.0.1:${port}`);
      } catch (error) {
        finish({
          status: "failed",
          detail: `Constructing the socket threw: ${String(error)}`,
        });
        return;
      }
      socket = opened;

      timer = setTimeout(() => {
        finish({
          status: "failed",
          detail:
            `Nothing within ${WS_TIMEOUT_MS / 1000}s. Either OBS isn't ` +
            `listening on ${port}, or the connection was blocked before it ` +
            `left the browser.`,
        });
        opened.close();
      }, WS_TIMEOUT_MS);

      // obs-websocket greets every connection with a Hello (op 0). Receiving
      // it is the only proof that counts — an open socket could be anything.
      opened.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            op?: number;
            d?: {
              obsWebSocketVersion?: string;
              rpcVersion?: number;
              authentication?: unknown;
            };
          };

          if (message.op !== 0) return;

          finish({
            status: "ok",
            detail:
              `obs-websocket ${message.d?.obsWebSocketVersion ?? "?"}, ` +
              `rpc ${message.d?.rpcVersion ?? "?"}, ` +
              (message.d?.authentication
                ? "password required"
                : "no password set"),
          });
        } catch {
          finish({
            status: "ok",
            detail: "Connected, but the greeting wasn't obs-websocket's.",
          });
        }
        opened.close();
      };

      opened.onerror = () =>
        finish({
          status: "failed",
          detail:
            "The socket errored. In a browser source that usually means " +
            "nothing is listening, or the page was refused a private-network " +
            "connection.",
        });

      opened.onclose = (event) =>
        finish({
          status: "failed",
          detail: `Closed before greeting — code ${event.code}${
            event.reason ? ` (${event.reason})` : ""
          }.`,
        });
    };

    void start();

    return () => {
      clearTimeout(timer);
      socket?.close();
    };
  }, [port]);

  // Attached once the stream exists, rather than through an autoplaying src.
  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
  }, [stream]);

  // Holding the device would stop OBS opening it, so it's released on the way
  // out — including when the browser source is hidden and the page unloads.
  useEffect(
    () => () => {
      stream?.getTracks().forEach((track) => track.stop());
    },
    [stream],
  );

  return (
    <main style={page}>
      <h1 style={heading}>Browser source probe</h1>

      <Row label="Camera (getUserMedia)" probe={camera} />
      {stream && (
        <video ref={video} autoPlay muted playsInline style={preview} />
      )}

      <Row label={`obs-websocket (127.0.0.1:${port})`} probe={obs} />

      <p style={note}>
        Camera working means the webcam can live in the board, and filters work
        on it with no OBS integration at all. obs-websocket working means the
        overlay can drive OBS directly. Either answer is useful.
      </p>

      <p style={agent}>{agentText}</p>
    </main>
  );
}

function Row({ label, probe }: { label: string; probe: Probe }) {
  const colour =
    probe.status === "ok"
      ? "#00e701"
      : probe.status === "failed"
        ? "#ff5c5c"
        : "#ffd400";

  return (
    <section style={row}>
      <div style={{ ...dot, background: colour }} />
      <div>
        <div style={rowLabel}>{label}</div>
        <div style={{ ...rowDetail, color: colour }}>
          {probe.status === "running" ? "trying…" : probe.detail}
        </div>
      </div>
    </section>
  );
}

/* Inline styles on purpose: this route is meant to be deleted, and keeping it
   to one file means deleting it leaves nothing behind. */
const page: React.CSSProperties = {
  minHeight: "100vh",
  padding: "2rem",
  background: "#0e0e10",
  color: "#efeff1",
  fontFamily: "system-ui, sans-serif",
};
const heading: React.CSSProperties = { fontSize: "1.5rem", fontWeight: 700 };
const row: React.CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  alignItems: "flex-start",
  margin: "1.5rem 0",
};
const dot: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  marginTop: 4,
  flex: "0 0 auto",
};
const rowLabel: React.CSSProperties = { fontSize: "1.125rem", fontWeight: 600 };
const rowDetail: React.CSSProperties = {
  fontSize: "1rem",
  marginTop: "0.25rem",
  maxWidth: "50rem",
};
const preview: React.CSSProperties = {
  width: 320,
  borderRadius: 8,
  border: "1px solid #3a3a3d",
  background: "#000",
};
const note: React.CSSProperties = {
  marginTop: "2rem",
  maxWidth: "40rem",
  opacity: 0.7,
  lineHeight: 1.5,
};
const agent: React.CSSProperties = {
  marginTop: "1rem",
  fontSize: "0.75rem",
  opacity: 0.5,
  fontFamily: "ui-monospace, monospace",
};
