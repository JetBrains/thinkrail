import type { AgentEvent } from "@/types/agent.ts";
import type { ViewMode } from "@/context/ViewModeContext.tsx";
import type { EventRenderContext, ViewRenderers } from "./types.ts";
import type { ReactNode } from "react";
import { classicRenderers } from "./classicRenderer.tsx";
import { compactRenderers } from "./compactRenderer.tsx";

const viewRendererMap: Record<ViewMode, ViewRenderers> = {
  classic: classicRenderers,
  compact: compactRenderers,
};

/**
 * Look up the renderer for a given event type and view mode.
 * Falls back to the classic renderer if the current mode doesn't handle it.
 */
export function renderEvent(
  mode: ViewMode,
  event: AgentEvent,
  index: number,
  key: string,
  ctx: EventRenderContext,
): ReactNode | null {
  const renderer =
    viewRendererMap[mode]?.[event.eventType] ??
    viewRendererMap.classic[event.eventType];
  return renderer?.(event, index, key, ctx) ?? null;
}
