"use client";

import { useEffect, useRef, useState } from "react";

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
 */
export default function BoardCamera({
  device,
  name,
  live,
}: {
  device: string;
  name: string;
  live: boolean;
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);

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

  if (!live) {
    return (
      <span className="board-camera-placeholder">
        {name || "Camera"}
        <small>{device ? `matching “${device}”` : "default camera"}</small>
        <small>shown on the overlay</small>
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
