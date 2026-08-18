import { SERVER_URL } from "../../utils/socket";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ACCEPTED_MIME = "image/png,image/jpeg,image/gif,image/webp";

export function resolveImageSrc(src: string): string {
  return src.startsWith("/") ? `${SERVER_URL}${src}` : src;
}

export function measureAspect(src: string): Promise<number> {
  return new Promise((resolve, reject) => {



    const image = new Image();

    image.onload = () => {


      resolve(image.naturalHeight > 0
        ? image.naturalWidth / image.naturalHeight
        : 1);
    };
    image.onerror = () =>
      reject(new Error("Couldn't load that image — check the link."));

    image.src = src;
  });
}

export type AddedImage = {

  src: string;
  aspect: number;
  name: string;
};

export async function uploadImage(
  file: File,
  token: string,
  board: string,
): Promise<AddedImage> {


  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name} is over 8 MB.`);
  }

  const response = await fetch(
    `${SERVER_URL}/uploads?board=${encodeURIComponent(board)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    },
  );

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null);
    throw new Error(detail ?? `Upload failed (${response.status}).`);
  }

  const { src } = (await response.json()) as { src: string };

  return {
    src,
    aspect: await measureAspect(resolveImageSrc(src)),
    name: file.name.replace(/\.[^.]+$/, "").slice(0, 64) || "image",
  };
}

export async function addImageByUrl(input: string): Promise<AddedImage> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("That doesn't look like a link.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https links work here.");
  }

  return {
    src: url.href,


    aspect: await measureAspect(url.href),
    name:
      decodeURIComponent(url.pathname.split("/").pop() ?? "")
        .replace(/\.[^.]+$/, "")
        .slice(0, 64) || url.hostname,
  };
}

const LIBRARY_KEY = "board_image_library";


const LIBRARY_LIMIT = 24;

const EMPTY: readonly AddedImage[] = [];
let cache: readonly AddedImage[] | null = null;

const listeners = new Set<() => void>();


function read(): readonly AddedImage[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LIBRARY_KEY);
  } catch {
    return EMPTY;
  }
  if (!raw) return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(parsed)) return EMPTY;

  return parsed
    .filter(
      (entry): entry is AddedImage =>
        typeof entry?.src === "string" && entry.src.length > 0,
    )
    .map((entry) => ({
      src: entry.src,
      aspect:
        Number.isFinite(entry.aspect) && entry.aspect > 0 ? entry.aspect : 1,
      name: String(entry.name ?? ""),
    }))
    .slice(0, LIBRARY_LIMIT);
}

function commit(next: readonly AddedImage[]): void {
  cache = next;
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  } catch {

  }
  for (const listener of listeners) listener();
}

export function subscribeToLibrary(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getLibrary(): readonly AddedImage[] {
  cache ??= read();
  return cache;
}


export function getServerLibrary(): readonly AddedImage[] {
  return EMPTY;
}


export function rememberImage(image: AddedImage): void {
  commit(
    [image, ...getLibrary().filter((entry) => entry.src !== image.src)].slice(
      0,
      LIBRARY_LIMIT,
    ),
  );
}

export function forgetImage(src: string): void {
  commit(getLibrary().filter((entry) => entry.src !== src));
}
