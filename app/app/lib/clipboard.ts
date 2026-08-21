import { parseEmbed, type Embed } from "./embeds";

export type PastePayload =
  | { kind: "file"; file: File }
  | { kind: "url"; url: string }
  /** A link to a stream or clip we can embed, recognised before the image try. */
  | { kind: "embed"; embed: Embed }
  | { kind: "text"; text: string };

export const MAX_PASTED_TEXT = 100;

function httpUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
}


function imageInHtml(html: string): string | null {




  const src = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector("img")
    ?.getAttribute("src");

  return src ? httpUrl(src) : null;
}


const isGif = (url: string) =>
  new URL(url).pathname.toLowerCase().endsWith(".gif");

export function readClipboard(data: DataTransfer | null): PastePayload | null {
  if (!data) return null;

  const file = [...data.files].find((entry) => entry.type.startsWith("image/"));
  const embedded = imageInHtml(data.getData("text/html"));
  const text = data.getData("text/plain").trim();

  if (file && !(embedded && isGif(embedded))) return { kind: "file", file };
  if (embedded) return { kind: "url", url: embedded };

  const pastedUrl = text && httpUrl(text);
  if (pastedUrl) {
    // Checked before treating it as an image: a twitch.tv link would otherwise
    // fail to decode and come back as "that link isn't an image".
    const embed = parseEmbed(pastedUrl);
    if (embed) return { kind: "embed", embed };
    return { kind: "url", url: pastedUrl };
  }

  return text ? { kind: "text", text } : null;
}
