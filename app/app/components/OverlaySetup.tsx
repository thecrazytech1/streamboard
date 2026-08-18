"use client";

import { useEffect, useState } from "react";
import { WaButton, WaDialog } from "@awesome.me/webawesome/dist/react";

type Props = {
  open: boolean;
  onClose: () => void;
  channelName: string;
  
  link: string | null;
};


const COPIED_MS = 2000;

export default function OverlaySetup({
  open,
  onClose,
  channelName,
  link,
}: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!link) return;

    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {


    }
  };

  return (
    <WaDialog
      className="overlay-setup"
      label="Put this board on stream"
      open={open}
      onWaHide={onClose}
      lightDismiss
    >
      {link ? (
        <>
          <p className="text-sm">
            In OBS, add a <strong>Browser Source</strong> with this url. It
            renders {channelName}&apos;s board on a transparent background.
          </p>
          <label className="overlay-setup-field">
            <span className="overlay-setup-label">Browser source url</span>
            <input
              readOnly
              value={link}
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>

          <WaButton variant="brand" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy url"}
          </WaButton>

          <ul className="overlay-setup-notes">
            <li>
              Set the source to <strong>1920 × 1080</strong>. Any 16:9 size
              works — the frame scales to fit, and letterboxes if it isn&apos;t.
            </li>
            <li>
              Leave the background alone. The page is already transparent, so no
              custom CSS is needed.
            </li>
            <li>
              Only items inside the frame outline reach the stream. Anything
              parked in the staging area around it stays off.
            </li>
            <li>
              Treat the url as a password: it lets anyone holding it watch this
              board.
            </li>
          </ul>
        </>
      ) : (
        <p className="text-sm opacity-60">
          Waiting for the board server to send this board&apos;s key…
        </p>
      )}

      <WaButton slot="footer" appearance="outlined" onClick={onClose}>
        Done
      </WaButton>
    </WaDialog>
  );
}
