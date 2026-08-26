---
id: submodule-vibecoding-analytics
type: submodule-design
status: deprecated
title: Vibecoding website analytics (superseded)
parent: module-vibecoding-website
tags: [website, analytics, privacy]
depends-on: [module-website-analytics]
---

## Superseded boundary

The subdomain-specific facade is retired. [[module-website]] owns one exact-host initializer for `thinkrail.ai`, shared by every route through its presentation-free analytics component; the old subdomain is analytics-silent once it becomes a redirect.
