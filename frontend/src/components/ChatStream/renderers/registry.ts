import type { AgentEvent } from "@/types/agent.ts";
import type { ViewMode } from "@/context/ViewModeContext.tsx";
import type { EventRenderContext, EventRenderer, ViewRenderers } from "./types.ts";
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
  // Cast needed because TypeScript can't verify at this call site that the
  // renderer's specific event type aligns with event.eventType at runtime.
  const renderer = (
    viewRendererMap[mode]?.[event.eventType] ??
    viewRendererMap.classic[event.eventType]
  ) as EventRenderer | undefined;
  return renderer?.(event, index, key, ctx) ?? null;
}
