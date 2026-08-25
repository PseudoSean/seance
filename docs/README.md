# docs

This directory uses the [PARA](https://fortelabs.com/blog/para/) method to organize documentation, notes, and planning material.

## Structure

- **`projects/`** — Active, time-bound work with a defined outcome. Anything we're currently driving toward a finish line (feature plans, refactors in flight, in-progress investigations). When a project wraps, move it to `archives/`.
- **`areas/`** — Ongoing responsibilities without an end date. Standards, policies, conventions, and long-running concerns we maintain over time (e.g. release process, security posture, performance budgets).
- **`resources/`** — Reference material useful across projects and areas. Background reading, external links, design notes, vendor docs, things we look up rather than act on.
- **`archives/`** — Inactive items from any of the above. Completed projects, retired areas, resources we no longer use. Kept for history; not for active reference.

## Conventions

- One topic per file. Prefer Markdown.
- Name files in `kebab-case.md`.
- When a project completes, move the whole file (or folder) to `archives/` rather than deleting it.
- Plans and design docs live in `projects/` until shipped, then move to `archives/`.
