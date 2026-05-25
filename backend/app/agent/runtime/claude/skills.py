"""Claude skill registry — discovers Claude Code skills across sources.

Private to the Claude runtime.  Public surface is a single
``list_skills`` method that returns neutral ``RuntimeSkillInfo`` so
consumers stay SDK-agnostic.  Internal state is a process-lifetime cache
keyed by ``(root_dir, root_dir_mtime)``; no protocol-level lifecycle.

Scan order (first-wins dedup by ``id``):

1. ``~/.claude/skills/*/SKILL.md`` → ``source="user"``
2. ``<project_root>/.claude/skills/*/SKILL.md`` → ``source="project"``
3. ``~/.claude/plugins/marketplaces/*/plugins/*/skills/*/SKILL.md``
   → ``source="plugin"``, id ``"<plugin>:<skill-dir>"``
4. ``~/.claude/commands/*.md`` → ``source="command"``
5. Static built-in list (``init``, ``review``, ``security-review``)
   → ``source="builtin"``

Cached for the process lifetime, keyed by the mtime of every root.  Any
unexpected error inside ``list_skills`` is swallowed and an empty list
is returned — autocomplete falls back to Bonsai-only without an error
toast (per design §3 / §5.2).
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.agent.context import _parse_frontmatter
from app.agent.runtime.types import RuntimeSkillInfo

logger = logging.getLogger(__name__)


# ── Built-in skills ─────────────────────────────────────────────────────────
# Static built-in skills that ship with the Claude Code CLI itself.  These
# are always surfaced (last in the dedup order) so the autocomplete popup
# offers them even when the user has nothing under ``~/.claude/``.
_BUILTIN_SKILLS: tuple[tuple[str, str, str], ...] = (
    ("init", "init", "Initialize a new CLAUDE.md file with codebase documentation"),
    ("review", "review", "Review a pull request"),
    (
        "security-review",
        "security-review",
        "Complete a security review of the pending changes on the current branch",
    ),
)


# ── Module-level helpers ────────────────────────────────────────────────────


def _safe_stat_mtime(path: Path) -> float:
    """Return the mtime of ``path`` or -1.0 if it cannot be stat'd.

    Missing paths and unreadable paths both collapse to -1.0 so the cache
    key remains stable until the path appears (or disappears).
    """
    try:
        return path.stat().st_mtime
    except OSError:
        return -1.0


def _parse_skill_md(md_path: Path) -> tuple[str, str] | None:
    """Read ``md_path`` and parse its YAML frontmatter.

    Returns ``(name, description)`` on success, or ``None`` when the file
    can't be read or the frontmatter parser raises.  A missing/empty
    ``description`` is treated as a soft skip (returns ``(name, "")``
    so the caller can log + drop the entry).
    """
    try:
        raw = md_path.read_text(encoding="utf-8")
    except OSError:
        logger.warning("Could not read %s", md_path, exc_info=True)
        return None
    try:
        fm = _parse_frontmatter(raw)
    except Exception:
        logger.warning("Malformed frontmatter in %s", md_path, exc_info=True)
        return None
    return fm.get("name", ""), fm.get("description", "")


# ── Registry ────────────────────────────────────────────────────────────────


class ClaudeSkillRegistry:
    """Discover Claude Code skills across user/project/plugin/command/builtin.

    Private to the Claude runtime — the public surface (``list_skills``)
    is re-exposed via ``IAgentRuntime`` on ``ClaudeRuntime``.

    Cached for the process lifetime, keyed by the mtime of every scanned
    root; when any mtime differs, the cache is dropped and the scan
    re-runs.  No periodic refresh, no protocol-level lifecycle — same
    philosophy as the model catalog.
    """

    def __init__(self, project_root: Path) -> None:
        self._project_root = project_root
        # Process-lifetime mtime cache for ``list_skills``.  The key is the
        # tuple ``((root_str, mtime), ...)`` for every scanned root; when any
        # mtime differs, the cache is dropped and the scan re-runs.
        self._skills_cache_key: tuple[tuple[str, float], ...] | None = None
        self._skills_cache: tuple[RuntimeSkillInfo, ...] | None = None

    # ── Public API ──────────────────────────────────────────────────────

    def list_skills(self) -> list[RuntimeSkillInfo]:
        """Discover skills across all scan sources, with caching.

        Any unexpected error returns ``[]`` — autocomplete falls back to
        Bonsai-only without an error toast (per design §3 / §5.2).
        """
        try:
            return self._list_skills_uncached()
        except Exception:
            logger.warning("ClaudeSkillRegistry.list_skills failed", exc_info=True)
            return []

    # ── Internal ────────────────────────────────────────────────────────

    def _skill_roots(self) -> list[tuple[str, Path]]:
        """Return the ordered scan roots as ``(source, path)`` tuples.

        Pulled out for testability: tests monkeypatch ``Path.home`` and
        set ``project_root`` to inject fixture trees.
        """
        home = Path.home()
        project_root = Path(self._project_root)
        return [
            ("user", home / ".claude" / "skills"),
            ("project", project_root / ".claude" / "skills"),
            ("plugin", home / ".claude" / "plugins" / "marketplaces"),
            ("command", home / ".claude" / "commands"),
        ]

    def _list_skills_uncached(self) -> list[RuntimeSkillInfo]:
        roots = self._skill_roots()
        snapshot = tuple((str(p), _safe_stat_mtime(p)) for _, p in roots)
        if (
            self._skills_cache is not None
            and self._skills_cache_key == snapshot
        ):
            return list(self._skills_cache)

        seen: set[str] = set()
        skills: list[RuntimeSkillInfo] = []

        # 1. ~/.claude/skills/*/SKILL.md
        self._scan_skill_dir(roots[0][1], source="user", seen=seen, out=skills)
        # 2. <project>/.claude/skills/*/SKILL.md
        self._scan_skill_dir(roots[1][1], source="project", seen=seen, out=skills)
        # 3. ~/.claude/plugins/marketplaces/*/plugins/*/skills/*/SKILL.md
        self._scan_plugin_skills(roots[2][1], seen=seen, out=skills)
        # 4. ~/.claude/commands/*.md
        self._scan_command_files(roots[3][1], seen=seen, out=skills)
        # 5. Built-ins (always last)
        for skill_id, name, description in _BUILTIN_SKILLS:
            if skill_id in seen:
                continue
            seen.add(skill_id)
            skills.append(RuntimeSkillInfo(
                id=skill_id, name=name, description=description, source="builtin",
            ))

        self._skills_cache_key = snapshot
        self._skills_cache = tuple(skills)
        return list(skills)

    @staticmethod
    def _scan_skill_dir(
        root: Path,
        *,
        source: str,
        seen: set[str],
        out: list[RuntimeSkillInfo],
    ) -> None:
        """Scan a ``skills/<id>/SKILL.md`` layout. Missing roots are silent."""
        if not root.is_dir():
            return
        for skill_md in sorted(root.glob("*/SKILL.md")):
            try:
                skill_id = skill_md.parent.name
                if skill_id in seen:
                    continue
                parsed = _parse_skill_md(skill_md)
                if parsed is None:
                    continue
                name, description = parsed
                if not description:
                    logger.warning(
                        "Skipping %s: missing description in frontmatter",
                        skill_md,
                    )
                    continue
                seen.add(skill_id)
                out.append(RuntimeSkillInfo(
                    id=skill_id,
                    name=name or skill_id,
                    description=description,
                    source=source,
                ))
            except Exception:
                logger.warning(
                    "Failed to process skill %s", skill_md, exc_info=True,
                )

    @staticmethod
    def _scan_plugin_skills(
        marketplaces_root: Path,
        *,
        seen: set[str],
        out: list[RuntimeSkillInfo],
    ) -> None:
        """Scan ``marketplaces/*/plugins/*/skills/*/SKILL.md``.

        Skill id is ``"<plugin>:<skill-dir>"`` so two plugins can ship a
        skill with the same name without colliding.
        """
        if not marketplaces_root.is_dir():
            return
        for skill_md in sorted(marketplaces_root.glob("*/plugins/*/skills/*/SKILL.md")):
            try:
                plugin_name = skill_md.parents[2].name
                skill_dir = skill_md.parent.name
                skill_id = f"{plugin_name}:{skill_dir}"
                if skill_id in seen:
                    continue
                parsed = _parse_skill_md(skill_md)
                if parsed is None:
                    continue
                name, description = parsed
                if not description:
                    logger.warning(
                        "Skipping %s: missing description in frontmatter",
                        skill_md,
                    )
                    continue
                seen.add(skill_id)
                out.append(RuntimeSkillInfo(
                    id=skill_id,
                    name=name or skill_id,
                    description=description,
                    source="plugin",
                ))
            except Exception:
                logger.warning(
                    "Failed to process plugin skill %s", skill_md, exc_info=True,
                )

    @staticmethod
    def _scan_command_files(
        commands_root: Path,
        *,
        seen: set[str],
        out: list[RuntimeSkillInfo],
    ) -> None:
        """Scan ``~/.claude/commands/*.md``.

        Description-less commands are still surfaced (with an empty
        description) — unlike SKILL.md, commands aren't required to
        carry frontmatter.
        """
        if not commands_root.is_dir():
            return
        for cmd_md in sorted(commands_root.glob("*.md")):
            try:
                cmd_id = cmd_md.stem
                if cmd_id in seen:
                    continue
                parsed = _parse_skill_md(cmd_md)
                if parsed is None:
                    continue
                name, description = parsed
                seen.add(cmd_id)
                out.append(RuntimeSkillInfo(
                    id=cmd_id,
                    name=name or cmd_id,
                    description=description,
                    source="command",
                ))
            except Exception:
                logger.warning(
                    "Failed to process command %s", cmd_md, exc_info=True,
                )


__all__ = ["ClaudeSkillRegistry"]
