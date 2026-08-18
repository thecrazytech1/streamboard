type AuthConfig = {
  clientId: string;
  allowed: Set<string>;
};

let cachedConfig: AuthConfig | null = null;

function config(): AuthConfig {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    clientId: process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID ?? "",
    allowed: new Set(
      (process.env.ALLOWED_USERS ?? "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  };

  return cachedConfig;
}

export type Identity = {
  userId: string;
  login: string;

  scopes: string[];
};


export const MODERATED_CHANNELS_SCOPE = "user:read:moderated_channels";

export async function validateToken(token: string): Promise<Identity | null> {
  let response: Response;
  try {
    response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${token}` },
    });
  } catch (error) {
    console.error("Twitch token validation failed:", error);
    return null;
  }

  if (!response.ok) return null;

  const json = (await response.json()) as {
    client_id?: string;
    login?: string;
    user_id?: string;
    scopes?: unknown;
  };

  if (!json.user_id) return null;
  if (json.client_id !== config().clientId) return null;

  return {
    userId: String(json.user_id),
    login: String(json.login ?? ""),
    scopes: Array.isArray(json.scopes) ? json.scopes.map(String) : [],
  };
}

const MODERATED_CHANNELS_URL =
  "https://api.twitch.tv/helix/moderation/channels";


const PAGE_SIZE = 100;

const MAX_PAGES = 5;


const VERDICT_TTL_MS = 5 * 60 * 1000;

const FAILURE_TTL_MS = 30 * 1000;

type Verdict = { ok: boolean; until: number };

const verdicts = new Map<string, Verdict>();

async function moderatedChannels(
  token: string,
  userId: string,
): Promise<Set<string> | null> {
  const found = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(MODERATED_CHANNELS_URL);
    url.searchParams.set("user_id", userId);
    url.searchParams.set("first", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("after", cursor);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": config().clientId,
        },
      });
    } catch (error) {
      console.error("Twitch moderated-channels request failed:", error);
      return null;
    }

    if (!response.ok) {
      console.error(
        `Twitch moderated-channels returned ${response.status} for ${userId}`,
      );
      return null;
    }

    let json: {
      data?: Array<{ broadcaster_id?: unknown }>;
      pagination?: { cursor?: unknown };
    };
    try {
      json = await response.json();
    } catch (error) {
      console.error("Twitch moderated-channels sent junk:", error);
      return null;
    }

    for (const row of json.data ?? []) {
      if (row?.broadcaster_id) found.add(String(row.broadcaster_id));
    }

    const next = json.pagination?.cursor;
    cursor = typeof next === "string" && next ? next : undefined;
    if (!cursor) break;
  }

  return found;
}

export type BoardAccess =
  | { ok: true; via: "override" | "broadcaster" | "moderator" }
  | { ok: false; reason: "unauthorised" | "scope" };

export async function authoriseForBoard(
  identity: Identity,
  token: string,
  channelId: string,
): Promise<BoardAccess> {
  const { allowed } = config();
  if (
    allowed.has(identity.userId.toLowerCase()) ||
    allowed.has(identity.login.toLowerCase())
  ) {
    return { ok: true, via: "override" };
  }



  if (!channelId) return { ok: false, reason: "unauthorised" };

  if (identity.userId === channelId) return { ok: true, via: "broadcaster" };

  if (!identity.scopes.includes(MODERATED_CHANNELS_SCOPE)) {
    return { ok: false, reason: "scope" };
  }

  const key = `${identity.userId}:${channelId}`;
  const cached = verdicts.get(key);
  if (cached && cached.until > Date.now()) {
    return cached.ok
      ? { ok: true, via: "moderator" }
      : { ok: false, reason: "unauthorised" };
  }

  const channels = await moderatedChannels(token, identity.userId);
  const ok = channels?.has(channelId) ?? false;

  verdicts.set(key, {
    ok,
    until: Date.now() + (channels ? VERDICT_TTL_MS : FAILURE_TTL_MS),
  });

  return ok
    ? { ok: true, via: "moderator" }
    : { ok: false, reason: "unauthorised" };
}

export function matchesKey(expected: string, candidate: unknown): boolean {
  if (!expected) return false;
  if (typeof candidate !== "string") return false;
  if (candidate.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
  }
  return diff === 0;
}


export function assertAuthConfig(): void {
  const { clientId, allowed } = config();

  if (!clientId) {
    throw new Error(
      `Missing required environment variable: NEXT_PUBLIC_TWITCH_CLIENT_ID. Refusing to ` +
      `start — every token would be rejected as minted for another app.`,
    );
  }

  console.log(
    `Editors: each channel's own broadcaster and moderators` +
    (allowed.size ? `, plus ${[...allowed].join(", ")} everywhere` : ""),
  );
}
