# Custom Chart — Fix Notes

## Round 1: Filter Fixes

### Issues Reported

1. **Combined filters showing empty chart**: When filtering by Client and then additionally by Category (e.g., "deal"), the chart displayed "No Project Data Available" instead of showing the matching rows.

2. **Project Name click not returning subcategories**: Clicking an organisation row in the chart filtered only to that single row. The expected behaviour was to show the full project hierarchy (deals, epics, stories) belonging to that organisation.

### Root Cause

**Empty chart on combined filters** — The chart includes a data integrity check that validates every row can trace its parent chain back to an organisation root. When dashboard filters narrow the dataset (e.g., showing only deals), the parent organisation rows are no longer present. The integrity check discards every row and the chart falls through to an empty state.

A second, deeper cause was found specific to certain clients (e.g., BAIGAFCAEHDCGCHJEHI): 430 IDs in the production dataset are shared between deals and organisations. For this client, deal ID=23 has parent_id=23 — a self-reference. When filtering to deals only, deal_23 becomes its own parent. In the hierarchy builder, it is added as a child of itself rather than as a root, so the roots array ends up empty.

**Project Name returning a single row** — Clicking an organisation row sent a filter on the name column. Since each entity has a unique name, only the one matching row was returned. Children have different names and were excluded.

### What Was Fixed

1. **Self-referencing parent IDs**: Parent resolution now detects when a row's parentId resolves to its own compositeId and nullifies it. The hierarchy builder also treats self-references as roots. This fixes the deal-specific empty state for clients like BAIGAFCAEHDCGCHJEHI.

2. **Fallback for tracesToOrg**: The integrity check now tests its result before applying it. If filtering would remove all rows, the chart keeps the original data and treats orphaned rows as top-level items.

3. **Organisation click filters by Client**: Clicking an organisation row now filters by the Client column instead of the name column, returning the full hierarchy under that client.

4. **Subtree filtering for non-organisation rows**: Clicking a deal, epic, or any row with children now collects all descendant IDs from the hierarchy and sends a `? in ?` filter on the project ID column. This returns the clicked entity and all its children (epics, stories, etc.). Previously, clicking a deal like "Dine4Fit - Autorizace FB" would only return that single row because it filtered by name. Now it returns the deal and all its child epics and stories. Leaf nodes (rows without children) still filter by name.

---

## Round 2: Edge Case Hardening

A deep analysis of the production dataset (7,633 rows) and full code audit identified several additional edge cases. All have been fixed.

### Issues Found & Fixed

**P0 — Security: XSS in tooltips**

The tooltip rendered project names, client names, status, and assignee values as raw HTML using D3's `.html()` method. The production dataset contains 371 rows with special characters (`&`, `"`, `'`, `<`, `>`) that could break rendering or allow script injection.

*Fix*: All user-supplied values in tooltips are now escaped through an `escapeHtml()` function that encodes `&`, `<`, `>`, `"`, and `'`. Long names (>80 characters) are truncated with ellipsis.

**P0 — Security: URL protocol validation**

Bar click handlers opened link URLs without validating the protocol. A link value of `javascript:alert(1)` would execute arbitrary code.

*Fix*: Links are now validated against `^https?://` before rendering the SVG `<a>` element or attaching click handlers. Non-HTTP(S) URLs are ignored.

**P1 — Inverted dates (start > end)**

172 rows in the production dataset have start_date after end_date (75 deals, 92 stories, 4 epics, 1 organisation). These produced bars rendered at incorrect positions.

*Fix*: When start_date > end_date, the values are automatically swapped so the bar renders in the correct time range.

**P2 — Status colour mapping**

The chart had 5 status colours (active, at risk, completed, in planning, pipeline), but the production dataset uses 19 different status values (DONE, BACKLOG, To Do, IN-PROGRESS, QA, BLOCKED, etc.) with inconsistent casing. All rows were falling back to the default "active" colour.

*Fix*: Added all 19 production status values to the colour map. Status lookup uses `.toLowerCase()` so casing variations (DONE vs Done, IN-PROGRESS vs In Progress) resolve correctly.

**P3 — Long names in tooltips**

Entity names up to 217 characters exist in the dataset. These could overflow the tooltip beyond the viewport.

*Fix*: Tooltip names are truncated to 80 characters with ellipsis. The left panel already handles long names via CSS `text-overflow: ellipsis`.

### Data Quality Notes (no code changes needed)

The following data characteristics were identified during analysis. They are handled by existing code and do not require fixes, but are documented for awareness:

- **6,358 orphan rows (83%)**: Parent IDs reference entities not in the dataset. These are treated as top-level items when the tracesToOrg filter is skipped.
- **811 hierarchy violations**: Deals parenting to deals (620) and stories parenting to stories (191). Handled by the PARENT_CATEGORY_PRIORITY resolution logic.
- **1,162 rows with empty status**: Default to "active" status.
- **226 clients with only 1 row**: Likely single-entity organisations without child records.
- **All colour codes are valid**: PURPLE, ORANGE, GREEN, GREY — no unknowns.
- **All links are valid HTTP(S) URLs**: No malformed links in production data.
