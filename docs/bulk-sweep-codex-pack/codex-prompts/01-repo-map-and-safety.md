# Codex Prompt 01 — Repo map and safety pass

Do not implement Bulk Sweep yet.

Inspect the Homebox Companion repo and produce a concise repo map for the current capture/analyze/review/submit flow.

Focus on:

- backend app creation and routers;
- existing vision endpoints;
- current LLM prompt builders;
- frontend location selection;
- current capture route;
- scan workflow service;
- analysis service;
- review and submission services;
- type definitions;
- session persistence;
- config/env var handling;
- test commands.

Create or update:

```text
docs/bulk-sweep/repo-map.md
```

The document should include:

1. Current flow diagram.
2. Important files and responsibilities.
3. Safe extension points for Bulk Sweep.
4. Things not to touch.
5. Recommended implementation order.
6. Exact commands to run backend/frontend checks in this repo.

No feature code changes in this step. If you must add only the doc file, do that.

