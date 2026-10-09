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
import {
  EMBED_PROVIDERS,
  EMBED_PROVIDER_KEYS,
  embedName,
  parseEmbed,
  type EmbedProvider,
} from "../lib/embeds";
import { MAX_TEXT_LENGTH, TEXT_COLOURS } from "../lib/text";
import {
  ASPECT_PRESETS,
  SHAPE_KINDS,
  SHAPES,
  shapePreviewItem,
  type ShapeKind,
} from "../lib/shapes";
import BoardShape from "./BoardShape";
import {
  FILTER_KINDS,
  FILTER_SHAPES,
  FILTERS,
} from "../lib/filters";
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
        maxlength={MAX_TEXT_LENGTH}
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

/**
 * Live streams and clips, as embedded video.
 *
 * One box, because a url says which provider it is — and a bare Twitch name
 * works too, since that's what people have to hand when they're mid-stream and
 * not going to go and copy a link.
 */
/**
 * Shapes: pick one, pick a colour, pick proportions, drag it out.
 *
 * Proportions are chosen here rather than adjusted later because a placed item
 * can only be scaled uniformly — the handle changes `size`, and `aspect` is
 * fixed once it's down.
 */
function ShapePanel({ onPickUp }: { onPickUp: Props["onPickUp"] }) {
  const [color, setColor] = useState(TEXT_COLOURS[0]);
  const [outline, setOutline] = useState(false);
  const [aspect, setAspect] = useState(ASPECT_PRESETS[0].value);

  return (
    <div className="flex flex-col gap-3">
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

      <div className="flex items-center gap-2">
        {ASPECT_PRESETS.map((preset) => (
          <WaButton
            key={preset.label}
            size="small"
            appearance={aspect === preset.value ? "filled" : "outlined"}
            onClick={() => setAspect(preset.value)}
          >
            {preset.label}
          </WaButton>
        ))}
        <WaButton
          size="small"
          appearance={outline ? "filled" : "outlined"}
          onClick={() => setOutline((previous) => !previous)}
          title="Outline instead of a solid fill"
        >
          Outline
        </WaButton>
      </div>

      <p className="text-xs opacity-60">Drag one onto the canvas:</p>

      <div className="grid grid-cols-3 gap-1">
        {SHAPE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="shape-tile"
            title={SHAPES[kind].label}
            // pointerdown, like every other tile: the drag has to begin while
            // the button is still held.
            onPointerDown={(event) =>
              onPickUp(
                {
                  kind: "shape",
                  shape: kind,
                  color,
                  // A line or an arrow keeps its own proportions — a square
                  // arrow is a stub, and nobody means that.
                  aspect: SHAPES[kind].strokeOnly ? SHAPES[kind].aspect : aspect,
                  outline: SHAPES[kind].strokeOnly ? false : outline,
                  name: SHAPES[kind].label,
                },
                event,
              )
            }
          >
            <ShapePreview kind={kind} color={color} outline={outline} />
            <span className="emote-tile-name">{SHAPES[kind].label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A small square version of the shape, drawn the same way the board draws it. */
function ShapePreview({
  kind,
  color,
  outline,
}: {
  kind: ShapeKind;
  color: string;
  outline: boolean;
}) {
  return (
    <span className="shape-preview">
      <BoardShape
        item={shapePreviewItem({
          shape: kind,
          color,
          outline: SHAPES[kind].strokeOnly ? false : outline,
          aspect: 1,
          size: 48,
        })}
        width={48}
        height={48}
      />
    </span>
  );
}

/**
 * Filters: a region that alters whatever is stacked beneath it.
 *
 * Worth knowing while placing one — it affects board items below it in the
 * stacking order, so Front/Back decides what it catches. It does not reach
 * whatever OBS composites under the browser source.
 */
function FilterPanel({ onPickUp }: { onPickUp: Props["onPickUp"] }) {
  const [shape, setShape] = useState<string>("rect");
  const [strength, setStrength] = useState(1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {FILTER_SHAPES.map((option) => (
          <WaButton
            key={option}
            size="small"
            appearance={shape === option ? "filled" : "outlined"}
            onClick={() => setShape(option)}
          >
            {SHAPES[option as ShapeKind].label}
          </WaButton>
        ))}
      </div>

      <label className="filter-strength">
        <span className="overlay-setup-label">
          Strength — {Math.round(strength * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(strength * 100)}
          onChange={(event) => setStrength(Number(event.target.value) / 100)}
        />
      </label>

      <p className="text-xs opacity-60">Drag one onto the canvas:</p>

      <div className="grid grid-cols-2 gap-1">
        {FILTER_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="filter-tile"
            title={FILTERS[kind].hint}
            onPointerDown={(event) =>
              onPickUp(
                {
                  kind: "filter",
                  filter: kind,
                  // The slider is the override; each filter's own default is
                  // what reads well for that effect.
                  strength: strength,
                  shape,
                  aspect: 1,
                  name: FILTERS[kind].label,
                },
                event,
              )
            }
          >
            <span className="filter-tile-name">{FILTERS[kind].label}</span>
            <span className="filter-tile-hint">{FILTERS[kind].hint}</span>
          </button>
        ))}
      </div>

      <p className="text-xs opacity-60">
        A filter affects board items stacked below it — use Front and Back to
        choose what it catches. It can&apos;t reach anything OBS puts under the
        browser source, like a camera on its own layer.
      </p>
    </div>
  );
}

/**
 * The webcam, as a board item.
 *
 * The name is matched on the machine running the overlay, which is why this is
 * a free-text box rather than a list of devices: the cameras attached to
 * whatever you're editing from are not the ones that matter.
 */
function CameraPanel({ onPickUp }: { onPickUp: Props["onPickUp"] }) {
  const [device, setDevice] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <WaInput
        placeholder="Camera name, or leave blank for the first one"
        value={device}
        withClear
        onInput={(event) => setDevice(event.currentTarget.value ?? "")}
      />

      <p className="text-xs opacity-60">Drag onto the canvas:</p>

      <button
        type="button"
        className="embed-chip"
        onPointerDown={(event) =>
          onPickUp(
            {
              kind: "camera",
              device: device.trim(),
              aspect: 16 / 9,
              name: device.trim() || "Camera",
            },
            event,
          )
        }
      >
        {device.trim() || "Camera"}
      </button>

      <ul className="embed-hints">
        <li>
          The picture only appears on the overlay — here it&apos;s a
          placeholder, so position and filter it, then check OBS.
        </li>
        <li>
          OBS must be started with{" "}
          <code>--use-fake-ui-for-media-stream</code>, or the browser source is
          refused the camera without asking.
        </li>
        <li>
          Nothing else can hold the camera at the same time — not an OBS source,
          not another tab.
        </li>
      </ul>
    </div>
  );
}

function EmbedPanel({ onPickUp }: { onPickUp: Props["onPickUp"] }) {
  const [input, setInput] = useState("");
  const found = parseEmbed(input);

  return (
    <div className="flex flex-col gap-3">
      <WaInput
        placeholder="twitch.tv/somebody, a clip, or a YouTube link"
        value={input}
        withClear
        onInput={(event) => setInput(event.currentTarget.value ?? "")}
      />

      {found ? (
        <>
          <p className="text-xs opacity-60">
            {EMBED_PROVIDERS[found.provider].label} — drag onto the canvas:
          </p>
          {/* pointerdown, like every other tile: the pick-up has to begin while
              the button is held so it can follow the cursor out. */}
          <button
            type="button"
            className="embed-chip"
            onPointerDown={(event) =>
              onPickUp(
                {
                  kind: "embed",
                  provider: found.provider,
                  embedId: found.embedId,
                  aspect: EMBED_PROVIDERS[found.provider].aspect,
                  name: embedName(found.provider, found.embedId),
                },
                event,
              )
            }
          >
            {embedName(found.provider, found.embedId)}
          </button>
          <p className="text-xs opacity-60">
            It arrives muted. Unmute it from the item toolbar once it&apos;s
            placed — and remember the overlay&apos;s audio goes through OBS.
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="py-2 text-sm opacity-60">
            {input.trim()
              ? "That isn't a link this can embed."
              : "Paste a link, then drag it onto the canvas."}
          </p>
          <ul className="embed-hints">
            {EMBED_PROVIDER_KEYS.map((key: EmbedProvider) => (
              <li key={key}>
                <strong>{EMBED_PROVIDERS[key].label}</strong> —{" "}
                {EMBED_PROVIDERS[key].hint}
              </li>
            ))}
          </ul>
        </div>
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
      <WaTab panel="shapes">Shapes</WaTab>
      <WaTab panel="filters">Filters</WaTab>
      <WaTab panel="embeds">Streams</WaTab>
      <WaTab panel="camera">Camera</WaTab>

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

      <WaTabPanel name="shapes">
        <ShapePanel onPickUp={onPickUp} />
      </WaTabPanel>

      <WaTabPanel name="filters">
        <FilterPanel onPickUp={onPickUp} />
      </WaTabPanel>

      <WaTabPanel name="embeds">
        <EmbedPanel onPickUp={onPickUp} />
      </WaTabPanel>

      <WaTabPanel name="camera">
        <CameraPanel onPickUp={onPickUp} />
      </WaTabPanel>
    </WaTabGroup>
  );
}
