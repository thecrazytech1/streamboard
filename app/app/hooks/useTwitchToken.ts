"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "twitch_token";

export function useTwitchToken(): {
  token: string | null;
  logout: () => void;
} {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.hash.replace("#", "?"),
    );
    const granted = params.get("access_token");

    if (granted) {
      setToken(granted);
      localStorage.setItem(STORAGE_KEY, granted);


      window.location.hash = "";
      return;
    }



    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setToken(saved);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
  }, []);

  return { token, logout };
}
