import { create } from "zustand";

const STORAGE_KEY = "bonsai_token";

interface TokenStore {
  token: string | null;
  isAdmin: boolean;
  setToken: (token: string | null) => void;
  setIsAdmin: (isAdmin: boolean) => void;
}

export const useTokenStore = create<TokenStore>((set) => ({
  token: localStorage.getItem(STORAGE_KEY),
  isAdmin: false,

  setToken: (token) => {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    set(token ? { token } : { token, isAdmin: false });
  },

  setIsAdmin: (isAdmin) => set({ isAdmin }),
}));
