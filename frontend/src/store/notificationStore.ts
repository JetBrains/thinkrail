import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncPref } from "./prefSync.ts";

interface Toast {
  id: string;
  bonsaiSid?: string;
  eventType: "question" | "approval" | "suggestion" | "notification" | "error" | "success";
  message: string;
  persistent: boolean;
  createdAt: number;
}

interface TabBadge {
  type: "question" | "approval" | "suggestion" | "done" | "error";
  pulsing: boolean;
}

interface NotificationStore {
  toasts: Toast[];
  tabBadges: Map<string, TabBadge>;
  pendingInputCount: number;
  soundEnabled: boolean;

  addToast: (
    toast: Omit<Toast, "id" | "createdAt">,
  ) => void;
  dismissToast: (id: string) => void;
  setBadge: (taskId: string, badge: TabBadge) => void;
  clearBadge: (taskId: string) => void;
  incrementPendingInput: () => void;
  decrementPendingInput: () => void;
  toggleSound: () => void;
}

let nextToastId = 1;

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set, get) => ({
      toasts: [],
      tabBadges: new Map(),
      pendingInputCount: 0,
      soundEnabled: false,

      addToast: (toast) => {
        const id = `toast-${nextToastId++}`;
        const newToast: Toast = { ...toast, id, createdAt: Date.now() };
        set((s) => ({
          toasts: [...s.toasts, newToast].slice(-5),
        }));

        if (!toast.persistent) {
          const duration = toast.eventType === "error" ? 8000
            : toast.eventType === "question" || toast.eventType === "approval" || toast.eventType === "suggestion" ? 10000
            : 5000;
          setTimeout(() => get().dismissToast(id), duration);
        }
      },

      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      setBadge: (taskId, badge) =>
        set((s) => {
          const next = new Map(s.tabBadges);
          next.set(taskId, badge);
          return { tabBadges: next };
        }),

      clearBadge: (taskId) =>
        set((s) => {
          const next = new Map(s.tabBadges);
          next.delete(taskId);
          return { tabBadges: next };
        }),

      incrementPendingInput: () =>
        set((s) => ({ pendingInputCount: s.pendingInputCount + 1 })),

      decrementPendingInput: () =>
        set((s) => ({
          pendingInputCount: Math.max(0, s.pendingInputCount - 1),
        })),

      toggleSound: () => set((s) => {
        const next = !s.soundEnabled;
        syncPref({ soundEnabled: next });
        return { soundEnabled: next };
      }),
    }),
    {
      name: "bonsai-notification-sound",
      partialize: (state) => ({ soundEnabled: state.soundEnabled }),
    },
  ),
);
