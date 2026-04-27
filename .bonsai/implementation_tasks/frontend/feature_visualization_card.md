---
id: task-visualization-card
type: task-spec
status: done
title: Visualization Card
implements:
- visualization-design
- ui-visualization-card
covers:
- frontend/src/components/ChatStream/VisualizationCard.tsx
- frontend/src/types/vis.ts
tags:
- medium
- new-feature
- frontend
---
# Task: Visualization Card

> Status: **Done** | Created: 2026-03-11

## Summary

Implement VisualizationCard component for rendering structured visualizations in the ChatStream. The agent calls `bonsai_visualize` MCP tool, and the frontend renders one of 6 visualization types.

## Covers

- `frontend/src/components/ChatStream/VisualizationCard.tsx`
- `frontend/src/types/vis.ts`

## Acceptance Criteria

- [x] VisualizationCard renders based on `data.type` discriminated union
- [x] 6 sub-renderers: ProgressTracker, SummaryBox, Comparison, DataTable, StatusList, Diagram
- [x] STATUS_ICONS and STATUS_COLORS maps for consistent visual indicators
- [x] visId-based auto-collapse: older cards with same visId show CollapsedVisMarker
- [x] VisErrorBoundary catches rendering errors without crashing ChatStream
- [x] Collapse/expand toggle on card header
- [x] CSS classes: .vis-card, .vis-card-header, .vis-card-body (resizable vertical)

## Design Reference

- Feature design: [.bonsai/design_docs/VISUALIZATION_DESIGN.md](../design_docs/VISUALIZATION_DESIGN.md)
- Backend MCP tool: [backend/app/agent/visualization.py](../../backend/app/agent/visualization.py)
