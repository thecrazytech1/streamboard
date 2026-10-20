"use client";

import { useEffect, useRef, useState } from "react";
import { socket } from "../../utils/socket";
import { useCameraPreview, usePresence } from "../hooks/useCameraPreview";

/**
 * Preview size and rate. Small and slow on purpose: this is for framing a
 * camera on the board, not for watching it, and every frame costs the overlay
 * a draw and a JPEG encode on a browser source that has no GPU acceleration.
 */
const PREVIEW_WIDTH = 160;
const PREVIEW_FPS = 3;
const PREVIEW_QUALITY = 0.45;

/**
 * A webcam, as a board item.
 *
 * Only the overlay opens a camera — hence `live`. Two reasons, both learned the
 * hard way: a camera device can be held by one consumer at a time, so an editor
 * that opened it would steal it from the stream mid-broadcast; and an editor is
 * often somebody else's laptop, where "the camera" is their webcam, not the
 * streamer's. So the board shows a placeholder and you frame it blind, watching
 * the result in OBS.
 *
 * In OBS this needs the browser launched with --use-fake-ui-for-media-stream,
 * since a browser source has no way to show a permission prompt and so fails
 * closed without it.
 *
 * So that the board isn't editing a blank box, the overlay sends it a small
 * picture of the feed every so often — only while somebody has the board open,
 * and never stored anywhere. See useCameraPreview.
 */
export default function BoardCamera({
  id,
  device,
  name,
  live,
}: {
  id: string;
  device: string;
  name: string;
  live: boolean;
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  // One side sends, the other receives; neither does both.
  const { editors } = usePresence();
  const preview = useCameraPreview(id);

  useEffect(() => {
    if (!live || !navigator.mediaDevices?.getUserMedia) return;

    let cancelled = false;
    let opened: MediaStream | null = null;

    const open = async () => {
      try {
        // Opened unconstrained first. Device labels are hidden until a camera
        // has been granted once, so there's nothing to match `device` against
        // before this call succeeds.
        opened = await navigator.mediaDevices.getUserMedia({ video: true });

        if (device) {
          const wanted = device.toLowerCase();
          const devices = await navigator.mediaDevices.enumerateDevices();
          const match = devices.find(
            (entry) =>
              entry.kind === "videoinput" &&
              entry.label.toLowerCase().includes(wanted),
          );

          const current = opened.getVideoTracks()[0]?.getSettings?.().deviceId;
          if (match && match.deviceId !== current) {
            // Released before reopening: the machine may only allow one.
            opened.getTracks().forEach((track) => track.stop());
            opened = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: match.deviceId } },
            });
          }
        }

        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        setStream(opened);
      } catch (error) {
        // Nothing rendered and nothing logged on screen: this runs on the
        // overlay, and an error card here would be an error card on stream.
        console.error("Camera item couldn't open a device:", error);
      }
    };

    void open();

    return () => {
      cancelled = true;
      opened?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [device, live]);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  // Sending the board a look at the feed. Nothing happens unless the camera is
  // open here *and* somebody is on the board to see it.
  useEffect(() => {
    if (!live || !stream || editors === 0) return;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;

    const timer = setInterval(() => {
      const source = video.current;
      // HAVE_CURRENT_DATA: anything less and there's no frame to draw yet.
      if (!source || source.readyState < 2 || !source.videoWidth) return;

      // The camera's own proportions, not the item's — the board crops it to
      // the item, and a squashed preview would frame it wrongly.
      canvas.width = PREVIEW_WIDTH;
      canvas.height = Math.max(
        1,
        Math.round((PREVIEW_WIDTH * source.videoHeight) / source.videoWidth),
      );
      context.drawImage(source, 0, 0, canvas.width, canvas.height);

      socket.emit("camera:frame", {
        id,
        frame: canvas.toDataURL("image/jpeg", PREVIEW_QUALITY),
      });
    }, 1000 / PREVIEW_FPS);

    return () => clearInterval(timer);
  }, [id, live, stream, editors]);

  if (!live) {
    // A still from the overlay if one has arrived, and the explanation if not.
    return preview ? (
      <span className="board-camera-preview">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt={name || "Camera"} draggable={false} />
      </span>
    ) : (
      <span className="board-camera-placeholder">
        {name || "Camera"}
        <small>{device ? `matching “${device}”` : "default camera"}</small>
        <small>waiting for the overlay</small>
      </span>
    );
  }

  // muted is not optional: a browser source's audio goes into OBS, and a camera
  // item is video only — the microphone is OBS's job.
  return (
    <video
      ref={video}
      className="board-camera"
      autoPlay
      muted
      playsInline
      disablePictureInPicture
    />
  );
}
