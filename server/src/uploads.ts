import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";


export const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? "./uploads");
export const UPLOAD_ROUTE = "/uploads";


export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const UPLOAD_NAME_PATTERN = /^[0-9a-f]{64}\.(?:png|jpg|gif|webp)$/;
const MAX_SRC_LENGTH = 2048;
let totalBytes = 0;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const FORMATS: Array<{ ext: string; matches: (bytes: Buffer) => boolean }> = [
  { ext: "png", matches: (bytes) => bytes.subarray(0, 8).equals(PNG_MAGIC) },
  {
    ext: "gif",
    matches: (bytes) => {
      const tag = bytes.subarray(0, 6).toString("latin1");
      return tag === "GIF87a" || tag === "GIF89a";
    },
  },
  {
    ext: "jpg",
    matches: (bytes) =>
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    ext: "webp",
    matches: (bytes) =>
      bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
      bytes.subarray(8, 12).toString("latin1") === "WEBP",
  },
];


function sniffExtension(bytes: Buffer): string | null {

  if (bytes.length < 12) return null;
  return FORMATS.find((format) => format.matches(bytes))?.ext ?? null;
}

export type StoreResult =
  | { ok: true; src: string }
  | { ok: false; status: number; error: string };

export function storeUpload(bytes: Buffer): StoreResult {
  if (bytes.length === 0) {
    return { ok: false, status: 400, error: "That upload was empty." };
  }

  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: "That image is over 8 MB." };
  }

  const ext = sniffExtension(bytes);
  if (!ext) {
    return {
      ok: false,
      status: 415,
      error: "That isn't a PNG, JPEG, GIF or WebP.",
    };
  }

  const name = `${createHash("sha256").update(bytes).digest("hex")}.${ext}`;
  const path = join(UPLOAD_DIR, name);
  const src = `${UPLOAD_ROUTE}/${name}`;




  if (existsSync(path)) {
    const now = new Date();
    try {
      utimesSync(path, now, now);
    } catch {

    }
    return { ok: true, src };
  }

  if (totalBytes + bytes.length > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      status: 507,
      error: "Image storage is full — remove some images from the board.",
    };
  }

  writeFileSync(path, bytes);
  totalBytes += bytes.length;
  return { ok: true, src };
}


export function isUploadSrc(src: string): boolean {
  const prefix = `${UPLOAD_ROUTE}/`;
  return (
    src.startsWith(prefix) && UPLOAD_NAME_PATTERN.test(src.slice(prefix.length))
  );
}

export function cleanImageSrc(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > MAX_SRC_LENGTH) return "";
  if (isUploadSrc(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  return url.href;
}


export function initUploads(): void {
  mkdirSync(UPLOAD_DIR, { recursive: true });

  totalBytes = 0;
  let count = 0;
  for (const name of readdirSync(UPLOAD_DIR)) {
    try {
      totalBytes += statSync(join(UPLOAD_DIR, name)).size;
      count += 1;
    } catch {

    }
  }

  console.log(
    `Uploads: ${count} file(s), ${(totalBytes / 1e6).toFixed(1)} MB in ${UPLOAD_DIR}`,
  );
}

export function sweepOrphans(liveSrcs: Set<string>): void {
  let names: string[];
  try {
    names = readdirSync(UPLOAD_DIR);
  } catch {
    return;
  }

  const cutoff = Date.now() - ORPHAN_GRACE_MS;

  for (const name of names) {
    if (!UPLOAD_NAME_PATTERN.test(name)) continue;
    if (liveSrcs.has(`${UPLOAD_ROUTE}/${name}`)) continue;

    const path = join(UPLOAD_DIR, name);
    try {
      const stats = statSync(path);
      if (stats.mtimeMs > cutoff) continue;
      unlinkSync(path);
      totalBytes = Math.max(0, totalBytes - stats.size);
      console.log(`Swept unreferenced upload ${name}`);
    } catch {

    }
  }
}
