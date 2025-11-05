# KPI Status Widget Component

## Component Overview

**Type:** Data Visualization Widget
**Category:** Status Monitoring / KPI Dashboard Component
**Framework:** Luzmo Custom Chart (D3.js + TypeScript)
**Responsive:** Yes (adaptive layout with clamp-based scaling)

## Purpose

The KPI Status Widget is a composite visualization component designed for at-a-glance monitoring of categorical KPIs and record distribution across status values. It combines a donut chart with an annotated legend to provide both proportional visualization and precise numerical breakdowns of record counts across status categories.

**Primary Use Cases:**
- Device status monitoring (Online/Offline/Maintenance)
- Task state tracking (Active/Inactive/Pending)
- Boolean metric visualization (TRUE/FALSE, Pass/Fail)
- Health status overviews (Healthy/Warning/Error)
- Multi-state categorical distributions

## Visual Design

### Layout Structure
```
┌─────────────────────────────────────────────┐
│ [Title]                                     │
│                                             │
│  ┌──────────────────┐    ┌──────────────┐ │
│  │ ■ Category 1     │    │              │ │
│  │   Count: 123     │    │    Donut     │ │
│  │                  │    │    Chart     │ │
│  │ ■ Category 2     │    │   Center:    │ │
│  │   Count: 456     │    │     85%      │ │
│  │                  │    │              │ │
│  │ ■ Category 3     │    │              │ │
│  │   Count: 789     │    │              │ │
│  └──────────────────┘    └──────────────┘ │
│   Legend (60%)              Chart (40%)    │
└─────────────────────────────────────────────┘
```

### Design System

**Typography:**
- Font Family: Roboto (system fallback: -apple-system, BlinkMacSystemFont, Segoe UI)
- Title: 16-20px, weight 700
- Legend Labels: 11-13px, weight 300
- Legend Counts: 20-28px, weight 300
- Center Metric: Dynamic sizing (0.35-0.42 × radius), weight 300

**Color Palette:**
- Primary Status Colors:
  - Green (#75BB43): Success/Active/Healthy state
  - Red (#BA1A1A): Error/Inactive/Critical state
  - Yellow (#FEC325): Warning/Pending state
- Background Mapping:
  - Green → #DDF3CD (light green tint)
  - Yellow → #FFEFD4 (light yellow tint)
  - Red → #FFE2E4 (light red tint)
- Extended palette available for 4+ categories

**Spacing & Dimensions:**
- Component padding: clamp(12px, 3vh, 20px)
- Legend item gap: clamp(4px, 1.5vh, 16px)
- Color indicator: 4px wide × clamp(28px, 5vh, 40px) tall
- Donut outer radius: ~45% of container width (80-260px)
- Inner radius: 60% of outer radius

### Component States

**Default State:**
- Shows all categories with counts
- Center displays percentage of primary metric (configurable)
- Background color reflects dominant category (highest count)
- Maintains consistent height for 1-3 legend items

**Hover State:**
- Legend items: translate(4px) + subtle background overlay
- Donut segments: expand by 8px + enhanced shadow
- Tooltip displays: category name, record count, percentage

**Selected State:**
- Visual feedback on legend item (persistent hover state)
- Component re-renders with filtered data
- Center metric recalculates based on selection
- Click again to deselect and reset

**Empty State:**
- Displays placeholder icon (📊)
- Guidance text: "Add a Status Attribute and Record ID to get started"
- Centered layout

## Data Requirements

### Required Slots

**1. Status Attribute (category)**
- Type: Categorical (hierarchy)
- Purpose: Primary grouping dimension
- Example: Status column with values "Active", "Inactive", "Offline"
- Behavior: Values are grouped and counted; each unique value becomes a legend item

**2. Record ID (identifier)**
- Type: Categorical (hierarchy, datetime, or numeric)
- Purpose: Unique record identifier for accurate counting
- Example: Device_ID, Transaction_ID, Timestamp
- Critical: Prevents data aggregation; ensures row-level counting
- Binning disabled to preserve uniqueness

### Optional Slots

**3. Order (measure)**
- Type: Numeric
- Purpose: Controls color assignment and center metric selection
- Configuration method: Derived column (e.g., `_ORDER`)
- Mapping:
  - 0 → Green (#75BB43) + displays as center %
  - 1 → Red (#BA1A1A)
  - 2 → Yellow (#FEC325)
  - 3+ → Extended palette colors
- Fallback: Alphabetical sorting if omitted

**4. Title (legend)**
- Type: Categorical (hierarchy)
- Purpose: Custom component title
- Behavior: Uses **column name** (not values) as title
- Fallback: Shows Status Attribute column name
- Layout: Title hidden (opacity 0) but space preserved when empty

## Interaction Model

### User Interactions

**Click on Legend Item or Donut Segment:**
1. Filters dashboard to selected category
2. Sends `setFilter` event with WHERE clause
3. Re-renders component with filtered data
4. Recalculates counts and percentages
5. Updates background color to reflect filtered state
6. Click same item again to clear filter

**Hover on Donut Segment:**
- Displays positioned tooltip with:
  - Category name
  - Record count
  - Percentage of total
- Tooltip auto-positions to stay within bounds
- Smooth fade transitions (200ms)

### Event System

**Outbound Events:**

1. **Filter Event** (`setFilter`)
   ```javascript
   {
     type: 'setFilter',
     filters: [{
       expression: '? = ?',
       parameters: [
         { column_id: '...', dataset_id: '...' },
         'Active'  // selected category value
       ],
       properties: {
         origin: 'filterFromVizItem',
         type: 'where'
       }
     }]
   }
   ```

2. **Custom Event** (`customEvent`)
   ```javascript
   {
     type: 'customEvent',
     data: {
       eventType: 'statusCategorySelected',
       category: 'Active',
       count: 123,
       totalRecords: 456,
       isFiltered: true
     }
   }
   ```

## Technical Implementation

### Data Processing Flow

1. **Query Construction** (`buildQuery`)
   - Requests row-level data (not aggregated)
   - Includes Status Attribute + Record ID as dimensions
   - Optionally includes Order column as dimension
   - No limit applied (processes all records)

2. **Data Extraction**
   - Handles Luzmo object structure: `{id, name, color, order}`
   - Extracts `.id` field as actual value
   - Maintains raw records for filtering operations

3. **Aggregation**
   - Groups records by Status Attribute value
   - Counts unique Record IDs per category using `Set()`
   - Preserves order values for color/metric mapping

4. **Color Assignment**
   - With Order column: Direct mapping (order value → color index)
   - Without Order column: Alphabetical position → color index
   - Ensures consistent color-to-category mapping

5. **Center Metric Calculation**
   - With Order column: Shows percentage of order=0 category
   - Without Order column: Uses `centerMetricIndex` config (default: 1)
   - Format: "85%" or total count

6. **Background Color Selection**
   - Identifies dominant category (highest count)
   - Maps category color to predefined light background
   - Dynamically updates on filter changes

### Rendering Pipeline

1. **Container Initialization**
   - Clear existing content
   - Create widget root with status-widget class
   - Apply dynamic background color

2. **Title Rendering**
   - Always rendered (space preservation)
   - Uses custom title from slot or attribute name
   - Hidden with opacity:0 when empty

3. **Layout Construction**
   - Horizontal layout (desktop-first)
   - Left: Categories list (60% flexible)
   - Right: Donut chart (40% fixed)
   - Maintains minimum height for 3 legend rows

4. **Legend Rendering**
   - Iterates sorted categories
   - Color indicator + label + count per item
   - Applies selected state if active filter

5. **Donut Chart Rendering** (D3.js)
   - Calculate dimensions based on container width
   - Create SVG with pie layout
   - Render colored arcs with transitions
   - Add center text (metric)
   - Attach interaction handlers

6. **Tooltip Management**
   - Create positioned div overlay
   - Bind mouseover/mouseout events
   - Calculate smart positioning (edge detection)

### Responsive Behavior

**Breakpoint Strategy:**
- No breakpoint switching (horizontal layout maintained)
- Fluid scaling using CSS clamp() functions
- Component adapts to container size

**Scaling Ranges:**
- Font sizes: 11-28px (contextual)
- Padding: 12-20px
- Gaps: 4-16px
- Color indicator height: 28-40px
- Donut size: 80-260px

**Small Screen Adaptations** (<600px):
- Reduced padding (16px)
- Smaller font sizes
- Tighter gaps
- Shorter color indicators

**Very Small Screens** (<400px):
- Further reduced dimensions
- Minimum readable sizes maintained

## Configuration & Customization

### Hardcoded Configuration
Located in `DEFAULT_CONFIG` object in `chart.ts`:

```typescript
{
  title: 'KPI Status',
  colors: [
    '#75BB43',  // Green (index 0)
    '#BA1A1A',  // Red (index 1)
    '#FEC325',  // Yellow (index 2)
    // + 5 additional colors
  ],
  centerMetricIndex: 1  // Shows 2nd alphabetical value
}
```

### Runtime Configuration
- Order column provides user-controlled color/metric mapping
- Title column provides user-controlled component title
- No UI-based configuration (by design)

### Workaround: Derived Columns
Users can create calculated dataset columns to control behavior:
- `_ORDER` column: Assigns order values to categories
- `_TITLE` column: Provides custom title via column name

## Accessibility Considerations

**Keyboard Navigation:**
- Not currently implemented (enhancement opportunity)

**Screen Readers:**
- Semantic HTML structure
- Text alternatives for visual elements present
- Color not sole indicator (counts provided)

**Color Contrast:**
- Text color auto-calculated based on background luminance
- High contrast mode support via system fonts
- Color indicators supplemented with labels

**Reduced Motion:**
- Transitions respect user preferences (CSS-based)

## Performance Characteristics

**Data Limits:**
- No explicit row limit in query
- Client-side processing of full dataset
- Set-based unique counting (O(n) complexity)
- Suitable for datasets: 1-100K records

**Rendering Performance:**
- Single render pass
- D3.js hardware-accelerated SVG
- Minimal DOM manipulation
- Efficient re-renders on filter changes

**Bundle Size:**
- Total: ~21.5 KB (minified)
- JavaScript: ~54.5 KB (pre-gzip)
- CSS: ~3.5 KB (minified)

## Integration Guidelines

### Implementation Steps

1. **Data Preparation**
   - Ensure unique identifier column exists
   - Create status/category column with clear values
   - Optionally create `_ORDER` derived column for control

2. **Component Configuration**
   - Drag Status Attribute to required slot
   - Drag Record ID to required slot
   - Optionally add Order and Title columns

3. **Dashboard Integration**
   - Place in dashboard grid
   - Connect filter interactions to other components
   - Test responsive behavior at target sizes

### Best Practices

- **Naming Clarity:** Use descriptive category values (avoid codes)
- **Value Count:** Optimal: 2-5 categories; Supported: 1-8+
- **Order Column:** Critical for non-alphabetical color logic
- **Title Strategy:** Use column name strategically (becomes visible text)
- **Filter Coordination:** Test cross-filtering with other dashboard items

### Limitations

- No built-in export functionality
- No animation control options
- Fixed donut proportions (60% inner radius)
- Horizontal-only layout (no vertical stacking)
- Color customization requires code changes

## Example Use Cases

### Use Case 1: Device Status Monitoring
**Scenario:** IoT dashboard tracking 10,000 devices

**Data Setup:**
- Status Attribute: `DEVICE_STATUS` (Online, Offline, Maintenance)
- Record ID: `DEVICE_ID`
- Order: `_STATUS_ORDER` (0=Online, 1=Offline, 2=Maintenance)

**Result:**
- Green background when majority online
- Center shows % of online devices
- Click to filter dashboard to specific status

### Use Case 2: Task Completion Tracking
**Scenario:** Project management dashboard

**Data Setup:**
- Status Attribute: `TASK_STATE` (Complete, In Progress, Blocked, Not Started)
- Record ID: `TASK_ID`
- Order: `_PRIORITY` (0=Complete, 1=In Progress, 2=Blocked, 3=Not Started)

**Result:**
- Visual completion percentage in center
- Quick identification of blocked tasks
- Filter to view specific task states

### Use Case 3: Boolean Flag Visualization
**Scenario:** Feature flag adoption tracking

**Data Setup:**
- Status Attribute: `FEATURE_ENABLED` (TRUE, FALSE)
- Record ID: `USER_ID`
- Order: `_FLAG_ORDER` (0=TRUE, 1=FALSE)

**Result:**
- Center shows % of users with feature enabled
- Green when adoption is high
- Quick toggle between enabled/disabled user segments

## Troubleshooting

### Issue: Colors don't match expected values
**Solution:** Check alphabetical sorting of values. Use Order column to override.

### Issue: Counts seem incorrect
**Solution:** Verify Record ID column contains unique values. Check for null values.

### Issue: Center metric shows wrong percentage
**Solution:** Verify Order column mapping (0-based index). Check `centerMetricIndex` config.

### Issue: Component height inconsistent
**Solution:** Title slot may be toggling visibility. Ensure min-height CSS rules are applied.

### Issue: Background color not updating
**Solution:** Check that dominant category color matches color map. Verify color HEX values are uppercase in comparison.

## File Structure

```
projects/custom-chart/
├── src/
│   ├── chart.ts          # Main component logic
│   ├── chart.css         # Component styling
│   ├── icon.svg          # Component icon (donut with %)
│   ├── manifest.json     # Slot configuration
│   └── index.ts          # Entry point
├── package.json
└── tsconfig.json
```

## Dependencies

- **D3.js** (v7+): SVG rendering and data visualization
- **@luzmo/analytics-components-kit**: Utility functions
- **@luzmo/dashboard-contents-types**: TypeScript types

## Version History

**v1.0** (2025-11-05)
- Initial production release
- Fixed background color mapping (#DDF3CD for green)
- Updated yellow color to #FEC325
- Changed font-weights to 300 for lighter appearance
- Added donut chart icon

---

**Component Status:** Production-ready
**Branch:** `kpi-component`
**Maintainer:** Custom Chart Development Team
**Last Updated:** 2025-11-05
