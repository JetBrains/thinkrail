import { useEffect } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import * as draftAutosave from "@/store/draftAutosave.ts";

/** Flush the active session's draft when the page is hidden, so a reload or
 *  backgrounding captures the unsaved typed tail.
 *
 *  `visibilitychange→hidden` fires earlier and more reliably than
 *  `beforeunload` (which mobile/bfcache often skip); `pagehide` covers the
 *  bfcache path. The flush goes over the WebSocket and cannot block unload —
 *  the last sub-debounce window of typing before a hard kill may not arrive. */
export function useDraftFlushOnHide(): void {
  useEffect(() => {
    const flushActive = () => {
      const sid = useSessionStore.getState().activeSessionId;
      if (sid) void draftAutosave.flush(sid);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushActive();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flushActive);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flushActive);
    };
  }, []);
}
