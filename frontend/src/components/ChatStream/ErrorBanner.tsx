import { useSessionStore } from "@/store/sessionStore.ts";

interface ErrorBannerProps {
  errors?: string[];
  subtype?: string;
  bonsaiSid?: string;
}

export function ErrorBanner({ errors, subtype, bonsaiSid }: ErrorBannerProps) {
  const isContextOverflow = subtype === "context_overflow";

  const handleRetry = () => {
    if (bonsaiSid) {
      useSessionStore.getState().retryLastMessage(bonsaiSid);
    }
  };

  const handleFreshSession = () => {
    if (bonsaiSid) {
      // Use the existing continueDraft flow to create a fresh session
      useSessionStore.getState().continueSession(bonsaiSid);
    }
  };

  return (
    <div className="chat-banner chat-banner-error">
      <div className="chat-banner-title">
        {isContextOverflow
          ? "\u2715 Context window full"
          : `\u2715 Session error${subtype ? `: ${subtype}` : ""}`}
      </div>
      {isContextOverflow && (
        <div className="chat-banner-body">
          The conversation exceeded the model's context window.
        </div>
      )}
      {errors && errors.length > 0 && !isContextOverflow && (
        <ul className="chat-banner-errors">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
      {isContextOverflow && bonsaiSid && (
        <div className="chat-banner-actions">
          <button className="chat-banner-btn" onClick={handleRetry}>
            Retry
          </button>
          <button className="chat-banner-btn" onClick={handleFreshSession}>
            Start fresh session
          </button>
        </div>
      )}
    </div>
  );
}
