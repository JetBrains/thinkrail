import { Button } from "../ui/Button";

/**
 * Always-visible bar at the top of a discussion subsession: reminds the user the
 * session is branched and offers the explicit "Return to parent" action.
 */
export function ReturnToParentBanner({
  parentName,
  onReturn,
}: {
  parentName: string;
  onReturn: () => void;
}) {
  return (
    <div className="return-banner">
      <span className="return-banner-icon" aria-hidden="true">{"💬"}</span>
      <div className="return-banner-text">
        <div className="return-banner-title">Discussion subsession</div>
        <div className="return-banner-sub">
          branched from &ldquo;{parentName}&rdquo; &middot; must return when done
        </div>
      </div>
      <span className="return-banner-spacer" />
      <Button variant="primary" size="sm" onClick={onReturn}>
        Return to parent {"▸"}
      </Button>
    </div>
  );
}

/**
 * Gentle nudge shown near the input once a discussion looks concluded (idle with
 * some assistant output and no return in progress). Dismissible.
 */
export function ReturnToParentNudge({
  onReturn,
  onDismiss,
}: {
  onReturn: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="return-nudge">
      <span aria-hidden="true">{"✅"}</span>
      <div className="return-nudge-text">
        <b>Looks like you&rsquo;ve reached a conclusion.</b> Return it to the parent
        session?
      </div>
      <span className="return-nudge-spacer" />
      <Button variant="primary" size="sm" onClick={onReturn}>
        Return to parent {"▸"}
      </Button>
      <button className="return-nudge-x" onClick={onDismiss} aria-label="Dismiss">
        {"×"}
      </button>
    </div>
  );
}
