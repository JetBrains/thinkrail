#!/usr/bin/env python3
"""Compute spec-driven development dashboard from project sources.

Reads registry.json, progress data, task files, and source tree to produce:
  - dashboard.json  (single source of truth for all consumers)
  - dashboard.html  (interactive browser dashboard)
  - stdout one-liner (for hook context)

Usage:
  python3 compute-dashboard.py <project_root>
  python3 compute-dashboard.py <project_root> --terminal status|progress|lint|next|dashboard
"""

import datetime
import glob
import json
import os
import re
import shutil
import sys
import time

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REQUIRED_SECTIONS = {
    "architecture-design": [
        "Table of Contents", "High-Level Pipeline", "Source Tree",
        "Data Flow", "Key Design Decisions",
    ],
    "module-design": [
        "Table of Contents", "Public Interface", "Output Contract",
        "Key Design Decisions", "Known Limitations",
    ],
    "task-spec": ["Context", "Files", "Definition of Done"],
    "goal-and-requirements": [
        "Goal", "Business Requirements", "Technical Requirements",
    ],
}

CODE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".c", ".cpp",
    ".java", ".rb", ".swift", ".kt",
}

IGNORE_DIRS = {
    "node_modules", ".venv", "__pycache__", "dist", ".git", ".specs",
    "vendor", ".idea", ".vscode", "current_tasks", ".claude",
    "claude-plugin",
}

STATUS_RE = re.compile(r"\*\*Status:\*\*\s*(\S+)", re.IGNORECASE)
HEADING_RE = re.compile(r"^##\s+(.+)", re.MULTILINE)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def read_json(path):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def file_mtime_iso(path):
    try:
        return datetime.datetime.fromtimestamp(
            os.path.getmtime(path), tz=datetime.timezone.utc
        ).strftime("%Y-%m-%d")
    except OSError:
        return None


def file_mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0


def find_source_dirs(root):
    """Return set of relative source directories containing code files."""
    dirs = set()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        rel = os.path.relpath(dirpath, root)
        if rel == ".":
            continue
        for f in filenames:
            if os.path.splitext(f)[1] in CODE_EXTENSIONS:
                dirs.add(rel + "/")
                break
    return sorted(dirs)


def max_code_mtime_in(root, cover_path):
    """Get the most recent mtime of code files under cover_path."""
    abs_cover = os.path.join(root, cover_path)
    if not os.path.isdir(abs_cover):
        # Maybe it's a file
        return file_mtime(abs_cover) if os.path.isfile(abs_cover) else 0
    best = 0
    for dirpath, dirnames, filenames in os.walk(abs_cover):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for f in filenames:
            if os.path.splitext(f)[1] in CODE_EXTENSIONS:
                t = file_mtime(os.path.join(dirpath, f))
                if t > best:
                    best = t
    return best

# ---------------------------------------------------------------------------
# Computation Steps
# ---------------------------------------------------------------------------

def compute_coverage(registry, source_dirs, root):
    """For each source dir, find matching spec. Return coverage list."""
    specs = registry.get("specs", [])
    coverage = []
    for src_dir in source_dirs:
        matching_spec = None
        for spec in specs:
            for cover_path in spec.get("covers", []):
                # Prefix match in either direction
                if src_dir.startswith(cover_path) or cover_path.startswith(src_dir):
                    matching_spec = spec
                    break
            if matching_spec:
                break
        coverage.append({
            "path": src_dir,
            "spec_id": matching_spec["id"] if matching_spec else None,
            "spec_path": matching_spec["path"] if matching_spec else None,
        })
    return coverage


def compute_freshness(registry, root):
    """For each spec with covers[], compute freshness."""
    results = {}
    for spec in registry.get("specs", []):
        covers = spec.get("covers", [])
        if not covers:
            results[spec["id"]] = {"freshness": "n/a", "spec_mtime": None, "code_mtime": None}
            continue
        spec_path = os.path.join(root, spec["path"])
        spec_mt = file_mtime(spec_path)
        code_mt = 0
        for cover in covers:
            t = max_code_mtime_in(root, cover)
            if t > code_mt:
                code_mt = t
        if code_mt == 0:
            freshness = "n/a"
        elif spec_mt >= code_mt:
            freshness = "fresh"
        else:
            freshness = "stale"
        results[spec["id"]] = {
            "freshness": freshness,
            "spec_mtime": file_mtime_iso(spec_path),
            "code_mtime": datetime.datetime.fromtimestamp(
                code_mt, tz=datetime.timezone.utc
            ).strftime("%Y-%m-%d") if code_mt else None,
        }
    return results


def run_structural_lint(registry, root):
    """Check required sections per spec type."""
    issues = []
    for spec in registry.get("specs", []):
        spec_type = spec.get("type", "")
        required = REQUIRED_SECTIONS.get(spec_type)
        if not required:
            continue
        spec_path = os.path.join(root, spec["path"])
        try:
            with open(spec_path, "r") as f:
                content = f.read(4096)
        except (FileNotFoundError, OSError):
            issues.append({
                "spec_id": spec["id"],
                "path": spec["path"],
                "severity": "error",
                "category": "missing-file",
                "message": f"Spec file not found: {spec['path']}",
                "fixable": False,
            })
            continue
        headings = set(HEADING_RE.findall(content))
        for section in required:
            if not any(section.lower() in h.lower() for h in headings):
                issues.append({
                    "spec_id": spec["id"],
                    "path": spec["path"],
                    "severity": "warning",
                    "category": "structure",
                    "message": f"Missing section: {section}",
                    "fixable": False,
                })

    # Registry consistency: check specs on disk but not registered
    registered_paths = {s["path"] for s in registry.get("specs", [])}
    for pattern in ["**/README.md", "GOAL&REQUIREMENTS.md", "DESIGN_DOC.md"]:
        for fpath in glob.glob(os.path.join(root, pattern), recursive=True):
            rel = os.path.relpath(fpath, root)
            if rel not in registered_paths and not rel.startswith(("node_modules", ".venv", "claude-plugin", ".specs")):
                issues.append({
                    "spec_id": None,
                    "path": rel,
                    "severity": "warning",
                    "category": "registry",
                    "message": "Exists on disk but not registered",
                    "fixable": True,
                })

    # Check link targets exist
    for link in registry.get("links", []):
        spec_ids = {s["id"] for s in registry.get("specs", [])}
        if link.get("from") not in spec_ids:
            issues.append({
                "spec_id": None,
                "path": "",
                "severity": "error",
                "category": "broken-link",
                "message": f"Link from '{link['from']}' references non-existent spec",
                "fixable": True,
            })
        if link.get("to") not in spec_ids:
            issues.append({
                "spec_id": None,
                "path": "",
                "severity": "error",
                "category": "broken-link",
                "message": f"Link to '{link['to']}' references non-existent spec",
                "fixable": True,
            })

    return issues


def parse_task_statuses(root):
    """Parse current_tasks/**/*.md for status."""
    tasks = []
    task_dir = os.path.join(root, "current_tasks")
    if not os.path.isdir(task_dir):
        return tasks
    for fpath in sorted(glob.glob(os.path.join(task_dir, "**/*.md"), recursive=True)):
        rel = os.path.relpath(fpath, root)
        parts = rel.replace("current_tasks/", "").split("/")
        module = parts[0] if len(parts) > 1 else "general"
        basename = os.path.splitext(os.path.basename(fpath))[0]
        try:
            with open(fpath, "r") as f:
                content = f.read(500)
        except OSError:
            continue
        match = STATUS_RE.search(content)
        raw_status = match.group(1).rstrip(".") if match else "Unknown"
        # Normalize
        status_map = {"done": "Done", "in progress": "In Progress", "pending": "Pending"}
        status = status_map.get(raw_status.lower(), raw_status)
        tasks.append({
            "id": basename,
            "path": rel,
            "module": module,
            "status": status,
        })
    return tasks


def build_graph(registry):
    """Build Cytoscape.js-ready graph from registry."""
    nodes = []
    for spec in registry.get("specs", []):
        if spec.get("type") in ("task-spec", "task"):
            continue  # Skip tasks in graph for clarity
        nodes.append({
            "id": spec["id"],
            "label": spec.get("title", spec["id"]),
            "type": spec.get("type", "unknown"),
            "status": spec.get("status", "active"),
        })
    edges = []
    node_ids = {n["id"] for n in nodes}
    for link in registry.get("links", []):
        if link.get("from") in node_ids and link.get("to") in node_ids:
            edges.append({
                "source": link["from"],
                "target": link["to"],
                "type": link.get("type", "depends-on"),
            })
    return {"nodes": nodes, "edges": edges}


def parse_progress(root):
    """Read progress from .progress.json or parse .progress.yaml."""
    json_path = os.path.join(root, ".specs", ".progress.json")
    yaml_path = os.path.join(root, ".specs", ".progress.yaml")

    data = read_json(json_path)
    if data:
        return data

    # Simple YAML parser for our well-structured progress file
    if os.path.exists(yaml_path):
        return parse_simple_yaml(yaml_path)
    return None


def parse_simple_yaml(path):
    """Minimal YAML parser for .progress.yaml (no external deps)."""
    with open(path, "r") as f:
        lines = f.readlines()

    result = {}
    workflow = {"status": "unknown", "steps": []}
    current_step = None
    current_list_key = None
    current_list = []
    in_workflow = False
    in_steps = False

    for line in lines:
        stripped = line.rstrip()
        if not stripped or stripped.startswith("#"):
            continue

        indent = len(line) - len(line.lstrip())

        if indent == 0:
            # Top-level keys
            if ":" in stripped:
                key, _, val = stripped.partition(":")
                key = key.strip()
                val = val.strip().strip('"')
                if key == "workflow":
                    in_workflow = True
                    continue
                result[key] = val
                in_workflow = False
            continue

        if in_workflow:
            if indent <= 2 and "status:" in stripped:
                workflow["status"] = stripped.split(":", 1)[1].strip()
            elif "steps:" in stripped:
                in_steps = True
            elif in_steps and stripped.lstrip().startswith("- name:"):
                if current_step:
                    if current_list_key and current_list:
                        current_step[current_list_key] = current_list
                        current_list = []
                        current_list_key = None
                    workflow["steps"].append(current_step)
                name = stripped.split(":", 1)[1].strip()
                current_step = {"name": name}
            elif in_steps and current_step:
                s = stripped.strip()
                if s.startswith("- ") and current_list_key:
                    current_list.append(s[2:].strip())
                elif ":" in s:
                    if current_list_key and current_list:
                        current_step[current_list_key] = current_list
                        current_list = []
                    key, _, val = s.partition(":")
                    key = key.strip()
                    val = val.strip().strip('"')
                    if val:
                        current_step[key] = val
                    else:
                        current_list_key = key
                        current_list = []

    if current_step:
        if current_list_key and current_list:
            current_step[current_list_key] = current_list
        workflow["steps"].append(current_step)

    result["workflow"] = workflow
    return result


def generate_recommendations(coverage, freshness, lint_issues, tasks, progress):
    """Generate prioritized recommendations."""
    recs = []

    # Stale specs
    for spec_id, fr in freshness.items():
        if fr["freshness"] == "stale":
            recs.append({
                "priority": 1,
                "category": "stale",
                "title": f"Update stale spec: {spec_id}",
                "reason": f"Code changed after spec (spec: {fr['spec_mtime']}, code: {fr['code_mtime']})",
                "action": f"/spec-review {spec_id}",
            })

    # Lint errors
    error_count = sum(1 for i in lint_issues if i["severity"] == "error")
    if error_count:
        recs.append({
            "priority": 2,
            "category": "lint",
            "title": f"Fix {error_count} lint error(s)",
            "reason": "Structural issues found in specs",
            "action": "/spec-lint",
        })

    # Coverage gaps
    gaps = [c for c in coverage if c["spec_id"] is None]
    if gaps:
        recs.append({
            "priority": 3,
            "category": "coverage",
            "title": f"{len(gaps)} source dir(s) without specs",
            "reason": "Source directories have no corresponding specification",
            "action": "/spec-from-code",
        })

    # Pending tasks
    pending = [t for t in tasks if t["status"] not in ("Done",)]
    if pending:
        recs.append({
            "priority": 4,
            "category": "progress",
            "title": f"Complete {len(pending)} pending task(s)",
            "reason": "Implementation tasks remaining",
            "action": "See pending_tasks in dashboard",
        })

    recs.sort(key=lambda r: r["priority"])
    return recs


def compose_dashboard(root, registry, progress, source_dirs):
    """Build the full dashboard data structure."""
    start = time.time()

    coverage = compute_coverage(registry, source_dirs, root)
    freshness = compute_freshness(registry, root)
    lint_issues = run_structural_lint(registry, root)
    tasks = parse_task_statuses(root)
    graph = build_graph(registry)

    # Merge freshness into coverage
    for item in coverage:
        if item["spec_id"] and item["spec_id"] in freshness:
            fr = freshness[item["spec_id"]]
            item["freshness"] = fr["freshness"]
            item["spec_mtime"] = fr["spec_mtime"]
            item["code_mtime"] = fr["code_mtime"]
        else:
            item["freshness"] = None
            item["spec_mtime"] = None
            item["code_mtime"] = None

    # Merge freshness into graph nodes
    for node in graph["nodes"]:
        if node["id"] in freshness:
            node["freshness"] = freshness[node["id"]]["freshness"]

    recs = generate_recommendations(coverage, freshness, lint_issues, tasks, progress)

    # Summary
    specs = registry.get("specs", [])
    active_specs = [s for s in specs if s.get("status") == "active"]
    stale_count = sum(1 for v in freshness.values() if v["freshness"] == "stale")
    draft_specs = [s for s in specs if s.get("status") == "draft"]
    deprecated_specs = [s for s in specs if s.get("status") == "deprecated"]

    done_tasks = [t for t in tasks if t["status"] == "Done"]
    pending_tasks = [t for t in tasks if t["status"] != "Done"]

    lint_errors = sum(1 for i in lint_issues if i["severity"] == "error")
    lint_warnings = sum(1 for i in lint_issues if i["severity"] == "warning")
    fixable = sum(1 for i in lint_issues if i.get("fixable"))

    covered_dirs = sum(1 for c in coverage if c["spec_id"] is not None)
    coverage_pct = round(covered_dirs / len(coverage) * 100) if coverage else 0

    # Determine phase
    phase = "implementation"
    if progress:
        phase = progress.get("phase", "implementation")

    one_liner = (
        f"{coverage_pct}% coverage | {len(done_tasks)}/{len(tasks)} tasks done"
        f" | {stale_count} stale | {lint_errors} lint error(s)"
    )

    # Workflow steps
    workflow_steps = []
    current_step = None
    if progress and "workflow" in progress:
        wf = progress["workflow"]
        for step in wf.get("steps", []):
            ws = {
                "name": step.get("name", ""),
                "status": step.get("status", "pending"),
            }
            if "outputs" in step:
                ws["outputs"] = step["outputs"]
            if "completed_at" in step:
                ws["completed_at"] = step["completed_at"]
            if "started_at" in step:
                ws["started_at"] = step["started_at"]
            if "progress" in step and isinstance(step["progress"], dict):
                ws["progress"] = step["progress"]
            workflow_steps.append(ws)
            if ws["status"] == "in_progress":
                current_step = ws["name"]

    elapsed_ms = round((time.time() - start) * 1000)

    return {
        "meta": {
            "project": registry.get("project", "unknown"),
            "computed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "computation_ms": elapsed_ms,
        },
        "summary": {
            "one_liner": one_liner,
            "phase": phase,
            "coverage_pct": coverage_pct,
            "specs": {
                "total": len(specs),
                "active": len(active_specs),
                "stale": stale_count,
                "draft": len(draft_specs),
                "deprecated": len(deprecated_specs),
            },
            "tasks": {
                "total": len(tasks),
                "done": len(done_tasks),
                "in_progress": sum(1 for t in tasks if t["status"] == "In Progress"),
                "pending": len(pending_tasks),
            },
            "lint": {
                "errors": lint_errors,
                "warnings": lint_warnings,
                "fixable": fixable,
            },
            "broken_links": sum(1 for i in lint_issues if i["category"] == "broken-link"),
        },
        "workflow": {
            "steps": workflow_steps,
            "current_step": current_step,
        },
        "coverage": coverage,
        "lint": lint_issues,
        "graph": graph,
        "recommendations": recs,
        "pending_tasks": [t for t in tasks if t["status"] != "Done"],
    }


# ---------------------------------------------------------------------------
# Terminal Output (--terminal flag)
# ---------------------------------------------------------------------------

# ANSI helpers
BOLD = "\033[1m"
CYAN = "\033[36m"
BCYAN = "\033[1;36m"
GREEN = "\033[32m"
BGREEN = "\033[1;32m"
YELLOW = "\033[33m"
BYELLOW = "\033[1;33m"
RED = "\033[1;31m"
DIM = "\033[90m"
BLUE = "\033[34m"
RESET = "\033[0m"


def bar(done, total, width=20):
    if total == 0:
        return DIM + "░" * width + RESET
    filled = round(done / total * width)
    return GREEN + "█" * filled + DIM + "░" * (width - filled) + RESET


def terminal_status(dashboard):
    s = dashboard["summary"]
    w = dashboard["workflow"]
    print()
    print(f"{BCYAN}╔══════════════════════════════════════════════════╗{RESET}")
    print(f"{BCYAN}║{RESET} {BOLD}SPECIFICATION STATUS REPORT{RESET}                       {BCYAN}║{RESET}")
    print(f"{BCYAN}╠══════════════════════════════════════════════════╣{RESET}")
    print(f"{BCYAN}║{RESET}                                                  {BCYAN}║{RESET}")
    pct = s["coverage_pct"]
    print(f"{BCYAN}║{RESET}  Coverage: {bar(pct, 100, 16)} {pct}%                    {BCYAN}║{RESET}")
    sp = s["specs"]
    print(f"{BCYAN}║{RESET}  Specs: {BOLD}{sp['total']}{RESET} total  {BGREEN}{sp['active']}{RESET} active  {YELLOW}{sp['stale']}{RESET} stale  {DIM}{sp['draft']}{RESET} draft  {BCYAN}║{RESET}")
    t = s["tasks"]
    print(f"{BCYAN}║{RESET}  Tasks: {bar(t['done'], t['total'], 16)} {t['done']}/{t['total']}          {BCYAN}║{RESET}")
    ln = s["lint"]
    if ln["errors"] or ln["warnings"]:
        print(f"{BCYAN}║{RESET}  Lint:  {RED}{ln['errors']} error(s){RESET}  {YELLOW}{ln['warnings']} warning(s){RESET}               {BCYAN}║{RESET}")
    print(f"{BCYAN}║{RESET}                                                  {BCYAN}║{RESET}")
    print(f"{BCYAN}╚══════════════════════════════════════════════════╝{RESET}")
    print()

    # Workflow steps
    if w.get("steps"):
        print(f"{BOLD}Workflow{RESET}")
        print(f"{'─' * 50}")
        for step in w["steps"]:
            name = step["name"].replace("-", " ").title()
            st = step["status"]
            if st == "completed":
                icon = f"{BGREEN}[✓]{RESET}"
            elif st == "in_progress":
                icon = f"{BYELLOW} ▶ {RESET}"
            else:
                icon = f"{DIM}[ ]{RESET}"
            extra = ""
            if "progress" in step and isinstance(step["progress"], dict):
                p = step["progress"]
                d = int(p.get("done", 0))
                tot = int(p.get("total", 0))
                extra = f" {DIM}({d}/{tot}){RESET}"
            print(f"  {icon} {name}{extra}")
        print()

    # Recommendations
    recs = dashboard.get("recommendations", [])
    if recs:
        print(f"{BOLD}Recommendations{RESET}")
        print(f"{'─' * 50}")
        for r in recs[:5]:
            cat = r["category"]
            icon = {
                "stale": f"{YELLOW}⚠{RESET}",
                "lint": f"{RED}✗{RESET}",
                "coverage": f"{BLUE}○{RESET}",
                "progress": f"{DIM}→{RESET}",
            }.get(cat, "·")
            print(f"  {icon} {r['title']}")
            print(f"    {DIM}{r['reason']}{RESET}")
        print()


def terminal_progress(dashboard):
    s = dashboard["summary"]
    w = dashboard["workflow"]
    print()
    print(f"{BCYAN}┌─────────────────────────────────────────────────────┐{RESET}")
    print(f"{BCYAN}│{RESET} {BOLD}Specification-Driven Development Progress{RESET}           {BCYAN}│{RESET}")
    print(f"{BCYAN}├─────────────────────────────────────────────────────┤{RESET}")
    if w.get("steps"):
        for step in w["steps"]:
            name = step["name"].replace("-", " ").title()
            st = step["status"]
            if st == "completed":
                icon = f"{BGREEN}[✓]{RESET}"
            elif st == "in_progress":
                icon = f"{BYELLOW} ▶ {RESET}"
            elif st == "skipped":
                icon = f"{DIM}[⊘]{RESET}"
            else:
                icon = f"{DIM}[ ]{RESET}"
            outputs = ""
            if "outputs" in step and step["outputs"]:
                first = step["outputs"][0] if isinstance(step["outputs"], list) else step["outputs"]
                outputs = f"  {DIM}{first}{RESET}"
            extra = ""
            if "progress" in step and isinstance(step["progress"], dict):
                p = step["progress"]
                d = int(p.get("done", 0))
                tot = int(p.get("total", 0))
                extra = f"  {bar(d, tot, 10)} {d}/{tot}"
            print(f"{BCYAN}│{RESET}  {icon} {name:<30s}{extra}{outputs}")
    print(f"{BCYAN}└─────────────────────────────────────────────────────┘{RESET}")
    print()
    t = s["tasks"]
    print(f"  Overall: {bar(t['done'], t['total'])} {t['done']}/{t['total']} tasks ({round(t['done']/t['total']*100) if t['total'] else 0}%)")

    # Pending tasks by module
    pending = dashboard.get("pending_tasks", [])
    if pending:
        print()
        print(f"  {BOLD}Pending Tasks{RESET}")
        modules = {}
        for t in pending:
            modules.setdefault(t["module"], []).append(t)
        for mod, mod_tasks in sorted(modules.items()):
            print(f"    {BLUE}{mod}/{RESET}")
            for t in mod_tasks:
                print(f"      {DIM}○{RESET} {t['id']}")
    print()


def terminal_lint(dashboard):
    issues = dashboard.get("lint", [])
    s = dashboard["summary"]["lint"]
    print()
    print(f"{BOLD}Spec Lint Report{RESET}")
    print(f"{'═' * 50}")
    print(f"  {RED}{s['errors']} error(s){RESET}  {YELLOW}{s['warnings']} warning(s){RESET}  {DIM}{s['fixable']} fixable{RESET}")
    print()
    if not issues:
        print(f"  {BGREEN}All clear!{RESET}")
    else:
        for issue in issues:
            sev = issue["severity"].upper()
            color = RED if sev == "ERROR" else YELLOW
            fix = f" {DIM}[fixable]{RESET}" if issue.get("fixable") else ""
            spec = issue.get("spec_id") or "(unregistered)"
            print(f"  {color}{sev:7s}{RESET} {spec:<25s} {issue['message']}{fix}")
            if issue.get("path"):
                print(f"          {DIM}{issue['path']}{RESET}")
    print()


def terminal_next(dashboard):
    recs = dashboard.get("recommendations", [])
    print()
    print(f"{BOLD}What to Specify Next{RESET}")
    print(f"{'═' * 50}")
    if not recs:
        print(f"  {BGREEN}Everything looks good!{RESET}")
    else:
        for i, r in enumerate(recs, 1):
            cat_color = {
                "stale": YELLOW, "lint": RED, "coverage": BLUE, "progress": DIM,
            }.get(r["category"], "")
            print(f"  {BOLD}{i}.{RESET} {cat_color}[{r['category']}]{RESET} {r['title']}")
            print(f"     {DIM}{r['reason']}{RESET}")
            print(f"     Action: {BLUE}{r['action']}{RESET}")
            print()


# ---------------------------------------------------------------------------
# HTML Generation
# ---------------------------------------------------------------------------

def generate_html(dashboard, template_path, output_path, vendor_src_dir, vendor_dst_dir):
    """Generate self-contained HTML dashboard."""
    try:
        with open(template_path, "r") as f:
            template = f.read()
    except FileNotFoundError:
        return

    html = template.replace("{{DASHBOARD_DATA}}", json.dumps(dashboard, indent=2))
    with open(output_path, "w") as f:
        f.write(html)

    # Copy vendor files
    if os.path.isdir(vendor_src_dir):
        os.makedirs(vendor_dst_dir, exist_ok=True)
        for fname in os.listdir(vendor_src_dir):
            src = os.path.join(vendor_src_dir, fname)
            dst = os.path.join(vendor_dst_dir, fname)
            if os.path.isfile(src):
                shutil.copy2(src, dst)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: compute-dashboard.py <project_root> [--terminal status|progress|lint|next]", file=sys.stderr)
        sys.exit(1)

    root = os.path.abspath(sys.argv[1])
    terminal_mode = None
    if "--terminal" in sys.argv:
        idx = sys.argv.index("--terminal")
        terminal_mode = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else "status"

    # Read sources
    registry_path = os.path.join(root, ".specs", "registry.json")
    registry = read_json(registry_path)
    if not registry:
        print("[specdriven] No .specs/registry.json found. Run /specdriven:spec-init first.", file=sys.stderr)
        sys.exit(0)

    progress = parse_progress(root)
    source_dirs = find_source_dirs(root)

    # Compose dashboard
    dashboard = compose_dashboard(root, registry, progress, source_dirs)

    # Write JSON
    dashboard_json_path = os.path.join(root, ".specs", "dashboard.json")
    with open(dashboard_json_path, "w") as f:
        json.dump(dashboard, f, indent=2)

    # Generate HTML
    script_dir = os.path.dirname(os.path.abspath(__file__))
    template_path = os.path.join(script_dir, "dashboard-template.html")
    html_path = os.path.join(root, ".specs", "dashboard.html")
    vendor_src = os.path.join(script_dir, "vendor")
    vendor_dst = os.path.join(root, ".specs", "vendor")
    generate_html(dashboard, template_path, html_path, vendor_src, vendor_dst)

    if terminal_mode:
        # Terminal output
        dispatch = {
            "status": terminal_status,
            "progress": terminal_progress,
            "lint": terminal_lint,
            "next": terminal_next,
            "dashboard": terminal_status,
        }
        fn = dispatch.get(terminal_mode, terminal_status)
        fn(dashboard)
    else:
        # Hook one-liner
        print(f"[specdriven] {dashboard['summary']['one_liner']}")


if __name__ == "__main__":
    main()
