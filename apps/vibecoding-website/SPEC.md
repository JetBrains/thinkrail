---
id: module-vibecoding-website
type: module-design
status: deprecated
title: Vibecoding website (superseded)
parent: architecture
references: [module-website]
tags: [website, marketing, vibecoding]
depends-on: [module-website-analytics]
---

## Superseded boundary

This standalone site and its independent deployment model are retired. The durable experience and boundary now belong to [[submodule-website-vibecoding]] inside [[module-website]], directly served at `https://thinkrail.ai/vibecoding/` from the unified artifact.

`vibecoding.thinkrail.ai` is no longer a production-site identity. After apex verification it becomes a path/query-preserving permanent edge redirect, with the last standalone deployment retained only for the migration rollback window.
