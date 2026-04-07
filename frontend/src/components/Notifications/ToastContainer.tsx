import { useNotificationStore } from "@/store/notificationStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import "./ToastContainer.css";

const EVENT_COLORS: Record<string, string> = {
  question: "var(--purple)",
  approval: "var(--gold)",
  success: "var(--green)",
  error: "var(--red)",
  notification: "var(--blue)",
};

export function ToastContainer() {
  const toasts = useNotificationStore((s) => s.toasts);
  const dismiss = useNotificationStore((s) => s.dismissToast);
  const focusSession = useSessionStore((s) => s.focusSession);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast"
          style={{ borderLeftColor: EVENT_COLORS[toast.eventType] ?? "var(--border)" }}
          onClick={() => {
            if (toast.bonsaiSid) focusSession(toast.bonsaiSid);
            dismiss(toast.id);
          }}
        >
          <div className="toast-message">{toast.message}</div>
          <button
            className="toast-dismiss"
            onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
          >
            {"\u00D7"}
          </button>
        </div>
      ))}
    </div>
  );
}
