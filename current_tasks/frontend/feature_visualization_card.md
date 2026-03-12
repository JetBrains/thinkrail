# Task: Visualization Card

> Status: **Done** | Created: 2026-03-11

## Summary

Implement VisualizationCard component for rendering structured visualizations in the ChatStream. The agent calls `bonsai_visualize` MCP tool, and the frontend renders one of 6 visualization types.

## Covers

- `frontend/src/components/ChatStream/VisualizationCard.tsx`
- `frontend/src/types/viz.ts`

## Acceptance Criteria

- [x] VisualizationCard renders based on `data.type` discriminated union
- [x] 6 sub-renderers: ProgressTracker, SummaryBox, Comparison, DataTable, StatusList, Diagram
- [x] STATUS_ICONS and STATUS_COLORS maps for consistent visual indicators
- [x] vizId-based auto-collapse: older cards with same vizId show CollapsedVizMarker
- [x] VizErrorBoundary catches rendering errors without crashing ChatStream
- [x] Collapse/expand toggle on card header
- [x] CSS classes: .viz-card, .viz-card-header, .viz-card-body (resizable vertical)

## Design Reference

- Feature design: [features/VISUALIZATION_DESIGN.md](../../features/VISUALIZATION_DESIGN.md)
- Backend MCP tool: [backend/app/agent/visualization.py](../../backend/app/agent/visualization.py)
