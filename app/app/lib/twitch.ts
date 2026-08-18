export const CLIENT_ID = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;

export type TwitchChannel = {
  id: string;
  login: string;
  name: string;
};

async function helix(
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: { "Client-ID": CLIENT_ID, Authorization: `Bearer ${token}` },
    signal,
  });

  if (response.status === 401) {
    throw new Error("Your Twitch session has expired.");
  }
  if (!response.ok) {
    throw new Error("Twitch wouldn't answer just now — try again shortly.");
  }

  return response.json();
}


export async function fetchSelf(
  token: string,
  signal?: AbortSignal,
): Promise<TwitchChannel> {
  const body = (await helix("users", token, signal)) as {
    data?: Array<{ id?: string; login?: string; display_name?: string }>;
  };
  const self = body.data?.[0];

  if (!self?.id) throw new Error("Twitch didn't say who you are.");

  return {
    id: String(self.id),
    login: String(self.login ?? ""),
    name: String(self.display_name ?? self.login ?? ""),
  };
}

export async function fetchModeratedChannels(
  token: string,
  userId: string,
  signal?: AbortSignal,
): Promise<TwitchChannel[]> {
  const body = (await helix(
    `moderation/channels?user_id=${encodeURIComponent(userId)}&first=100`,
    token,
    signal,
  )) as {
    data?: Array<{
      broadcaster_id?: string;
      broadcaster_login?: string;
      broadcaster_name?: string;
    }>;
  };

  return (body.data ?? [])
    .filter((row) => row.broadcaster_id && row.broadcaster_login)
    .map((row) => ({
      id: String(row.broadcaster_id),
      login: String(row.broadcaster_login),
      name: String(row.broadcaster_name ?? row.broadcaster_login),
    }));
}

export async function fetchChannel(
  login: string,
  token: string,
  signal?: AbortSignal,
): Promise<TwitchChannel> {
  const body = (await helix(
    `users?login=${encodeURIComponent(login)}`,
    token,
    signal,
  )) as {
    data?: Array<{ id?: string; login?: string; display_name?: string }>;
  };
  const found = body.data?.[0];

  if (!found?.id) throw new Error(`There's no Twitch channel called ${login}.`);

  return {
    id: String(found.id),
    login: String(found.login ?? login),
    name: String(found.display_name ?? found.login ?? login),
  };
}
