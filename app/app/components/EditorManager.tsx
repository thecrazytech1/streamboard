"use client";

import { useState } from "react";
import {
  WaButton,
  WaDialog,
  WaInput,
  WaSpinner,
} from "@awesome.me/webawesome/dist/react";
import { fetchChannel } from "../lib/twitch";
import type { InvitedEditor } from "../hooks/useBoardEditors";

type Props = {
  open: boolean;
  onClose: () => void;
  channelName: string;
  invited: InvitedEditor[];
  /** A refusal from the server, shown as-is. */
  error: string | null;
  token: string | null;
  onAdd: (editor: InvitedEditor) => void;
  onRemove: (id: string) => void;
};

/**
 * Who can edit this board besides its moderators.
 *
 * The board asks for a Twitch name but stores an id, so this resolves the login
 * before inviting — a login can be released and claimed by somebody else, and
 * access shouldn't follow the name to a new owner. That lookup needs the
 * visitor's own token, which is why it happens here rather than on the server.
 */
export default function EditorManager({
  open,
  onClose,
  channelName,
  invited,
  error,
  token,
  onAdd,
  onRemove,
}: Props) {
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const invite = async () => {
    const wanted = login.trim().toLowerCase();
    if (!wanted || !token) return;

    setBusy(true);
    setLookupError(null);
    try {
      const channel = await fetchChannel(wanted, token);
      onAdd({ id: channel.id, login: channel.login });
      setLogin("");
    } catch (problem) {
      setLookupError(
        problem instanceof Error
          ? problem.message
          : "Couldn't look that name up.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <WaDialog
      className="editor-manager"
      label="Who can edit this board"
      open={open}
      onWaHide={onClose}
      lightDismiss
    >
      <p className="text-sm">
        {channelName}&apos;s Twitch moderators can always edit — that list looks
        after itself. Anyone added here can edit too, whether they moderate or
        not.
      </p>

      <div className="editor-manager-add">
        <WaInput
          className="grow"
          placeholder="Twitch name"
          value={login}
          withClear
          onInput={(event) => setLogin(event.currentTarget.value ?? "")}
          onKeyDown={(event) => {
            if (event.key === "Enter") void invite();
          }}
        />
        <WaButton
          variant="brand"
          disabled={busy || !login.trim()}
          onClick={() => void invite()}
        >
          {busy ? <WaSpinner /> : "Invite"}
        </WaButton>
      </div>

      {(lookupError || error) && (
        <p className="text-sm text-red-400">{lookupError ?? error}</p>
      )}

      {invited.length === 0 ? (
        <p className="py-2 text-sm opacity-60">
          Nobody invited yet. Moderators can still edit.
        </p>
      ) : (
        <ul className="editor-list">
          {invited.map((editor) => (
            <li key={editor.id}>
              <span className="editor-list-name">
                {editor.login || editor.id}
              </span>
              <WaButton
                size="small"
                appearance="plain"
                variant="danger"
                onClick={() => onRemove(editor.id)}
              >
                Remove
              </WaButton>
            </li>
          ))}
        </ul>
      )}

      <p className="editor-manager-note">
        Removing someone drops them from the board straight away, mid-session.
      </p>

      <WaButton slot="footer" appearance="outlined" onClick={onClose}>
        Done
      </WaButton>
    </WaDialog>
  );
}
