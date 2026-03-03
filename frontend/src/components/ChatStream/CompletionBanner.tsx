interface CompletionBannerProps {
  result?: string;
  costUsd?: number;
  turns?: number;
  durationMs?: number;
}

export function CompletionBanner({
  result,
  costUsd,
  turns,
  durationMs,
}: CompletionBannerProps) {
  const duration = durationMs
    ? durationMs < 60000
      ? `${(durationMs / 1000).toFixed(1)}s`
      : `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`
    : null;

  return (
    <div className="chat-banner chat-banner-done">
      <div className="chat-banner-title">{"\u2713"} Session complete</div>
      <div className="chat-banner-metrics">
        {costUsd != null && <span>${costUsd.toFixed(2)}</span>}
        {turns != null && <span>{turns} turns</span>}
        {duration && <span>{duration}</span>}
      </div>
      {result && <div className="chat-banner-result">{result}</div>}
    </div>
  );
}
