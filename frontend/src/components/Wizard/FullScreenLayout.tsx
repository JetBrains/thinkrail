import type { ReactNode } from "react";
import "./FullScreenLayout.css";

interface FullScreenLayoutProps {
  children: ReactNode;
  maxWidth?: number;
}

/**
 * Full-screen layout with sphere background and blurred container.
 * Used for wizard forms and single-panel screens.
 */
export function FullScreenLayout({ children, maxWidth = 534 }: FullScreenLayoutProps) {
  return (
    <div className="fullscreen-layout">
      <div className="fullscreen-container">
        <div className="fullscreen-content" style={{ maxWidth: `${maxWidth}px` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
