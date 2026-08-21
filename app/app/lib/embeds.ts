/**
 * Embedded video: a live channel or a clip, rendered as an iframe board item.
 *
 * An item never stores a url. It stores a provider and an id, and the url is
 * built here from a template — which is the whole security model. An iframe
 * lands on the streamer's overlay and in every editor's browser, so an arbitrary
 * one would mean anybody who can edit a board can put any page on someone's
 * stream: audio they don't control, a DMCA strike, or worse. A provider and an
 * id that has to match a pattern can only ever produce a url we wrote.
 */

export type EmbedProvider = "twitch-channel" | "twitch-clip" | "youtube";

type ProviderSpec = {
  label: string;
  /** What to ask for, in the words the person typing already thinks in. */
  hint: string;
  /**
   * Ids go in urls and come from clients, so each provider only accepts the
   * shape its own ids actually take.
   */
  pattern: RegExp;
  /** Width ÷ height. Video is 16:9; a portrait clip still letterboxes into it. */
  aspect: number;
  build: (id: string, parent: string, muted: boolean) => string;
};

/** Twitch logins: letters, digits and underscores. */
const TWITCH_LOGIN = /^[a-zA-Z0-9_]{3,25}$/;
/** Clip slugs, as they appear after /clip/. */
const TWITCH_SLUG = /^[A-Za-z0-9_-]{5,120}$/;
/** YouTube video ids are exactly 11 url-safe characters. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export const EMBED_PROVIDERS: Record<EmbedProvider, ProviderSpec> = {
  "twitch-channel": {
    label: "Twitch channel",
    hint: "twitch.tv/somebody, or just their name",
    pattern: TWITCH_LOGIN,
    aspect: 16 / 9,
    build: (id, parent, muted) =>
      `https://player.twitch.tv/?${new URLSearchParams({
        channel: id,
        parent,
        autoplay: "true",
        muted: String(muted),
      })}`,
  },
  "twitch-clip": {
    label: "Twitch clip",
    hint: "a clips.twitch.tv link, or …/clip/SlugHere",
    pattern: TWITCH_SLUG,
    aspect: 16 / 9,
    build: (id, parent, muted) =>
      `https://clips.twitch.tv/embed?${new URLSearchParams({
        clip: id,
        parent,
        autoplay: "true",
        muted: String(muted),
      })}`,
  },
  youtube: {
    label: "YouTube",
    hint: "a youtube.com/watch or youtu.be link",
    pattern: YOUTUBE_ID,
    aspect: 16 / 9,
    build: (id, _parent, muted) =>
      // nocookie: the overlay is on someone's stream, and there's no reason for
      // this to set tracking cookies against viewers who never chose to load it.
      `https://www.youtube-nocookie.com/embed/${id}?${new URLSearchParams({
        autoplay: "1",
        mute: muted ? "1" : "0",
        playsinline: "1",
      })}`,
  },
};

export const EMBED_PROVIDER_KEYS = Object.keys(
  EMBED_PROVIDERS,
) as EmbedProvider[];

export type Embed = { provider: EmbedProvider; embedId: string };

/** True when the pair is one this code could actually build a url from. */
export function isValidEmbed(
  provider: string,
  embedId: string,
): provider is EmbedProvider {
  const spec = EMBED_PROVIDERS[provider as EmbedProvider];
  return spec !== undefined && spec.pattern.test(embedId);
}

/**
 * Reads what somebody pasted or typed.
 *
 * Accepts a full url or a bare Twitch name, because both are what people have
 * to hand — a bare name is unambiguous enough to be worth allowing, since
 * nothing else here is a plain word.
 */
export function parseEmbed(input: string): Embed | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A bare Twitch login, the common case when someone types rather than pastes.
  if (TWITCH_LOGIN.test(trimmed)) {
    return { provider: "twitch-channel", embedId: trimmed.toLowerCase() };
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "clips.twitch.tv" && parts[0]) {
    const slug = parts[0] === "embed" ? (url.searchParams.get("clip") ?? "") : parts[0];
    return TWITCH_SLUG.test(slug)
      ? { provider: "twitch-clip", embedId: slug }
      : null;
  }

  if (host === "twitch.tv" || host === "m.twitch.tv") {
    // …/somebody/clip/SlugHere
    const clipAt = parts.indexOf("clip");
    if (clipAt >= 0 && parts[clipAt + 1] && TWITCH_SLUG.test(parts[clipAt + 1])) {
      return { provider: "twitch-clip", embedId: parts[clipAt + 1] };
    }
    if (parts[0] && TWITCH_LOGIN.test(parts[0])) {
      return { provider: "twitch-channel", embedId: parts[0].toLowerCase() };
    }
    return null;
  }

  if (host === "youtu.be" && parts[0] && YOUTUBE_ID.test(parts[0])) {
    return { provider: "youtube", embedId: parts[0] };
  }

  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    // /watch?v=, /embed/<id>, /live/<id>, /shorts/<id>
    const fromQuery = url.searchParams.get("v") ?? "";
    if (YOUTUBE_ID.test(fromQuery)) {
      return { provider: "youtube", embedId: fromQuery };
    }
    const last = parts[parts.length - 1] ?? "";
    if (YOUTUBE_ID.test(last)) return { provider: "youtube", embedId: last };
    return null;
  }

  return null;
}

/** The iframe src for a placed embed, or null if the item can't be built. */
export function embedUrl(
  provider: string,
  embedId: string,
  parent: string,
  muted: boolean,
): string | null {
  if (!isValidEmbed(provider, embedId)) return null;
  return EMBED_PROVIDERS[provider].build(embedId, parent, muted);
}

/** What to call it on the board, before anyone renames it. */
export function embedName(provider: EmbedProvider, embedId: string): string {
  return provider === "twitch-channel" ? embedId : EMBED_PROVIDERS[provider].label;
}
