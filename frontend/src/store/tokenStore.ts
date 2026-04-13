import { create } from "zustand";

const STORAGE_KEY = "bonsai_token";

interface TokenStore {
  token: string | null;
  setToken: (token: string | null) => void;
}

export const useTokenStore = create<TokenStore>((set) => ({
  token: localStorage.getItem(STORAGE_KEY),

  setToken: (token) => {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    set({ token });
  },
}));
