import type { Meta, StoryObj } from "@storybook/react-vite";
import { PRODUCT_NAME } from "@/constants/branding";
import "./tokens.css";

/**
 * Design Tokens showcase - displays all available design tokens in the system.
 */
const meta = {
  title: "Foundations/Tokens",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          `Complete overview of all design tokens available in the ${PRODUCT_NAME} design system.`,
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const TokenShowcase = () => {
  const fontTokens = [
    { name: "--font-xs", value: "10px" },
    { name: "--font-sm", value: "12px" },
    { name: "--font-body", value: "13px" },
    { name: "--font-md", value: "15px" },
    { name: "--font-lg", value: "18px" },
    { name: "--font-lg2", value: "20px" },
    { name: "--font-xl", value: "25px" },
    { name: "--font-xxl", value: "40px" },
  ];

  const accentColors = [
    { name: "--primary", value: "#8C81FF" },
    { name: "--primary-10", value: "rgba(140, 129, 255, 0.10)" },
    { name: "--primary-20", value: "rgba(140, 129, 255, 0.20)" },
    { name: "--primary-40", value: "rgba(140, 129, 255, 0.40)" },
    { name: "--primary-60", value: "rgba(140, 129, 255, 0.60)" },
    { name: "--primary-80", value: "rgba(140, 129, 255, 0.80)" },
    { name: "--secondary", value: "#464857" },
    { name: "--blue", value: "#6AC8FF" },
    { name: "--green", value: "#6AD859" },
    { name: "--red", value: "#FF4B75" },
    { name: "--gold", value: "#FFD54B" },
  ];

  const whiteOpacity = [
    { name: "--white-5", value: "rgba(255, 255, 255, 0.05)" },
    { name: "--white-10", value: "rgba(255, 255, 255, 0.10)" },
    { name: "--white-20", value: "rgba(255, 255, 255, 0.20)" },
    { name: "--white-40", value: "rgba(255, 255, 255, 0.40)" },
    { name: "--white-60", value: "rgba(255, 255, 255, 0.60)" },
    { name: "--white-80", value: "rgba(255, 255, 255, 0.80)" },
    { name: "--white-100", value: "rgba(255, 255, 255, 1)" },
  ];

  const semanticColors = [
    { name: "--bg", value: "Background" },
    { name: "--bg-dark", value: "Dark background" },
    { name: "--bg-input", value: "Input background" },
    { name: "--elevated", value: "Elevated surface" },
    { name: "--hover", value: "Hover state" },
    { name: "--border", value: "Border color" },
    { name: "--border2", value: "Secondary border" },
    { name: "--text", value: "Primary text" },
    { name: "--text-40", value: "40% opacity text" },
    { name: "--muted", value: "Muted text" },
    { name: "--hint", value: "Hint text" },
    { name: "--sel", value: "Selection color" },
  ];

  const spacing = [
    { name: "--space-xs", value: "calc(var(--font-base) * 0.31)" },
    { name: "--space-sm", value: "calc(var(--font-base) * 0.62)" },
    { name: "--space-md", value: "calc(var(--font-base) * 0.92)" },
    { name: "--space-lg", value: "calc(var(--font-base) * 1.23)" },
    { name: "--space-xl", value: "calc(var(--font-base) * 1.85)" },
  ];

  const radii = [
    { name: "--radius-sm", value: "4px" },
    { name: "--radius-md", value: "8px" },
    { name: "--radius-lg", value: "12px" },
  ];

  return (
    <div style={{ padding: "40px", background: "var(--bg)", color: "var(--text)", minHeight: "100vh" }}>
      <h1 style={{ fontSize: "var(--font-xxl)", marginBottom: "40px", fontFamily: "var(--font-accent)" }}>
        Design Tokens
      </h1>

      {/* Font Sizes */}
      <section style={{ marginBottom: "48px" }}>
        <h2 style={{ fontSize: "var(--font-xl)", marginBottom: "24px", color: "var(--primary)" }}>
          Font Sizes
        </h2>
        <div style={{ display: "grid", gap: "16px" }}>
          {fontTokens.map((token) => (
            <div
              key={token.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "24px",
                padding: "16px",
                background: "var(--elevated)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <code style={{
                width: "160px",
                color: "var(--primary)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-sm)"
              }}>
                {token.name}
              </code>
              <span style={{
                color: "var(--muted)",
                width: "80px",
                fontSize: "var(--font-sm)"
              }}>
                {token.value}
              </span>
              <span style={{ fontSize: `var(${token.name})` }}>
                The quick brown fox jumps over the lazy dog
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Accent Colors */}
      <section style={{ marginBottom: "48px" }}>
        <h2 style={{ fontSize: "var(--font-xl)", marginBottom: "24px", color: "var(--primary)" }}>
          Accent Colors
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>
          {accentColors.map((token) => (
            <div
              key={token.name}
              style={{
                padding: "16px",
                background: "var(--elevated)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "80px",
                  background: `var(${token.name})`,
                  borderRadius: "var(--radius-sm)",
                  marginBottom: "12px",
                  border: "1px solid var(--border)",
                }}
              />
              <code style={{
                color: "var(--primary)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-sm)",
                display: "block",
                marginBottom: "4px"
              }}>
                {token.name}
              </code>
              <span style={{ color: "var(--muted)", fontSize: "var(--font-xs)" }}>
                {token.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* White Opacity Scale */}
      <section style={{ marginBottom: "48px" }}>
        <h2 style={{ fontSize: "var(--font-xl)", marginBottom: "24px", color: "var(--primary)" }}>
          White Opacity Scale
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>
          {whiteOpacity.map((token) => (
            <div
              key={token.name}
              style={{
                padding: "16px",
                background: "var(--elevated)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "80px",
                  background: `var(${token.name})`,
                  borderRadius: "var(--radius-sm)",
                  marginBottom: "12px",
                  border: "1px solid var(--border)",
                }}
              />
              <code style={{
                color: "var(--primary)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-sm)",
                display: "block",
                marginBottom: "4px"
              }}>
                {token.name}
              </code>
              <span style={{ color: "var(--muted)", fontSize: "var(--font-xs)" }}>
                {token.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Semantic Colors */}
      <section style={{ marginBottom: "48px" }}>
        <h2 style={{ fontSize: "var(--font-xl)", marginBottom: "24px", color: "var(--primary)" }}>
          Semantic Colors (Theme-dependent)
        </h2>
        <div style={{ display: "grid", gap: "16px" }}>
          {semanticColors.map((token) => (
            <div
              key={token.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "24px",
                padding: "16px",
                background: "var(--elevated)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div
                style={{
                  width: "80px",
                  height: "40px",
                  background: `var(${token.name})`,
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  flexShrink: 0,
                }}
              />
              <code style={{
                width: "140px",
                color: "var(--primary)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-sm)"
              }}>
                {token.name}
              </code>
              <span style={{ color: "var(--muted)", fontSize: "var(--font-sm)" }}>
                {token.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Spacing */}
      <section style={{ marginBottom: "48px" }}>
        <h2 style={{ fontSize: "var(--font-xl)", marginBottom: "24px", color: "var(--primary)" }}>
          Spacing Scale
        </h2>
        <div style={{ display: "grid", gap: "16px" }}>
          {spacing.map((token) => (
            <div
              key={token.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "24px",
                padding: "16px",
                background: "var(--elevated)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div
                style={{
                  width: `var(${token.name})`,
                  height: "40px",
                  background: "var(--primary)",
                  borderRadius: "var(--radius-sm)",
                  flexShrink: 0,
                }}
              />
              <code style={{
                width: "140px",
                color: "var(--primary)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-sm)"
              }}>
                {token.name}
              </code>
              <span style={{ color: "var(--muted)", fontSize: "var(--font-sm)" }}>
                {token.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Radii */}
      <section style={{ marginBottom: "48px" }}>
        <h2 style={{ fontSize: "var(--font-xl)", marginBottom: "24px", color: "var(--primary)" }}>
          Border Radii
        </h2>
        <div style={{ display: "grid", gap: "16px" }}>
          {radii.map((token) => (
            <div
              key={token.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "24px",
                padding: "16px",
                background: "var(--elevated)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div
                style={{
                  width: "80px",
                  height: "80px",
                  background: "var(--primary)",
                  borderRadius: `var(${token.name})`,
                  flexShrink: 0,
                }}
              />
              <code style={{
                width: "140px",
                color: "var(--primary)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-sm)"
              }}>
                {token.name}
              </code>
              <span style={{ color: "var(--muted)", fontSize: "var(--font-sm)" }}>
                {token.value}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export const AllTokens: Story = {
  render: () => <TokenShowcase />,
};
