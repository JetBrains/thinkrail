# Bonsai

This project uses specification-driven development.

## Tech Stack
- **Backend:** Python (use `uv` to run Python, pytest, and manage dependencies)
- **Frontend:** TypeScript/JavaScript

## Spec-Driven Rules
1. Check specs before implementing: read existing specs first
2. Create specs before code: use /spec-init, /module-design, etc.
3. Update specs with code: when code changes, update corresponding spec
4. Track progress: use /spec-status to check coverage
5. **Post-implementation alignment check:** After finishing implementation of a task or group of tasks, compare the code against the relevant specs (module README.md, task specs, DESIGN_DOC.md). For each discrepancy found, use AskUserQuestion to ask the user what to do — options should include "Update spec to match code", "Update code to match spec", and "Skip / leave as-is". Address discrepancies one at a time.

## Project Structure
Bonsai is a full-stack application with a Python backend and TypeScript/JavaScript frontend.

## Active Tasks
See current_tasks/ for active work items.

## Specifications
Run /spec-status to see specification coverage.
