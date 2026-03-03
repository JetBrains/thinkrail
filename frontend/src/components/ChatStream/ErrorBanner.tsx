interface ErrorBannerProps {
  errors?: string[];
  subtype?: string;
}

export function ErrorBanner({ errors, subtype }: ErrorBannerProps) {
  return (
    <div className="chat-banner chat-banner-error">
      <div className="chat-banner-title">
        {"\u2715"} Session error{subtype ? `: ${subtype}` : ""}
      </div>
      {errors && errors.length > 0 && (
        <ul className="chat-banner-errors">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
