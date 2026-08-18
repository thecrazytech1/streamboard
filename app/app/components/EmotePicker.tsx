"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  WaButton,
  WaInput,
  WaSpinner,
  WaTab,
  WaTabGroup,
  WaTabPanel,
} from "@awesome.me/webawesome/dist/react";
import {
  emoteKey,
  emoteUrl,
  fetchChannelEmotes,
  fetchGlobalEmotes,
  searchEmotes,
  type SevenTvEmote,
} from "../lib/sevenTv";
import {
  ACCEPTED_MIME,
  addImageByUrl,
  forgetImage,
  getLibrary,
  getServerLibrary,
  rememberImage,
  resolveImageSrc,
  subscribeToLibrary,
  uploadImage,
} from "../lib/images";
import type { DraggableItem } from "@/types/board";

type Props = {
  channelId: string;
  channelName: string;
  revision: number;
  
  token: string | null;
  
  board: string;
  onPickUp: (item: DraggableItem, event: React.PointerEvent) => void;
};

type ListState = {
  emotes: SevenTvEmote[];
  loading: boolean;
  error: string | null;
};

const IDLE: ListState = { emotes: [], loading: false, error: null };
const LOADING: ListState = { emotes: [], loading: true, error: null };

type Loader = (signal: AbortSignal) => Promise<SevenTvEmote[]>;

function useEmoteList(load: Loader | null, revision = 0): ListState {
  const [result, setResult] = useState<{
    source: Loader;
    revision: number;
    emotes: SevenTvEmote[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!load) return;

    const controller = new AbortController();

    load(controller.signal)
      .then((emotes) =>
        setResult({ source: load, revision, emotes, error: null }),
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResult({
          source: load,
          revision,
          emotes: [],
          error: error instanceof Error ? error.message : "Something went wrong",
        });
      });

    return () => controller.abort();
  }, [load, revision]);

  if (!load) return IDLE;


  if (!result || result.source !== load) return LOADING;



  if (result.revision !== revision) {
    return { emotes: result.emotes, loading: true, error: null };
  }

  return { emotes: result.emotes, loading: false, error: result.error };
}

function EmoteGrid({
  state,
  emptyMessage,
  onPickUp,
}: {
  state: ListState;
  emptyMessage: string;
  onPickUp: Props["onPickUp"];
}) {


  if (state.loading && state.emotes.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <WaSpinner style={{ fontSize: "2rem" }} />
      </div>
    );
  }

  if (state.error) {
    return <p className="py-6 text-sm text-red-400">{state.error}</p>;
  }

  if (state.emotes.length === 0) {
    return <p className="py-6 text-sm opacity-60">{emptyMessage}</p>;
  }

  return (
    <div
      className={`grid grid-cols-4 gap-1${
        state.loading ? " opacity-60 transition-opacity" : ""
      }`}
    >
      {state.emotes.map((emote) => (
        <button

          key={emoteKey(emote)}
          type="button"
          title={emote.name}
          className="emote-tile"


          onPointerDown={(event) =>
            onPickUp(
              { kind: "emote", emoteId: emote.id, name: emote.name },
              event,
            )
          }
        >
          {}
          <img src={emoteUrl(emote.id, 2)} alt={emote.name} draggable={false} />
          <span className="emote-tile-name">{emote.name}</span>
        </button>
      ))}
    </div>
  );
}


const TEXT_COLOURS = [
  "#ffffff",
  "#9146ff",
  "#00e701",
  "#ffd400",
  "#ff5c5c",
  "#000000",
];

function TextPanel({ onPickUp }: { onPickUp: Props["onPickUp"] }) {
  const [text, setText] = useState("");
  const [color, setColor] = useState(TEXT_COLOURS[0]);
  const trimmed = text.trim();

  return (
    <div className="flex flex-col gap-3">
      <WaInput
        placeholder="Type something…"
        value={text}
        withClear
        maxlength={100}
        onInput={(event) => setText(event.currentTarget.value ?? "")}
      />

      <div className="flex items-center gap-2">
        {TEXT_COLOURS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`text-swatch${color === swatch ? " is-active" : ""}`}
            style={{ background: swatch }}
            aria-label={`Use ${swatch}`}
            aria-pressed={color === swatch}
            onClick={() => setColor(swatch)}
          />
        ))}
      </div>

      {trimmed ? (
        <>
          <p className="text-xs opacity-60">Drag onto the canvas:</p>
          <button
            type="button"
            className="text-chip"
            style={{ color }}
            onPointerDown={(event) =>
              onPickUp({ kind: "text", text: trimmed, color }, event)
            }
          >
            {trimmed}
          </button>
        </>
      ) : (
        <p className="py-2 text-sm opacity-60">
          Type some text, then drag it onto the canvas.
        </p>
      )}
    </div>
  );
}

function ImagePanel({
  token,
  board,
  onPickUp,
}: {
  token: Props["token"];
  board: Props["board"];
  onPickUp: Props["onPickUp"];
}) {


  const library = useSyncExternalStore(
    subscribeToLibrary,
    getLibrary,
    getServerLibrary,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOver, setIsOver] = useState(false);
  const [url, setUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = async (dropped: File[]) => {
    const files = dropped.filter((file) => file.type.startsWith("image/"));

    if (files.length === 0) {

      if (dropped.length > 0) setError("That isn't an image file.");
      return;
    }

    if (!token) {
      setError("Sign in with Twitch to upload images.");
      return;
    }

    setBusy(true);
    setError(null);
    let failure: string | null = null;



    for (const file of files) {
      try {
        rememberImage(await uploadImage(file, token, board));
      } catch (problem) {
        failure = problem instanceof Error ? problem.message : "Upload failed.";
      }
    }

    setBusy(false);
    setError(failure);
  };

  const addUrl = async () => {
    if (!url.trim()) return;

    setBusy(true);
    setError(null);
    try {
      rememberImage(await addImageByUrl(url));
      setUrl("");
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Couldn't add that link.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className={`image-drop${isOver ? " is-over" : ""}`}
        onClick={() => fileInput.current?.click()}
        onDragOver={(event) => {

          event.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsOver(false);
          void addFiles([...event.dataTransfer.files]);
        }}
      >
        {busy ? (
          <WaSpinner style={{ fontSize: "1.5rem" }} />
        ) : (
          <>
            <span className="image-drop-title">Drop images here</span>
            <span className="image-drop-hint">
              or click to browse — PNG, JPEG, GIF or WebP, up to 8 MB
            </span>
          </>
        )}
      </button>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_MIME}
        multiple
        hidden
        onChange={(event) => {
          void addFiles([...(event.target.files ?? [])]);

          event.target.value = "";
        }}
      />

      <div className="flex items-center gap-2">
        <WaInput
          className="grow"
          placeholder="…or paste an image link"
          value={url}
          withClear
          onInput={(event) => setUrl(event.currentTarget.value ?? "")}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addUrl();
          }}
        />
        <WaButton
          variant="neutral"
          disabled={busy || !url.trim()}
          onClick={() => void addUrl()}
        >
          Add
        </WaButton>
      </div>

      <p className="text-xs opacity-60">
        Or press Ctrl+V on the board to paste an image, a link or some text
        straight onto the canvas, under your pointer.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {library.length === 0 ? (
        <p className="py-2 text-sm opacity-60">
          Images you add show up here, ready to drag onto the canvas.
        </p>
      ) : (
        <>
          <p className="text-xs opacity-60">
            Drag onto the canvas. Removing one here only takes it out of this
            list — it stays on the board.
          </p>
          <div className={`grid grid-cols-3 gap-1${busy ? " opacity-60" : ""}`}>
            {library.map((image) => (
              <div key={image.src} className="image-tile">
                <button
                  type="button"
                  title={image.name}
                  className="emote-tile"


                  onPointerDown={(event) =>
                    onPickUp(
                      {
                        kind: "image",
                        src: image.src,
                        aspect: image.aspect,
                        name: image.name,
                      },
                      event,
                    )
                  }
                >
                  {}
                  <img
                    src={resolveImageSrc(image.src)}
                    alt={image.name}
                    draggable={false}
                  />
                  <span className="emote-tile-name">{image.name}</span>
                </button>

                <button
                  type="button"
                  className="image-tile-remove"
                  aria-label={`Remove ${image.name} from your images`}

                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => forgetImage(image.src)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function EmotePicker({
  channelId,
  channelName,
  revision,
  token,
  board,
  onPickUp,
}: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const loadGlobal = useCallback(
    (signal: AbortSignal) => fetchGlobalEmotes(signal),
    [],
  );

  const loadChannel = useCallback(
    (signal: AbortSignal) => fetchChannelEmotes(channelId, signal),
    [channelId],
  );

  const loadSearch = useCallback(
    (signal: AbortSignal) => searchEmotes(debouncedQuery, signal),
    [debouncedQuery],
  );

  const global = useEmoteList(loadGlobal);
  const channel = useEmoteList(loadChannel, revision);
  const search = useEmoteList(debouncedQuery ? loadSearch : null);

  return (
    <WaTabGroup className="emote-picker">
      <WaTab panel="global">Global</WaTab>
      <WaTab panel="channel">{channelName}</WaTab>
      <WaTab panel="search">Search</WaTab>
      <WaTab panel="images">Images</WaTab>
      <WaTab panel="text">Text</WaTab>

      <WaTabPanel name="global">
        <EmoteGrid
          state={global}
          emptyMessage="No global emotes came back."
          onPickUp={onPickUp}
        />
      </WaTabPanel>

      <WaTabPanel name="channel">
        <EmoteGrid
          state={channel}
          emptyMessage={`${channelName} has no 7TV emotes.`}
          onPickUp={onPickUp}
        />
      </WaTabPanel>

      <WaTabPanel name="search">
        <WaInput
          placeholder="Search 7TV…"
          value={query}
          withClear
          onInput={(event) => setQuery(event.currentTarget.value ?? "")}
        />
        <div className="mt-3">
          {debouncedQuery ? (
            <EmoteGrid
              state={search}
              emptyMessage={`Nothing matched “${debouncedQuery}”.`}
              onPickUp={onPickUp}
            />
          ) : (
            <p className="py-6 text-sm opacity-60">
              Type to search all of 7TV.
            </p>
          )}
        </div>
      </WaTabPanel>

      <WaTabPanel name="images">
        <ImagePanel token={token} board={board} onPickUp={onPickUp} />
      </WaTabPanel>

      <WaTabPanel name="text">
        <TextPanel onPickUp={onPickUp} />
      </WaTabPanel>
    </WaTabGroup>
  );
}
