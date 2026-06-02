import { create } from "zustand";
import type { TrashedItem } from "@/types/trash.ts";
import { getClient } from "@/api/index.ts";
import { createTrashApi } from "@/api/methods/trash.ts";

interface TrashState {
  items: TrashedItem[];
  filter: string | null;
  isOpen: boolean;
  loading: boolean;
  setFilter: (type: string | null) => void;
  open: () => void;
  close: () => void;
  loadTrash: () => Promise<void>;
  restoreItem: (type: string, id: string) => Promise<void>;
  purgeItem: (type: string, id: string) => Promise<void>;
  emptyAll: () => Promise<void>;
}

export const useTrashStore = create<TrashState>((set, get) => ({
  items: [],
  filter: null,
  isOpen: false,
  loading: false,

  setFilter: (type) => set({ filter: type }),

  open: () => {
    set({ isOpen: true });
    get().loadTrash();
  },

  close: () => set({ isOpen: false }),

  loadTrash: async () => {
    set({ loading: true });
    try {
      const api = createTrashApi(getClient());
      const items = await api.list();
      set({ items, loading: false });
    } catch (e) {
      console.error("[trashStore] loadTrash error:", e);
      set({ loading: false });
    }
  },

  restoreItem: async (type, id) => {
    const api = createTrashApi(getClient());
    try {
      switch (type) {
        case "sessions":
          await api.restoreSession(id);
          break;
        case "tickets":
          await api.restoreTicket(id);
          break;
        case "specs":
          await api.restoreSpec(id);
          break;
        default:
          console.warn(`[trashStore] Unknown trash type: ${type}`);
          return;
      }
    } catch (e) {
      console.error(`[trashStore] restoreItem(${type}, ${id}) error:`, e);
    }
    await get().loadTrash();
  },

  purgeItem: async (type, id) => {
    try {
      const api = createTrashApi(getClient());
      await api.purge(type, id);
    } catch (e) {
      console.error(`[trashStore] purgeItem(${type}, ${id}) error:`, e);
    }
    await get().loadTrash();
  },

  emptyAll: async () => {
    try {
      const api = createTrashApi(getClient());
      const { filter } = get();
      await api.empty(filter ?? undefined);
    } catch (e) {
      console.error("[trashStore] emptyAll error:", e);
    }
    await get().loadTrash();
  },
}));
