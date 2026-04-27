---
id: task-frontmatter-model
type: task-spec
status: draft
title: "Refactor: Replace manual frontmatter validation with Pydantic Frontmatter model"
parent: module-spec
depends-on:
  - task-frontmatter
  - task-index
  - task-service-frontmatter
covers:
  - backend/app/spec/frontmatter.py
  - backend/app/spec/index.py
  - backend/app/spec/service.py
  - backend/app/spec/models.py
tags:
  - refactor
  - code-quality
  - frontmatter-sqlite
---
# Refactor: Replace manual frontmatter validation with Pydantic Frontmatter model

Replace the manual `validate_frontmatter()` function and `extract_links()` helper with a
`Frontmatter` Pydantic model that validates automatically on construction, extracts links as a
method, and serializes to dict with canonical key ordering.

## Motivation

The frontmatter "schema" is currently implicit — spread across 5 places:
1. `validate_frontmatter()` in `frontmatter.py` (~60 lines of manual checks)
2. `extract_links()` in `frontmatter.py` (separate function duplicating field knowledge)
3. `_KEY_ORDER` / `_LINK_FIELDS` constants in `frontmatter.py`
4. `RECOGNIZED_TYPES` in `validator.py` and `RECOGNIZED_STATUSES` in `frontmatter.py` (split)
5. Manual dict construction in `service.py` and `index.py` (5+ sites)

Any schema change (e.g., adding a new link type) requires updating 4-6 places.  A single
Pydantic model would be the **single source of truth** for the frontmatter schema.

## Design

### New model: `Frontmatter(BaseModel)` in `models.py`

```python
from typing import Literal

class Frontmatter(BaseModel):
    """Validated YAML frontmatter — single source of truth for the schema."""
    model_config = {"extra": "allow", "populate_by_name": True}

    id: str
    type: Literal[
        "goal-and-requirements", "architecture-design",
        "module-design", "submodule-design", "task-spec",
    ]
    status: Literal["draft", "active", "stale", "done", "deprecated"] = "draft"
    title: str = ""
    parent: str | None = None
    depends_on: list[str] = Field(default_factory=list, alias="depends-on")
    references: list[str] = Field(default_factory=list)
    implements: list[str] = Field(default_factory=list)
    covers: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
```

Key design choices:
- **`extra = "allow"`** — custom fields (e.g., `priority: high`) pass through
- **`populate_by_name = True`** — accepts both `depends_on=` and `depends-on=`
- **`Literal` types** — replaces `RECOGNIZED_TYPES` / `RECOGNIZED_STATUSES` frozensets
- **Lives in `models.py`** alongside `SpecEntry`, `Link`, etc.

### Methods on the model

```python
    def extract_links(self) -> list[tuple[str, str]]:
        """Return (link_type, target_id) tuples from link fields."""
        links: list[tuple[str, str]] = []
        if self.parent:
            links.append(("parent", self.parent))
        for dep in self.depends_on:
            links.append(("depends-on", dep))
        for ref in self.references:
            links.append(("references", ref))
        for impl in self.implements:
            links.append(("implements", impl))
        return links

    def to_ordered_dict(self) -> dict[str, Any]:
        """Serialize to dict with canonical key order for YAML output."""
        # id, type, status, title, parent, depends-on, references,
        # implements, covers, tags, then any extras
        ...

    def to_spec_entry(self, path: str, content_hash: str, indexed_at: str) -> SpecEntry:
        """Convert to a SpecEntry for SQLite indexing."""
        ...
```

### What gets replaced

| Current | Replacement |
|---------|-------------|
| `validate_frontmatter(meta: dict) → list[str]` | `Frontmatter(**meta)` raises `ValidationError` |
| `extract_links(meta: dict) → list[tuple]` | `Frontmatter.extract_links()` method |
| `_KEY_ORDER` constant | `Frontmatter.to_ordered_dict()` method |
| `_LINK_FIELDS` constant | Encoded in model field definitions |
| `RECOGNIZED_TYPES` frozenset | `Frontmatter.type` Literal annotation |
| `RECOGNIZED_STATUSES` frozenset | `Frontmatter.status` Literal annotation |
| Manual `meta = {"id": ..., "type": ...}` | `Frontmatter(id=..., type=...)` |
| Manual SpecEntry construction from dict | `Frontmatter.to_spec_entry()` |

### Soft validation pattern

The current `validate_frontmatter()` returns warning strings without blocking.
For backward compatibility in `rebuild()` and the watcher:

```python
# Soft validation (warnings, don't block)
try:
    fm = Frontmatter(**meta)
except ValidationError as e:
    warnings.extend(str(err) for err in e.errors())
    continue  # skip this spec but keep going

# Hard validation (block on error)
fm = Frontmatter(**meta)  # raises if invalid
```

### Backward compatibility for `RECOGNIZED_TYPES`

Other modules import `RECOGNIZED_TYPES` from `validator.py`.  To avoid breaking
all callers at once, keep a computed constant:

```python
# In models.py or validator.py
RECOGNIZED_TYPES = frozenset(get_args(Frontmatter.model_fields["type"].annotation))
```

## Plan

1. **Add `Frontmatter` model to `models.py`** — new model with all fields, `extra="allow"`
2. **Add methods** — `extract_links()`, `to_ordered_dict()`, `to_spec_entry()`
3. **Update `frontmatter.py`** — replace `validate_frontmatter()` body with `Frontmatter(**meta)` + error conversion.  Keep function signature for backward compat.  Replace `extract_links()` body to delegate to `Frontmatter.extract_links()`.  Replace `_sort_meta_keys()` to delegate to `to_ordered_dict()`.
4. **Update `index.py` rebuild** — use `Frontmatter(**meta)` instead of manual SpecEntry construction
5. **Update `service.py` create/update** — use `Frontmatter(...)` instead of raw dict
6. **Update `validator.py`** — derive `RECOGNIZED_TYPES` from the model
7. **Update `specs.py` tool schemas** — derive enum lists from the model
8. **Update tests** — test the model directly, keep existing test expectations
9. **Remove dead code** — `_KEY_ORDER`, `_LINK_FIELDS`, `RECOGNIZED_STATUSES`, manual validation logic

## Files to modify

- `backend/app/spec/models.py` — Add `Frontmatter` model
- `backend/app/spec/frontmatter.py` — Delegate to model, remove manual validation
- `backend/app/spec/index.py` — Use model in rebuild
- `backend/app/spec/service.py` — Use model in create/update
- `backend/app/spec/validator.py` — Derive constants from model
- `backend/app/agent/tools/specs.py` — Derive schema enums from model
- `backend/tests/spec/test_frontmatter.py` — Update for model-based validation
- `backend/tests/spec/test_index.py` — Minor updates

## Risks and mitigations

- **Pydantic `ValidationError` vs error list:** The current API returns `list[str]`.  Mitigate by keeping the function wrapper that catches `ValidationError` and converts.
- **Hyphenated keys:** `depends-on` needs `Field(alias=...)`.  Well-supported by Pydantic.
- **Extra fields:** `model_config = {"extra": "allow"}` preserves custom fields.  Verified with existing test `test_custom_fields_preserved`.
- **Import cycles:** `Frontmatter` lives in `models.py` which has no deps on other spec modules.

## Definition of done

- `Frontmatter` model validates all fields on construction
- `validate_frontmatter()` delegates to the model (same return type)
- `extract_links()` delegates to the model (same return type)
- Manual dict construction replaced in service.py and index.py
- `RECOGNIZED_TYPES` and `RECOGNIZED_STATUSES` derived from model
- All 198 existing tests pass without modification to test expectations
- No dead validation code remaining

## Style Notes

Follow `.claude/CLAUDE.md § Code Style — Python Backend`:
- `Frontmatter` as Pydantic `BaseModel` (crosses parsing/storage boundary)
- Keep backward-compatible function wrappers during transition
- Document the model as the single source of truth in the module docstring

**Priority:** Medium — code quality improvement, not blocking any feature
**Depends on:** task-frontmatter, task-index, task-service-frontmatter (all done)