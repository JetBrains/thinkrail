import "./StaleRefsBanner.css";

interface StaleRefsBannerProps {
  message: string;
  onFix: () => void;
  actionLabel?: string;
}

export function StaleRefsBanner({ message, onFix, actionLabel = "Clean up" }: StaleRefsBannerProps) {
  return (
    <div className="stale-refs-banner">
      <span className="stale-refs-banner-text">{message}</span>
      <button className="stale-refs-banner-action" onClick={onFix}>
        {actionLabel}
      </button>
    </div>
  );
}
