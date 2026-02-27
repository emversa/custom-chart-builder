# Data Discovery Report — Project Status Dashboard

**Date:** 23 February 2026
**Source file:** `SAMPLE_LUZMO_CC.csv`
**Total rows:** 7,635
**Columns:** CATEGORY, ID, PARENT_ID, ENTITY_NAME, CLIENT, START_DAY, END_DAY, ASSIGNEE, ENTITY_STATUS, HOURS_ESTIMATED, HOURS_BILLED, HOURS_BUDGETED, LINK, COLOR_CODE

---

## 1. Dataset Overview

The dataset represents a project management hierarchy with four entity types. Each row is a single entity (organisation, deal, epic, or story) linked to its parent via the `PARENT_ID` column.

| Category | Rows | % of Total | Description |
|---|---|---|---|
| story | 5,702 | 74.7% | Individual work items / tasks |
| epic | 769 | 10.1% | Groups of related stories |
| deal | 670 | 8.8% | Commercial engagements or project phases |
| organization | 492 | 6.4% | Top-level client entities |

There are also **2 malformed rows**: 1 with a null category and 1 where a comma inside an entity name caused the CSV columns to shift. These should be cleaned up at the source.

---

## 2. Hierarchy Structure

### 2.1 Confirmed Hierarchy

The parent-child relationships in the data confirm the following hierarchy:

```
organisation
  └── deal
        └── epic
              └── story
```

The most common full chain is **organisation → deal → epic → story**, accounting for 1,814 rows.

### 2.2 All Observed Parent-Child Relationships

| Child → Parent | Count | Notes |
|---|---|---|
| story → epic | 4,851 | Primary relationship |
| deal → organization | 653 | Deals sit under organisations |
| deal → deal | 620 | Deals can nest under other deals |
| epic → deal | 567 | Epics sit under deals |
| epic → organization | 406 | Some epics sit directly under organisations |
| story → story | 191 | Some stories are sub-tasks of other stories |

### 2.3 All Hierarchy Chains Found

The table below shows every unique root-to-leaf chain observed in the data, sorted by frequency.

| Chain | Rows |
|---|---|
| organisation → deal → epic → story | 1,814 |
| organisation → epic → story | 1,385 |
| *(orphan)* → epic → story | 868 |
| story *(root, no parent)* | 660 |
| organisation *(root, no children)* | 492 |
| organisation → deal → deal → epic → story | 438 |
| organisation → deal | 408 |
| organisation → deal → epic | 289 |
| epic → story *(no org/deal above)* | 278 |
| organisation → epic | 221 |
| organisation → deal → deal | 193 |
| organisation → deal → epic → story → story | 115 |
| epic *(root, no parent)* | 106 |
| *(orphan)* → epic | 92 |
| organisation → deal → deal → deal → epic → story | 68 |
| organisation → epic → story → story | 57 |
| organisation → deal → deal → epic | 51 |
| organisation → deal → deal → deal | 41 |
| deal *(root, no parent)* | 17 |
| Other chains (< 15 rows each) | 22 |

### 2.4 Key Observations

- **Deals nest under other deals.** 620 deal-to-deal relationships exist, creating chains up to 5 deals deep (e.g., `organisation → deal → deal → deal → deal → deal`).
- **Stories nest under other stories.** 191 story-to-story relationships exist, creating sub-task chains.
- **Some epics sit directly under organisations**, bypassing the deal level entirely (406 cases). This appears to be an intentional pattern for internal or non-commercial work.
- **Depth is variable**, not fixed. The same category can appear at different depths depending on the nesting.

---

## 3. Root-Level Entities

Entities with no `PARENT_ID` (i.e., tree roots):

| Category | Count | Expected? |
|---|---|---|
| organization | 492 | Yes — these are the top-level client entities |
| story | 660 | **Unexpected** — these stories have no parent chain |
| epic | 106 | **Unexpected** — these epics have no parent chain |
| deal | 17 | **Unexpected** — these deals have no parent chain |

The **660 root-level stories** and **106 root-level epics** will appear at the top level of the chart with no indentation, since they cannot be placed under a parent. If these should belong to a specific organisation or deal, their `PARENT_ID` values need to be populated.

---

## 4. Orphan Entities

92 rows have a `PARENT_ID` that does not match any `ID` in the dataset. These entities cannot be placed in the hierarchy.

| Category | Orphan Count | Common PARENT_ID Values |
|---|---|---|
| epic | 92 | `999`, `-1` |

Sample orphan epics:

| ID | ENTITY_NAME | PARENT_ID |
|---|---|---|
| 10685 | Interni reporting | 999 |
| 11021 | Dokumentace Projektu | 999 |
| 11323 | Internal work WA | 999 |
| 11505 | Strategie | -1 |

These appear to be internal/administrative epics using placeholder parent IDs. They will display as root-level items in the chart.

---

## 5. ID Collisions

**430 IDs appear in more than one category.** For example, ID `10` exists as both a `deal` and an `organization`. When the chart builds its lookup table, only one of the two entities can occupy that ID slot — the other is effectively lost.

| Collision Type | Count |
|---|---|
| deal + organization sharing the same ID | 430 |

Sample collisions:

| ID | Categories |
|---|---|
| 2 | deal, organization |
| 3 | organization, deal |
| 10 | deal, organization |
| 12 | organization, deal |
| 14 | organization, deal |

**Impact:** When a deal's `PARENT_ID` is `10`, the chart cannot determine whether it refers to deal `10` or organisation `10` without additional context. The chart now uses category-aware resolution (deals prefer organisation parents, epics prefer deal parents), but truly unique IDs across the full dataset would eliminate this ambiguity.

**Recommendation:** Either use globally unique IDs, or prefix IDs with their category at the data source (e.g., `org_10`, `deal_10`).

---

## 6. Date Completeness

| Category | Total | Both Dates | No Start | No End | No Dates | Start > End |
|---|---|---|---|---|---|---|
| organization | 492 | 61 | 0 | 167 | 264 | 1 |
| deal | 670 | 418 | 0 | 252 | 0 | 75 |
| epic | 769 | 581 | 72 | 25 | 91 | 4 |
| story | 5,702 | 4,074 | 286 | 272 | 1,070 | 92 |

### Key Issues

- **264 organisations (54%) have no dates at all.** This is expected — organisations are grouping entities, not time-bound tasks. The chart derives their date range from their children.
- **1,070 stories (19%) have no dates.** These stories will appear in the hierarchy but cannot be positioned on the timeline. They display with a date range inherited from their parent.
- **75 deals and 92 stories have start date AFTER end date.** This is a data quality issue — the chart will render these as very short bars. The source system should validate that `START_DAY <= END_DAY`.
- **252 deals are missing only the end date.** These may be ongoing/open deals.

---

## 7. CLIENT vs ENTITY_NAME

For all 492 organisation rows, `ENTITY_NAME` is **identical** to `CLIENT` (100% match). This confirms that the `CLIENT` column is derived from the organisation's name.

Every row in the dataset has a `CLIENT` value populated (except the 2 malformed rows), meaning client attribution flows down the hierarchy correctly.

| Category | Has CLIENT | No CLIENT |
|---|---|---|
| organization | 492 | 0 |
| deal | 670 | 0 |
| epic | 768 | 1 |
| story | 5,702 | 0 |

---

## 8. Color Codes

Each category uses a consistent color code:

| COLOR_CODE | Category | Count |
|---|---|---|
| GREY | organization | 492 |
| GREEN | deal | 670 |
| ORANGE | epic | 768 |
| PURPLE | story | 5,702 |

3 rows have a null `COLOR_CODE` (1 epic, 1 null-category row, 1 malformed row).

Note: The data uses the spelling **GREY** (British English). The chart's color mapping has been updated to accept both `GREY` and `GRAY`.

---

## 9. Entity Status

| Status | Count | % |
|---|---|---|
| DONE | 4,867 | 63.7% |
| *(empty)* | 1,165 | 15.3% |
| BACKLOG | 730 | 9.6% |
| To Do | 255 | 3.3% |
| IN-PROGRESS | 176 | 2.3% |
| TO-DO | 117 | 1.5% |
| Done | 106 | 1.4% |
| QA | 61 | 0.8% |
| BLOCKED | 42 | 0.6% |
| Stage & Deploy | 29 | 0.4% |
| Other (8 statuses) | 87 | 1.1% |

### Issues

- **"DONE" vs "Done"** — Two different casings of the same status (4,867 + 106 = 4,973 total). The chart normalises these to lowercase for display.
- **"To Do" vs "TO-DO"** — Two different formats of the same status (255 + 117 = 372 total).
- **1,165 rows (15%) have an empty status.** These are primarily organisation and deal rows where status is not applicable.

**Recommendation:** Standardise status values to a single casing and format in the source data (e.g., always uppercase: `DONE`, `TO-DO`, `IN-PROGRESS`, `BACKLOG`, `BLOCKED`, `QA`).

---

## 10. Hours Data

| Category | Total | Has Billed | Has Estimated | Has Budgeted | All Zero |
|---|---|---|---|---|---|
| organization | 492 | 36 | 36 | 45 | 443 |
| deal | 670 | 133 | 131 | 345 | 300 |
| epic | 769 | 508 | 493 | 0 | 219 |
| story | 5,702 | 3,560 | 3,341 | 0 | 34 |

### Key Observations

- **Epics and stories have zero `HOURS_BUDGETED` across the entire dataset.** Budget data only exists at the organisation and deal level. Progress percentage (billed / budgeted) can only be calculated for organisations and deals.
- **443 organisations (90%) have all-zero hours.** Only 36 have any billed hours.
- **Stories have the richest hours data** — 3,560 of 5,702 have billed hours.

---

## 11. Sample Hierarchy Trees

Below are example hierarchies from the data showing the full parent-child structure.

### Example 1

```
[organization] "Client A" (ID=10)  2024-05-03 → 2025-10-31
  ├── [deal] "Client A - web analytics"  (ID=178)  2024-05-03 → 2025-10-31
  └── [deal] "Reporting"  (ID=416)  2025-05-18 → 2025-08-02
        └── [epic] "Integrace"  (ID=17736)  2025-05-18 → 2025-08-02
              ├── [story] "Looker Data Studio auth issue"  (ID=11412)  2024-04-04 → 2024-09-26
              ├── [story] "[Analysis] Integrace"  (ID=17737)  NO DATES
              ├── [story] "Fakturoid integrace"  (ID=18364)  2025-05-18 → 2025-08-02
              └── ... 10 more stories
```

### Example 2 (deep deal nesting)

```
[organization] "Client B" (ID=100)  2023-12-16 → 2026-02-13
  ├── [deal] "Documentation prep"  (ID=151)  2024-03-15 → 2024-06-30
  │     └── [deal] "K2 - Input analysis"  (ID=474)  NO DATES
  │           └── [epic] "K2 group - input analysis"  (ID=23088)  NO DATES
  │                 └── [story] "K2 group - meetings"  (ID=23090)  NO DATES
  ├── [deal] "01/24 - Project management"  (ID=156)  2024-03-25 → 2024-01-31
  ├── [deal] "02/24 - Project management"  (ID=157)  2024-03-25 → 2024-02-29
  └── ... 31 more deals
```

### Example 3 (organisation with no dates)

```
[organization] "Client C" (ID=101)  NO DATES
  (no children — dates cannot be derived)
```

### Example 4 (epics directly under organisation)

```
[organization] "Client D" (ID=123)  NO DATES
  └── [epic] "Ad-Hoc Q2/2024"  (ID=11401)  2024-01-12 → 2024-07-15
        ├── [story] "Margin mismatch for eshop"  (ID=10398)  2024-01-12 → 2024-01-12
        ├── [story] "Add activity to column"  (ID=10769)  2024-03-09 → 2024-03-31
        └── ... 24 more stories
```

---

## 12. Data Quality Summary

| Issue | Severity | Count | Recommendation |
|---|---|---|---|
| ID collisions across categories | **High** | 430 IDs | Use globally unique IDs or category-prefixed IDs |
| Stories/epics with no parent | **High** | 766 rows | Populate `PARENT_ID` for these rows |
| Orphan rows (parent not found) | **Medium** | 92 rows | Replace placeholder parent IDs (`999`, `-1`) with real IDs or leave null |
| Start date after end date | **Medium** | 172 rows | Validate `START_DAY <= END_DAY` in source system |
| Inconsistent status casing | **Low** | ~478 rows | Standardise to single casing (e.g., `DONE` not `Done`) |
| Inconsistent status naming | **Low** | ~372 rows | Standardise `To Do` / `TO-DO` to a single format |
| Malformed CSV row | **Low** | 1 row | Escape or quote commas in entity names during export |
| No `HOURS_BUDGETED` for epics/stories | **Info** | 6,471 rows | Expected if budgets are only tracked at deal level |
| Missing dates on organisations | **Info** | 264 rows | Expected — the chart derives org dates from children |

---

## 13. Recommendations

1. **Make IDs globally unique.** The 430 collisions between deal and organisation IDs are the single biggest cause of hierarchy breakage. Either use UUIDs or prefix with category at the source (e.g., `org_10`, `deal_10`).

2. **Assign parents to the 660 root-level stories and 106 root-level epics.** These items display as top-level entries with no grouping. If they belong to a specific organisation or deal, their `PARENT_ID` should be set.

3. **Fix 172 rows where start date > end date.** These render as incorrectly positioned bars on the timeline.

4. **Replace orphan parent IDs.** The 92 epics pointing to `PARENT_ID = 999` or `-1` should either be given a real parent or have the field set to null.

5. **Standardise status values.** Merge `DONE`/`Done`, `To Do`/`TO-DO`, and `IN-PROGRESS`/`In Progress` into a single canonical value per status.

---

## 14. Original Sample vs Production Data — Why a Rebuild Was Required

The component was originally built against a 10-row sample file (`SAMPLE_ORIGINAL.csv`) provided by the client during the initial briefing. When the component was connected to the live production dataset (`SAMPLE_LUZMO_CC.csv`, 7,635 rows), it broke in multiple fundamental ways. The two datasets differ in almost every dimension — scale, column naming, ID format, hierarchy structure, data completeness, and value conventions. The sections below document every difference and the engineering effort required to adapt the component.

### 14.1 Scale

| | Original Sample | Production Data | Factor |
|---|---|---|---|
| **Total rows** | 10 | 7,635 | **763x** |
| Organizations | 3 | 492 | 164x |
| Deals | 1 | 670 | 670x |
| Epics | 4 | 769 | 192x |
| Stories | 2 | 5,702 | 2,851x |

The original query limit was set to 100 rows — sufficient for the sample but silently truncating 99% of the production dataset. This was the first issue identified.

### 14.2 Column Names

Five of the 14 columns were renamed between the original sample and production. The column count and order also changed.

| Original Column | Production Column | Notes |
|---|---|---|
| `NAME` | `ENTITY_NAME` | Renamed |
| `START_DATE` | `START_DAY` | Renamed |
| `END_DATE` | `END_DAY` | Renamed |
| `STATUS` | `ENTITY_STATUS` | Renamed |
| `JIRA_LINK` | `LINK` | Renamed |
| `ID` (1st column) | `CATEGORY` (1st column) | Column order swapped |

The component's column-index mapping was built to match the original column order. With the production data in a different order, every field was reading from the wrong column — names appeared as dates, IDs appeared as statuses, etc.

### 14.3 ID Format

| | Original Sample | Production Data |
|---|---|---|
| **Format** | Human-readable, category-prefixed strings | Raw numeric integers |
| **Globally unique** | Yes — `ORG_COATES`, `EPIC_FREIGHT_UI`, `STORY_DESIGN_SYS` | **No** — 430 IDs shared between categories |
| **Examples** | `ORG_COATES`, `EPIC_ANALYTICS_SUITE`, `DEAL_COATES_2025` | `10`, `100`, `12` |

The original sample used self-documenting IDs with built-in category prefixes. There was zero risk of collision — `ORG_COATES` could never be confused with `EPIC_COATES`. The production data uses plain numeric IDs sourced from different systems (Pipedrive for deals, Jira for epics/stories), so ID `10` exists as both an organisation and a deal. This required building a composite ID system (`organization_10`, `deal_10`) and category-aware parent resolution logic that did not exist in the original component.

### 14.4 Hierarchy Structure

**Original sample — flat, predictable, max 3 levels:**
```
organization → epic → story    (2 chains)
organization → epic            (4 chains)
organization → deal            (1 chain)
organization                   (3 roots)
```
- Maximum depth: 2 (org → epic → story)
- Every non-root row has a valid parent
- No nesting within the same category
- Deals and epics sit directly under organisations

**Production data — deep, variable, up to 6+ levels:**
```
organisation → deal → epic → story                          1,814 rows
organisation → epic → story                                 1,385 rows
(orphan) → epic → story                                       868 rows
story (root, no parent)                                        660 rows
organisation → deal → deal → epic → story                      438 rows
organisation → deal → deal → deal → epic → story                68 rows
organisation → deal → epic → story → story                     115 rows
... and 15 more chain patterns
```
- Maximum depth: 6+ (`org → deal → deal → deal → epic → story`)
- **Deals nest under other deals** — 620 deal-to-deal relationships
- **Stories nest under other stories** — 191 story-to-story relationships
- **660 stories and 106 epics have no parent at all** — they float as roots
- **92 epics are orphans** — their `PARENT_ID` (`999`, `-1`) does not exist in the dataset

The original component used a fixed depth mapping (`organization: 0, epic: 1, story: 2, deal: 1`). This was completely inadequate for production data where the same category can appear at any depth. The entire depth system had to be rewritten to walk the actual parent chain dynamically.

### 14.5 Date Completeness

| | Original Sample | Production Data |
|---|---|---|
| **Rows missing dates** | 0 / 10 (0%) | 2,501 / 7,635 (33%) |
| **Organisations without dates** | 0 / 3 | 264 / 492 (54%) |
| **Stories without dates** | 0 / 2 | 1,070 / 5,702 (19%) |
| **Start date > End date** | 0 | 172 rows |

The original sample had dates on every single row. The component's date validation (`if (!startDate || !endDate) return`) was safe for the sample but catastrophic for production — it silently discarded 264 organisation rows (the top-level grouping parents), which in turn orphaned every deal, epic, and story beneath them. The entire hierarchy collapsed into a flat, ungrouped list.

The fix required keeping all dateless rows, assigning sentinel dates, and implementing recursive bottom-up date propagation so that parent rows automatically derive their date range from their children.

### 14.6 Status Values

| | Original Sample | Production Data |
|---|---|---|
| **Distinct values** | 5 | 19 |
| **Format** | Consistent lowercase | Mixed casing and formats |
| **Values** | `active`, `at risk`, `completed`, `in planning`, `pipeline` | `DONE`, `Done`, `BACKLOG`, `To Do`, `TO-DO`, `IN-PROGRESS`, `In Progress`, `QA`, `BLOCKED`, `ESTIMATION`, `TESTING`, `UAT`, `Stage & Deploy`, `APPROVAL`, `Open`, `On Hold`, `Waiting for customer`, `Waiting for support`, *(empty)* |

The original 5 statuses were each mapped to a specific colour in the component. The production data introduced 14 new status values in inconsistent casing, none of which matched the original mapping.

### 14.7 Color Code Spelling

| | Original Sample | Production Data |
|---|---|---|
| **Grey/Gray** | `GRAY` (American spelling) | `GREY` (British spelling) |

All 492 organisation rows in production use `GREY`. The component only recognised `GRAY`. Organisations defaulted to purple instead of grey.

### 14.8 Visual Requirements

The original sample had 2 stories — the chart was essentially a small demo with every row rendering an identical full-colour bar. At production scale (5,702 stories, 769 epics, 670 deals, 492 organisations), rendering full bars for all 7,635 rows made the chart unreadable. The component had to be redesigned so that only `story` rows render full timeline bars, while organisations, deals, and epics render as thin span lines — acting as visual hierarchy containers rather than individual work items.

### 14.9 Summary of Differences

| Dimension | Original Sample | Production Data | Impact |
|---|---|---|---|
| Scale | 10 rows | 7,635 rows | Query limit had to be increased 100x |
| Column names | `NAME`, `START_DATE`, etc. | `ENTITY_NAME`, `START_DAY`, etc. | Column mapping logic rewritten |
| Column order | `ID` first | `CATEGORY` first | Index-based mapping broke entirely |
| ID format | `ORG_COATES` (unique) | `10` (430 collisions) | Composite ID system built from scratch |
| Hierarchy depth | Max 2 levels | Max 6+ levels | Fixed depth replaced with dynamic parent-chain walking |
| Nesting | No same-category nesting | Deals nest under deals, stories under stories | Parent resolution logic rewritten |
| Orphan rows | 0 | 875 (660 stories + 106 epics + 17 deals + 92 orphan epics) | Filtering to exclude entities without an organisation root |
| Missing dates | 0% | 33% of rows | Date validation removed; bottom-up date propagation added |
| Inverted dates | 0 | 172 rows | Graceful handling added |
| Status values | 5 (consistent) | 19 (inconsistent casing) | Status normalisation required |
| Color spelling | `GRAY` | `GREY` | Alias added |
| Bar rendering | All rows identical | Only stories should have bars | Rendering logic split by category |

### 14.10 Engineering Effort

The gap between the original sample and the production data required changes to **3 source files** across **9 distinct fixes**, touching the core data processing pipeline, the query builder, the hierarchy engine, and the rendering logic:

- **Data processing** (`processData`): 5 rewrites — composite IDs, dateless row handling, dynamic depth computation, bottom-up date propagation, organisation-root filtering
- **Query infrastructure** (`buildQuery`, `getData.ts`, `app.component.ts`): 3 fixes — query limit, column ordering, aggregation handling
- **Rendering** (`renderProjectRows`): 1 rewrite — category-aware bar rendering

The root cause is that the original sample was a clean, small, idealised dataset that did not represent the structural complexity, data quality issues, or scale of the production data. A production-representative sample at the briefing stage — even 100-200 rows with real hierarchy nesting, missing dates, and numeric IDs — would have surfaced these issues before the component was built, avoiding the need for a significant post-delivery rebuild.

---

## 15. Issues Found and Fixes Applied

The following issues were identified during data discovery and development, and have been resolved in the chart codebase.

### 15.1 Query Limit Truncating 99% of Data

| | |
|---|---|
| **Problem** | The API query was limited to 100 rows. The dataset contains 7,635 rows, meaning 99% of data was silently discarded. The chart only ever displayed a random subset of ~100 items. |
| **Root cause** | Hardcoded `limit: { by: 100 }` in the chart's `buildQuery` function. |
| **Fix** | Increased to `limit: { by: 10000 }` to accommodate the full dataset. |
| **File** | `projects/custom-chart/src/chart.ts` — `buildQuery` function (two occurrences). |

### 15.2 ID Collisions Breaking Parent-Child Links

| | |
|---|---|
| **Problem** | 430 IDs are shared between the `deal` and `organization` categories (e.g., ID `10` exists as both). The chart stored entities in a flat map keyed by ID, so the second entity overwrote the first. When a child referenced `PARENT_ID = 10`, it could link to the wrong entity type, breaking the hierarchy. |
| **Root cause** | IDs were used as-is without considering category. |
| **Fix** | IDs are now internally prefixed with the category to create unique composite keys (e.g., `organization_10`, `deal_10`). When resolving parent links, the chart uses category-aware priority rules: deals prefer organisation parents, epics prefer deal parents, stories prefer epic parents. |
| **File** | `projects/custom-chart/src/chart.ts` — `processData` function. |

### 15.3 Dateless Rows Discarded (Hierarchy Parents Lost)

| | |
|---|---|
| **Problem** | 264 organisations, 91 epics, and 1,070 stories have no start/end dates. The chart was discarding any row without valid dates. Since most organisations lack dates, the entire top level of the hierarchy was being removed — all deals, epics, and stories below them became orphans with no visible grouping. |
| **Root cause** | A strict date validation check (`if (!startDate \|\| !endDate) return`) skipped any row missing dates, regardless of its role in the hierarchy. |
| **Fix** | All rows are now kept regardless of date completeness. Rows without dates receive sentinel values which are then replaced by their children's date range via bottom-up recursive propagation. If no children have dates either, the row falls back to the global min/max date range. |
| **File** | `projects/custom-chart/src/chart.ts` — `processData` function. |

### 15.4 Fixed Depth Mapping vs Variable-Depth Hierarchy

| | |
|---|---|
| **Problem** | The chart assigned hierarchy depth based on a fixed category-to-depth mapping (`organization: 0, deal: 1, epic: 2, story: 3`). In reality, deals nest under other deals (up to 5 levels deep) and stories nest under other stories. A story at the end of an `org → deal → deal → deal → epic → story` chain should be at depth 5, not a fixed depth of 3. |
| **Root cause** | A static `CATEGORY_DEPTH` constant. |
| **Fix** | Depth is now computed dynamically by walking the actual parent chain for each entity. A root organisation gets depth 0, its direct child deal gets depth 1, a deal nested under that deal gets depth 2, and so on — regardless of category. |
| **File** | `projects/custom-chart/src/chart.ts` — `processData` function. |

### 15.5 Orphan Entities Cluttering the Top Level

| | |
|---|---|
| **Problem** | 660 stories, 106 epics, and 17 deals have no `PARENT_ID` (or their parent chain doesn't reach an organisation). These appeared at the top level of the chart alongside organisations, making the display messy and ungrouped. |
| **Root cause** | No filtering — every row from the query was displayed regardless of whether it fit into the hierarchy. |
| **Fix** | After building the hierarchy, the chart now filters out any entity that does not trace back to an `organization` root. Only entities with a complete chain to an organisation are displayed. Orphan items are excluded. This means the top level of the chart is **exclusively organisations**. |
| **Impact** | ~875 rows are excluded from the chart. These rows need their `PARENT_ID` values populated in the source data to appear (see Section 13, Recommendation 2). |
| **File** | `projects/custom-chart/src/chart.ts` — `processData` function. |

### 15.6 All Categories Rendering Full Timeline Bars

| | |
|---|---|
| **Problem** | Every row — organisations, deals, epics, and stories — rendered an identical full-colour timeline bar. This made it impossible to distinguish leaf-level work items from grouping containers, and visually overwhelmed the chart. |
| **Root cause** | The bar rendering code treated all categories identically. |
| **Fix** | Only `story` rows now render a full coloured bar (with status indicator, assignee initials, hours badge, and progress fill). Organisation, deal, and epic rows render as a thin span line with start/end dot markers — enough to show their date range without visual clutter. |
| **File** | `projects/custom-chart/src/chart.ts` — `renderProjectRows` function. |

### 15.7 COLOR_CODE "GREY" Not Recognised

| | |
|---|---|
| **Problem** | All 492 organisation rows use `COLOR_CODE = GREY` (British spelling). The chart's colour map only contained `GRAY` (American spelling), causing organisations to fall through to the default purple colour. |
| **Root cause** | Missing alias in the `COLOR_MAP` constant. |
| **Fix** | Added `GREY: '#94A3B8'` as an alias alongside the existing `GRAY` entry. |
| **File** | `projects/custom-chart/src/chart.ts` — `COLOR_MAP` constant. |

### 15.8 Builder Column Order Mismatch

| | |
|---|---|
| **Problem** | The builder's query helper (`getData.ts`) iterated slots in manifest order, while the chart's `processData` expected columns in `buildQuery` order. When both existed, the column indices were misaligned — every field mapped to the wrong column. |
| **Root cause** | Two independent iteration orders that were never synchronised. |
| **Fix** | The builder now iterates slots in the exact same order as the chart's `buildQuery` function: required dimensions first (`name`, `category`, `time`, `evolution`), then optional dimensions in the same sequence (`row`, `destination`, `identifier`, `dimension`, `color`, `levels`, `slidermetric`, `measure`, `columns`, `size`). |
| **File** | `projects/builder/src/app/helpers/getData.ts`. |

### 15.9 Hours Columns Sent as Aggregated Measures

| | |
|---|---|
| **Problem** | When dropping hours columns (Billed, Estimated, Budgeted) into the builder, they were automatically assigned `aggregationFunc: 'sum'` and sent to the Luzmo API as measures. This caused the API to group and collapse rows — multiple distinct projects with the same attributes were merged into a single row with summed hours. |
| **Root cause** | The `onColumnDropped` handler applied `aggregationFunc: 'sum'` to all numeric slots, ignoring the `isAggregationDisabled: true` option set in the manifest for hours slots. The same issue existed in `getData.ts`, which sent numeric slots as measures regardless of this flag. |
| **Fix** | Both `onColumnDropped` (in `app.component.ts`) and `buildLuzmoQuery` (in `getData.ts`) now check `slotConfig.options.isAggregationDisabled`. When true, numeric columns are sent as **dimensions** (no aggregation) instead of measures, preserving every individual row. |
| **Files** | `projects/builder/src/app/app.component.ts` — `onColumnDropped` method; `projects/builder/src/app/helpers/getData.ts` — `buildLuzmoQuery` function. |

---

### Summary of All Changes

| # | File | Change |
|---|---|---|
| 1 | `chart.ts` — `buildQuery` | Query limit `100` → `10000` |
| 2 | `chart.ts` — `processData` | Composite IDs (`category_id`) to prevent 430 collisions |
| 3 | `chart.ts` — `processData` | Keep all dateless rows; propagate dates bottom-up from children |
| 4 | `chart.ts` — `processData` | Compute depth from actual parent chain instead of fixed category mapping |
| 5 | `chart.ts` — `processData` | Filter out entities that don't trace back to an organisation root |
| 6 | `chart.ts` — `renderProjectRows` | Only `story` rows get full bars; other categories get thin span lines |
| 7 | `chart.ts` — `COLOR_MAP` | Added `GREY` alias alongside `GRAY` |
| 8 | `getData.ts` — `buildLuzmoQuery` | Iterate slots in `buildQuery` order; treat `isAggregationDisabled` numeric slots as dimensions |
| 9 | `app.component.ts` — `onColumnDropped` | Respect `isAggregationDisabled` — don't force `aggregationFunc: 'sum'` on hours slots |
