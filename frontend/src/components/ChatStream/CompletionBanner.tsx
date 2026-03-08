import { formatDuration } from "@/utils/format.ts";

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
  const duration = durationMs ? formatDuration(durationMs) : null;

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
