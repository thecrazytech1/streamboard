"use client";

import { WaButton } from "@awesome.me/webawesome/dist/react";
import TwitchLogin from "./TwitchLogin";

type TwitchUser = {
  display_name: string;
  profile_image_url: string;
};

type Props = {
  user: TwitchUser | null;
  loading: boolean;
  onLogout: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  
  canClear: boolean;
  onClear: () => void;
  onOpenLayouts: () => void;
  
  layoutCount: number;
  
  onOpenOverlay: () => void;
  /** Absent for anyone who can't change the board's editor list. */
  onOpenEditors?: () => void;
};

export default function Navbar({
  user,
  loading,
  onLogout,
  onZoomIn,
  onZoomOut,
  onResetView,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canClear,
  onClear,
  onOpenLayouts,
  layoutCount,
  onOpenOverlay,
  onOpenEditors,
}: Props) {
  return (
    <nav className="app-navbar">
      <div className="app-navbar-group" aria-label="History">
        <WaButton
          size="small"
          appearance="plain"
          disabled={!canUndo}
          onClick={onUndo}
          title="Undo  Ctrl+Z"
        >
          Undo
        </WaButton>
        <WaButton
          size="small"
          appearance="plain"
          disabled={!canRedo}
          onClick={onRedo}
          title="Redo  Ctrl+Shift+Z"
        >
          Redo
        </WaButton>
        <WaButton
          size="small"
          appearance="plain"
          variant="danger"
          disabled={!canClear}
          onClick={onClear}
          title="Remove every item from the board"
        >
          Clear
        </WaButton>
      </div>

      <div className="app-navbar-group" aria-label="Layouts">
        <WaButton
          size="small"
          appearance="plain"
          onClick={onOpenLayouts}
          title="Save and load board arrangements"
        >
          Layouts{layoutCount > 0 && ` (${layoutCount})`}
        </WaButton>
        <WaButton
          size="small"
          appearance="plain"
          onClick={onOpenOverlay}
          title="Get the OBS browser source url for this board"
        >
          OBS
        </WaButton>
        {onOpenEditors && (
          <WaButton
            size="small"
            appearance="plain"
            onClick={onOpenEditors}
            title="Choose who can edit this board"
          >
            People
          </WaButton>
        )}
      </div>

      <div className="app-navbar-group" aria-label="Canvas zoom">
        <WaButton size="small" appearance="plain" onClick={onZoomOut}>
          −
        </WaButton>
        <WaButton size="small" appearance="plain" onClick={onResetView}>
          Fit
        </WaButton>
        <WaButton size="small" appearance="plain" onClick={onZoomIn}>
          +
        </WaButton>
      </div>

      <div className="app-navbar-group">
        {loading && <span className="text-xs opacity-60">Loading…</span>}

        {user ? (
          <>
            {}
            <img
              className="app-navbar-avatar"
              src={user.profile_image_url}
              alt=""
            />
            <span className="text-sm">{user.display_name}</span>
            <WaButton size="small" appearance="plain" onClick={onLogout}>
              Log out
            </WaButton>
          </>
        ) : (
          !loading && <TwitchLogin />
        )}
      </div>
    </nav>
  );
}
