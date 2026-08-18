const REST_BASE = "https://7tv.io/v3";
const GQL_ENDPOINT = "https://7tv.io/v3/gql";

export type SevenTvEmote = {
  id: string;
  name: string;
  animated: boolean;
};


export type EmoteSize = 1 | 2 | 3 | 4;

export function emoteUrl(id: string, size: EmoteSize = 2): string {
  return `https://cdn.7tv.app/emote/${id}/${size}x.webp`;
}

type RestEmote = {
  id: string;
  name: string;
  data?: { animated?: boolean };
};

function toEmote(raw: RestEmote): SevenTvEmote {
  return { id: raw.id, name: raw.name, animated: Boolean(raw.data?.animated) };
}

export function emoteKey(emote: SevenTvEmote): string {
  return `${emote.id}:${emote.name}`;
}


function dedupe(emotes: SevenTvEmote[]): SevenTvEmote[] {
  const seen = new Set<string>();
  return emotes.filter((emote) => {
    const key = emoteKey(emote);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchGlobalEmotes(
  signal?: AbortSignal,
): Promise<SevenTvEmote[]> {
  const response = await fetch(`${REST_BASE}/emote-sets/global`, { signal });
  if (!response.ok) {
    throw new Error(`7TV global set request failed (${response.status})`);
  }

  const json = await response.json();
  return dedupe(((json.emotes ?? []) as RestEmote[]).map(toEmote));
}

export async function fetchChannelEmotes(
  twitchUserId: string,
  signal?: AbortSignal,
): Promise<SevenTvEmote[]> {
  const response = await fetch(`${REST_BASE}/users/twitch/${twitchUserId}`, {
    signal,
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`7TV channel lookup failed (${response.status})`);
  }

  const json = await response.json();
  return dedupe(((json.emote_set?.emotes ?? []) as RestEmote[]).map(toEmote));
}

const SEARCH_QUERY = `
  query SearchEmotes($query: String!, $limit: Int) {
    emotes(query: $query, limit: $limit) {
      items {
        id
        name
        animated
      }
    }
  }
`;

export async function searchEmotes(
  query: string,
  signal?: AbortSignal,
): Promise<SevenTvEmote[]> {
  const response = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: SEARCH_QUERY,
      variables: { query, limit: 60 },
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`7TV search failed (${response.status})`);
  }

  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "7TV search rejected the query");
  }

  const items = (json.data?.emotes?.items ?? []) as Array<{
    id: string;
    name: string;
    animated?: boolean;
  }>;

  return dedupe(
    items.map((item) => ({
      id: item.id,
      name: item.name,
      animated: Boolean(item.animated),
    })),
  );
}
