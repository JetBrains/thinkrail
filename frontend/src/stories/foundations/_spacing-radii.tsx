/**
 * Custom demo components for the Spacing & Radii doc page.
 *
 * Storybook ships native doc blocks only for colors (ColorPalette/ColorItem),
 * typography (Typeset) and icons (IconGallery) — there is NO native block for
 * spacing / radii / transitions. So these are hand-rolled, but kept internally
 * consistent: every token is shown with a single <TokenRow> (Name + note on the
 * left, visual on the right) that mirrors the native ColorItem row layout.
 *
 * Inline var(--token) references keep everything live with the Theme toolbar.
 * Underscore-prefixed filename keeps it out of the *.stories glob.
 */
import type { CSSProperties, ReactNode } from "react";

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "220px 1fr",
  alignItems: "center",
  gap: "var(--space-md)",
  padding: "var(--space-sm) 0",
  borderBottom: "1px solid var(--border)",
};

/** One token row — mirrors the native ColorItem "Name | visual" layout. */
function TokenRow({ token, note, children }: { token: string; note?: string; children: ReactNode }) {
  return (
    <div style={rowStyle}>
      <div>
        <div style={{ font: "var(--font-sm)/1.4 var(--font-mono)", color: "var(--text)" }}>{token}</div>
        {note && <div style={{ font: "var(--font-xs)/1.4 var(--font)", color: "var(--muted)" }}>{note}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>{children}</div>
    </div>
  );
}

const SPACING: { token: string; ratio: string }[] = [
  { token: "--space-xs", ratio: "×0.31" },
  { token: "--space-sm", ratio: "×0.62" },
  { token: "--space-md", ratio: "×0.92" },
  { token: "--space-lg", ratio: "×1.23" },
  { token: "--space-xl", ratio: "×1.85" },
];

const RADII = ["--radius-sm", "--radius-md", "--radius-lg"];

const TRANSITIONS: { token: string; val: string }[] = [
  { token: "--transition-fast", val: "120ms ease" },
  { token: "--transition-normal", val: "200ms ease" },
];

export function SpacingScale() {
  return (
    <div>
      {SPACING.map((s) => (
        <TokenRow key={s.token} token={s.token} note={`ratio ${s.ratio} of --font-base`}>
          <span style={{ width: `var(${s.token})`, height: 16, background: "var(--blue)", borderRadius: 2 }} />
        </TokenRow>
      ))}
    </div>
  );
}

export function CornerRadii() {
  return (
    <div>
      {RADII.map((token) => (
        <TokenRow key={token} token={token}>
          <div
            style={{
              width: 96,
              height: 48,
              background: "var(--elevated)",
              border: "1px solid var(--border2)",
              borderRadius: `var(${token})`,
            }}
          />
        </TokenRow>
      ))}
    </div>
  );
}

export function Transitions() {
  return (
    <div>
      {TRANSITIONS.map((t) => (
        <TokenRow key={t.token} token={t.token} note="hover to preview">
          <button
            style={{
              font: "var(--font-sm) var(--font)",
              color: "var(--text)",
              background: "var(--elevated)",
              border: "1px solid var(--border2)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-sm) var(--space-md)",
              cursor: "pointer",
              transition: `background var(${t.token}), transform var(${t.token})`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--blue)";
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--elevated)";
              e.currentTarget.style.transform = "none";
            }}
          >
            {t.val}
          </button>
        </TokenRow>
      ))}
    </div>
  );
}
