import type {
  ItemData,
  ItemFilter,
  ItemThemeConfig,
  ItemQuery,
  Slot,
  SlotConfig
} from '@luzmo/dashboard-contents-types';
import * as d3 from 'd3';

// Data structures
interface StatusCategory {
  name: string;
  count: number;
  color: string;
  columnId?: string;
  datasetId?: string;
  value?: string; // Actual attribute value (e.g., "Active", "Offline")
}

interface ChartState {
  categories: StatusCategory[];
  total: number;
  centerMetric: number | string; // Percentage or total count for center display
  statusSlot?: Slot;
  measureSlot?: Slot;
  orderSlot?: Slot;
  selectedCategory?: string | null; // Track selected filter by attribute value
  centerMetricValue?: string; // The attribute value to show percentage for in center
  title?: string; // Title to display (optional - only shown if Title slot is filled)
  attributeName: string; // Name of the attribute column
}

interface ThemeContext {
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  mainColor: string;
  colors: string[];
}

interface ChartParams {
  container: HTMLElement;
  data: ItemData['data'];
  slots: Slot[];
  slotConfigurations: SlotConfig[];
  options: Record<string, any> & { theme?: ItemThemeConfig };
  language: string;
  dimensions: { width: number; height: number };
}

// Configuration options
interface ComponentConfig {
  title: string;
  colors: string[]; // Color palette assigned by position (1st value, 2nd value, 3rd value, etc.)
  centerMetricIndex: number | null; // Which value position (0-based) to show as % in center. null = show total count
}

// Default configuration
const DEFAULT_CONFIG: ComponentConfig = {
  title: 'KPI Status',
  // Colors assigned by position to attribute values (sorted alphabetically)
  //
  // IMPORTANT: Attribute values are sorted ALPHABETICALLY before color assignment
  // Examples:
  //   TRUE/FALSE -> FALSE=1st (index 0), TRUE=2nd (index 1)
  //   Active/Inactive -> Active=1st (index 0), Inactive=2nd (index 1)
  //   Online/Offline -> Offline=1st (index 0), Online=2nd (index 1)
  //
  // To show TRUE as green and FALSE as red, swap first two colors:
  //   colors: ['#BA1A1A', '#75BB43', ...]  <- FALSE=Red, TRUE=Green
  //
  colors: [
    '#75BB43', // 1st value (alphabetically, index 0) - Green
    '#BA1A1A', // 2nd value (index 1) - Red
    '#FEC325', // 3rd value (index 2) - Yellow (FIXED HEX)
    '#3b82f6', // 4th value (index 3) - Blue
    '#8b5cf6', // 5th value (index 4) - Purple
    '#ec4899', // 6th value (index 5) - Pink
    '#06b6d4', // 7th value (index 6) - Cyan
    '#84cc16', // 8th value (index 7) - Lime
  ],

  // Center Metric Configuration (used when Order column is NOT provided):
  // null = show total count
  // 0 = show percentage of 1st value (alphabetically)
  // 1 = show percentage of 2nd value (alphabetically)
  // NOTE: If Order column IS provided, the value with order=0 is always shown as %
  centerMetricIndex: 1  // Show 2nd value percentage (TRUE for TRUE/FALSE without Order column)
};

// Helper functions
function toRgb(color?: string, fallback = '#ffffff'): d3.RGBColor {
  const parsed = d3.color(color ?? fallback) ?? d3.color(fallback);
  return d3.rgb(parsed?.toString() ?? fallback);
}

function getRelativeLuminance(color: d3.RGBColor): number {
  const normalize = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * normalize(color.r) + 0.7152 * normalize(color.g) + 0.0722 * normalize(color.b);
}

function resolveTheme(theme?: ItemThemeConfig): ThemeContext {
  const backgroundColor = theme?.itemsBackground || '#ffffff';
  const backgroundRgb = toRgb(backgroundColor);
  const luminance = getRelativeLuminance(backgroundRgb);
  const textColor = luminance < 0.45 ? '#f8fafc' : '#1f2937';

  const fontFamily = theme?.font?.fontFamily ||
    'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

  return {
    backgroundColor,
    textColor,
    fontFamily,
    mainColor: (theme as any)?.mainColor || '#6366f1',
    colors: DEFAULT_CONFIG.colors
  };
}

/**
 * Extract column label from slot content
 */
function extractColumnLabel(column: any, language: string, fallback = 'Attribute'): string {
  if (typeof column.label === 'object' && column.label !== null) {
    return column.label.en || column.label[language] || Object.values(column.label)[0] || fallback;
  }
  if (column.label) {
    return String(column.label);
  }
  if (column.columnId) {
    return String(column.columnId);
  }
  return fallback;
}

/**
 * Format title: remove underscores and capitalize first letter of each word
 * Example: "TOTAL_DEVICES" -> "Total Devices"
 */
function formatTitle(title: string): string {
  return title
    .replace(/_/g, ' ')  // Replace underscores with spaces
    .split(' ')           // Split into words
    .map(word => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function sendFilterEvent(filters: ItemFilter[]): void {
  window.parent.postMessage({ type: 'setFilter', filters }, '*');
}

function sendCustomEvent(data: any): void {
  window.parent.postMessage({ type: 'customEvent', data }, '*');
}

/**
 * Assign colors to attribute values
 * If order column is provided: use order value as color index (0=Green, 1=Red, 2=Yellow)
 * Otherwise: use position in sorted array (alphabetically)
 */
function assignColors(
  uniqueValues: string[],
  config: ComponentConfig,
  statusOrders: Record<string, number>,
  hasOrderColumn: boolean
): Record<string, string> {
  const colorMap: Record<string, string> = {};

  uniqueValues.forEach((value, index) => {
    if (hasOrderColumn && statusOrders[value] !== undefined) {
      // Use the actual order value as color index
      const orderValue = statusOrders[value];
      colorMap[value] = config.colors[orderValue % config.colors.length];
    } else {
      // Use position-based indexing
      colorMap[value] = config.colors[index % config.colors.length];
    }
  });

  return colorMap;
}

/**
 * Process data from slots into StatusCategory array
 * Uses server-side aggregated measure values
 *
 * LOGIC:
 * 1. Input: Aggregated rows with [Status Attribute, Aggregated Measure Value, Order (optional)]
 * 2. Read pre-aggregated values directly from server
 * 3. Legend shows: Aggregated measure value per attribute
 * 4. Center shows: PERCENTAGE of selected attribute value OR total
 *
 * Example: Server returns 3 rows (already aggregated)
 *  - ["Active", 60000, 0] → Active count = 60,000 (60%)
 *  - ["Inactive", 40000, 1] → Inactive count = 40,000 (40%)
 *  - ["Pending", 50000, 2] → Pending count = 50,000 (33%)
 *  - If center metric is set to "Active", center displays: 40% (60k/150k)
 */
function processData(
  data: ItemData['data'],
  slots: Slot[],
  colors: string[],
  language: string,
  config: ComponentConfig = DEFAULT_CONFIG
): ChartState {
  const statusSlot = slots.find(s => s.name === 'category');
  const measureSlot = slots.find(s => s.name === 'measure');
  const orderSlot = slots.find(s => s.name === 'order');
  const titleSlot = slots.find(s => s.name === 'legend');

  // Extract attribute column name from the slot content
  const attributeName = statusSlot?.content?.[0]
    ? extractColumnLabel(statusSlot.content[0], language, 'Attribute')
    : 'Attribute';

  // Track aggregated measure values per status attribute value
  const statusMeasures: Record<string, number> = {};

  // Track order values for each status value
  const statusOrders: Record<string, number> = {};

  // Check if order column is provided
  const hasOrderColumn = orderSlot?.content && orderSlot.content.length > 0;

  // Check if title column is provided
  const hasTitleColumn = titleSlot?.content && titleSlot.content.length > 0;

  // Process data - data is already aggregated by server
  if (statusSlot?.content && statusSlot.content.length > 0 &&
      measureSlot?.content && measureSlot.content.length > 0 &&
      data && data.length > 0) {

    // Data structure when order column provided: [Status Object, Order Value, Measure Value]
    // Data structure without order: [Status Object, Measure Value]
    data.forEach((row) => {
      const statusValueObj = row[0];

      // If order column is provided, dimensions come BEFORE measures
      // So: [Dimension1_Status, Dimension2_Order, Measure]
      const orderValueObj = hasOrderColumn ? row[1] : undefined;
      const measureObj = hasOrderColumn ? row[2] : row[1];

      // Extract display name from status object (use localized name if available)
      let statusValue: string;
      if (statusValueObj && typeof statusValueObj === 'object' && 'name' in statusValueObj) {
        const nameObj = statusValueObj.name;
        if (typeof nameObj === 'object' && nameObj !== null) {
          // Use language-specific name, fallback to English, then first available
          statusValue = String(nameObj[language] ?? nameObj.en ?? Object.values(nameObj)[0] ?? statusValueObj.id ?? 'Unknown');
        } else {
          statusValue = String(nameObj ?? statusValueObj.id ?? 'Unknown');
        }
      } else {
        statusValue = String(statusValueObj?.id ?? statusValueObj ?? 'Unknown');
      }

      // Extract aggregated measure value
      let measureValue = 0;
      if (typeof measureObj === 'number') {
        measureValue = measureObj;
      } else if (typeof measureObj === 'object' && measureObj !== null && 'id' in measureObj) {
        measureValue = Number(measureObj.id);
      } else {
        measureValue = Number(measureObj);
      }

      statusMeasures[statusValue] = measureValue;

      // Extract order value if provided
      let orderValue: number | undefined = undefined;
      if (orderValueObj !== undefined && orderValueObj !== null) {
        if (typeof orderValueObj === 'number') {
          orderValue = orderValueObj;
        } else if (typeof orderValueObj === 'object' && 'id' in orderValueObj) {
          orderValue = Number(orderValueObj.id);
        } else {
          orderValue = Number(orderValueObj);
        }
      }

      // Store order value if provided
      if (orderValue !== undefined && !isNaN(orderValue)) {
        if (statusOrders[statusValue] === undefined || orderValue < statusOrders[statusValue]) {
          statusOrders[statusValue] = orderValue;
        }
      }
    });
  }

  // Extract title from title slot column name only if provided
  const customTitle = hasTitleColumn && titleSlot?.content?.[0]
    ? formatTitle(extractColumnLabel(titleSlot.content[0], language, ''))
    : undefined;

  // Fallback: sample data (demo)
  if (Object.keys(statusMeasures).length === 0) {
    statusMeasures['Active'] = 6;
    statusMeasures['Not Active'] = 4;
  }

  // Get unique status values and sort them
  const uniqueStatusValues = Object.keys(statusMeasures);

  // Sort by order column if provided, otherwise alphabetically
  if (hasOrderColumn && Object.keys(statusOrders).length > 0) {
    uniqueStatusValues.sort((a, b) => {
      const orderA = statusOrders[a] ?? 999;
      const orderB = statusOrders[b] ?? 999;
      return orderA - orderB;
    });
  } else {
    uniqueStatusValues.sort();
  }

  // Assign colors to status values using config
  const colorMap = assignColors(uniqueStatusValues, config, statusOrders, !!hasOrderColumn);

  // Calculate total from aggregated measures
  const total = uniqueStatusValues.reduce((sum, val) => sum + statusMeasures[val], 0);

  // Build categories array
  const categories: StatusCategory[] = uniqueStatusValues.map(statusValue => ({
    name: statusValue,
    count: statusMeasures[statusValue],
    color: colorMap[statusValue],
    columnId: statusSlot?.content?.[0]?.columnId,
    datasetId: statusSlot?.content?.[0]?.datasetId,
    value: statusValue
  }));

  // Calculate center metric
  let centerMetric: number | string = total;
  let centerMetricValue: string | undefined;

  // Determine which value to show in center
  let centerIndex: number | null = null;

  if (hasOrderColumn && Object.keys(statusOrders).length > 0) {
    // If order column provided, show the value with order=0 (or lowest order)
    centerIndex = 0; // First in sorted order
  } else if (config.centerMetricIndex !== null) {
    // Otherwise use config setting
    centerIndex = config.centerMetricIndex;
  }

  // Calculate percentage if centerIndex is set
  if (centerIndex !== null &&
      centerIndex >= 0 &&
      centerIndex < uniqueStatusValues.length) {

    centerMetricValue = uniqueStatusValues[centerIndex];
    const count = statusMeasures[centerMetricValue];
    const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
    centerMetric = `${percentage}%`;
  }

  return {
    categories,
    total,
    centerMetric,
    statusSlot,
    measureSlot,
    orderSlot,
    selectedCategory: null,
    centerMetricValue,
    title: customTitle,
    attributeName
  };
}

/**
 * Render the status widget
 */
export const render = ({
  container,
  data = [],
  slots = [],
  slotConfigurations = [],
  options = {},
  language = 'en',
  dimensions: { width, height } = { width: 0, height: 0 }
}: ChartParams): void => {
  const theme = resolveTheme(options.theme);
  const state = processData(data, slots, theme.colors, language);

  // Store state for resize
  (container as any).__chartState = state;
  (container as any).__theme = theme;

  renderWidget(container, state, theme, width, height);
};

/**
 * Resize handler
 */
export const resize = ({
  container,
  slots = [],
  slotConfigurations = [],
  options = {},
  language = 'en',
  dimensions: { width, height } = { width: 0, height: 0 }
}: ChartParams): void => {
  const state = (container as any).__chartState;
  const theme = options.theme ? resolveTheme(options.theme) : (container as any).__theme;

  if (state && theme) {
    (container as any).__theme = theme;
    renderWidget(container, state, theme, width, height);
  }
};

// Static background color for the widget
const STATIC_BACKGROUND_COLOR = '#F9F9FC';

/**
 * Main widget rendering function
 */
function renderWidget(
  container: HTMLElement,
  state: ChartState,
  theme: ThemeContext,
  width: number,
  height: number
): void {
  // Clear container
  container.innerHTML = '';
  container.style.backgroundColor = theme.backgroundColor;
  // Font family is set in CSS to Roboto

  // Handle empty state
  if (state.total === 0 || state.categories.length === 0) {
    renderEmptyState(container, theme);
    return;
  }

  // Create main container with static background
  const widget = document.createElement('div');
  widget.className = 'status-widget';

  // Set static background color
  widget.style.backgroundColor = STATIC_BACKGROUND_COLOR;

  container.appendChild(widget);

  // Always add title element to maintain consistent height (use invisible placeholder if empty)
  const title = document.createElement('div');
  title.className = 'widget-title';
  title.textContent = state.title || '\u00A0'; // Use non-breaking space to preserve height
  title.style.color = theme.textColor;
  if (!state.title) {
    title.style.opacity = '0'; // Make invisible but preserve space
  }
  widget.appendChild(title);

  // Create content wrapper for categories and chart
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'widget-content';

  // Determine layout based on aspect ratio: vertical if height > width, horizontal otherwise
  if (height > width) {
    contentWrapper.classList.add('layout-vertical');
  }

  widget.appendChild(contentWrapper);

  // Render categories list FIRST (left side)
  const listContainer = document.createElement('div');
  listContainer.className = 'categories-section';
  contentWrapper.appendChild(listContainer);

  renderCategoriesList(listContainer, state, theme);

  // Render chart SECOND (right side)
  const chartContainer = document.createElement('div');
  chartContainer.className = 'chart-section';
  contentWrapper.appendChild(chartContainer);

  // Render donut taking 45% of width
  renderDonutChart(chartContainer, state, theme, width * 0.45);

  // Add click handlers for filtering
  addInteractionHandlers(container, state, theme, width, height);
}

/**
 * Render empty state when no data is available
 */
function renderEmptyState(container: HTMLElement, theme: ThemeContext): void {
  const emptyState = document.createElement('div');
  emptyState.className = 'empty-state';
  emptyState.style.color = theme.textColor;

  const icon = document.createElement('div');
  icon.className = 'empty-state-icon';
  icon.innerHTML = '📊';
  emptyState.appendChild(icon);

  const title = document.createElement('div');
  title.className = 'empty-state-title';
  title.textContent = 'No Data Available';
  emptyState.appendChild(title);

  const message = document.createElement('div');
  message.className = 'empty-state-message';
  message.textContent = 'Add a Status Attribute and Record ID to get started.';
  emptyState.appendChild(message);

  container.appendChild(emptyState);
}

/**
 * Render the donut chart with center metric
 * Dynamic sizing: takes 45% of component width (scales with container)
 * Dynamic stroke: 20px base, scales proportionally with size
 */
function renderDonutChart(
  container: HTMLElement,
  state: ChartState,
  theme: ThemeContext,
  containerWidth: number
): void {
  // Scale donut size based on container width (45% of component)
  // Minimum 80px, maximum 260px for optimal display
  const size = Math.min(Math.max(containerWidth * 0.8, 80), 260);

  // Dynamic stroke width: 20px base at 120px size, scales proportionally
  // Minimum 10px to prevent being too thin at small sizes
  const strokeWidth = Math.max(Math.floor(size * 0.1667), 10);

  const radius = size / 2;
  const innerRadius = radius - strokeWidth;

  const svg = d3.select(container)
    .append('svg')
    .attr('width', size)
    .attr('height', size)
    .attr('class', 'donut-chart')
    .style('overflow', 'visible');

  const g = svg.append('g')
    .attr('transform', `translate(${radius},${radius})`)
    .style('overflow', 'visible');

  // Create tooltip
  const tooltip = d3.select(container)
    .append('div')
    .attr('class', 'donut-tooltip')
    .style('opacity', 0);

  // Create pie layout
  const pie = d3.pie<StatusCategory>()
    .value(d => d.count)
    .sort(null);

  const arc = d3.arc<d3.PieArcDatum<StatusCategory>>()
    .innerRadius(innerRadius)
    .outerRadius(radius);

  const arcHover = d3.arc<d3.PieArcDatum<StatusCategory>>()
    .innerRadius(innerRadius)
    .outerRadius(radius + 8);

  // Render segments
  const segments = g.selectAll('.segment')
    .data(pie(state.categories))
    .enter()
    .append('g')
    .attr('class', 'segment');

  segments.append('path')
    .attr('d', arc)
    .attr('fill', d => d.data.color)
    .attr('stroke', theme.backgroundColor)
    .attr('stroke-width', 2)
    .attr('data-category', d => d.data.name)
    .style('cursor', 'pointer')
    .style('transition', 'all 0.3s ease')
    .style('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))')
    .on('mouseover', function(event, d) {
      const percentage = state.total > 0 ? Math.round((d.data.count / state.total) * 100) : 0;

      d3.select(this)
        .transition()
        .duration(200)
        .attr('d', arcHover as any)
        .style('filter', 'drop-shadow(0 6px 12px rgba(0,0,0,0.15))');

      // Show tooltip first to get its dimensions
      tooltip
        .style('opacity', 1)
        .html(`
          <div class="tooltip-category">${d.data.name}</div>
          <div class="tooltip-stats">
            <div><strong>${d.data.count}</strong> records</div>
            <div><strong>${percentage}%</strong> of total</div>
          </div>
        `);

      // Get tooltip dimensions and container bounds
      const tooltipNode = tooltip.node() as HTMLElement;
      const tooltipRect = tooltipNode.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Calculate position, ensuring tooltip stays within bounds
      let left = event.offsetX + 10;
      let top = event.offsetY - 10;

      // Check right edge
      if (left + tooltipRect.width > containerRect.width) {
        left = event.offsetX - tooltipRect.width - 10;
      }

      // Check bottom edge
      if (top + tooltipRect.height > containerRect.height) {
        top = event.offsetY - tooltipRect.height - 10;
      }

      // Check left edge
      if (left < 0) {
        left = 10;
      }

      // Check top edge
      if (top < 0) {
        top = 10;
      }

      tooltip
        .style('left', `${left}px`)
        .style('top', `${top}px`);
    })
    .on('mouseout', function() {
      d3.select(this)
        .transition()
        .duration(200)
        .attr('d', arc as any)
        .style('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))');

      tooltip.style('opacity', 0);
    });

  // Center text - center metric (percentage or total)
  const centerText = String(state.centerMetric);
  const fontSize = centerText.includes('%') ? radius * 0.48 : radius * 0.42;

  g.append('text')
    .attr('class', 'center-score')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('x', 0)
    .attr('y', 0)
    .style('font-family', 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif')
    .style('font-size', `${fontSize}px`)
    .style('font-weight', '500')
    .style('fill', theme.textColor)
    .text(centerText);
}

/**
 * Render the categories list with counts
 */
function renderCategoriesList(
  container: HTMLElement,
  state: ChartState,
  theme: ThemeContext
): void {
  const list = document.createElement('div');
  list.className = 'categories-list';
  container.appendChild(list);

  state.categories.forEach(category => {
    const item = document.createElement('div');
    item.className = 'category-item';

    // Add selected class if this category is currently selected
    if (state.selectedCategory === category.value) {
      item.classList.add('category-selected');
    }

    item.setAttribute('data-category', category.name);

    // Color indicator
    const indicator = document.createElement('div');
    indicator.className = 'category-indicator';
    indicator.style.backgroundColor = category.color;
    item.appendChild(indicator);

    // Label and count container
    const content = document.createElement('div');
    content.className = 'category-content';

    const label = document.createElement('div');
    label.className = 'category-label';
    label.style.color = theme.textColor;
    label.textContent = category.name;
    content.appendChild(label);

    const count = document.createElement('div');
    count.className = 'category-count';
    count.style.color = theme.textColor;
    count.textContent = category.count.toLocaleString();
    content.appendChild(count);

    item.appendChild(content);
    list.appendChild(item);
  });
}

/**
 * Add interaction handlers for filtering
 */
function addInteractionHandlers(
  container: HTMLElement,
  state: ChartState,
  theme: ThemeContext,
  width: number,
  height: number
): void {
  // Category item clicks
  const categoryItems = container.querySelectorAll('.category-item');
  categoryItems.forEach((item, index) => {
    item.addEventListener('click', () => {
      const category = state.categories[index];
      handleCategoryClick(category, state, container, theme, width, height);
    });
  });

  // Donut segment clicks
  const segments = container.querySelectorAll('.segment path');
  segments.forEach((segment, index) => {
    segment.addEventListener('click', () => {
      const category = state.categories[index];
      handleCategoryClick(category, state, container, theme, width, height);
    });
  });
}

/**
 * Handle category click for filtering
 * Component display stays static - filtering only affects other dashboard components
 */
function handleCategoryClick(
  category: StatusCategory,
  state: ChartState,
  container: HTMLElement,
  theme: ThemeContext,
  width: number,
  height: number
): void {
  // Toggle selection: if clicking same category, deselect it
  const clickedValue = category.value!;
  const wasSelected = state.selectedCategory === clickedValue;

  // Update selection state
  state.selectedCategory = wasSelected ? null : clickedValue;

  // Re-render the widget to update selection highlighting
  renderWidget(container, state, theme, width, height);

  // Send custom event
  sendCustomEvent({
    eventType: 'statusCategorySelected',
    category: category.name,
    count: category.count,
    totalRecords: state.total,
    isFiltered: state.selectedCategory !== null
  });

  // Send filter event to dashboard (only if category is selected, not deselected)
  if (state.selectedCategory && state.statusSlot?.content && state.statusSlot.content.length > 0) {
    const column = state.statusSlot.content[0];
    const filters: ItemFilter[] = [{
      expression: '? = ?',
      parameters: [
        {
          column_id: column.columnId,
          dataset_id: column.datasetId
        },
        clickedValue
      ],
      properties: {
        origin: 'filterFromVizItem',
        type: 'where'
      }
    }];

    sendFilterEvent(filters);
  } else if (!state.selectedCategory) {
    // Clear filter when deselected
    sendFilterEvent([]);
  }
}

/**
 * Build query for data retrieval
 * Uses server-side aggregation for measures
 *
 * Query structure:
 * - Dimension 1: Status Attribute (e.g., Status, State) - GROUP BY
 * - Measure 1: Aggregated metric (e.g., COUNT, SUM, AVG) - server aggregates
 * - Dimension 2 (optional): Order column - for sorting and color assignment
 */
export const buildQuery = ({
  slots = [],
  slotConfigurations = []
}: {
  slots: Slot[];
  slotConfigurations: SlotConfig[];
}): ItemQuery => {
  const statusSlot = slots.find(s => s.name === 'category');
  const measureSlot = slots.find(s => s.name === 'measure');
  const orderSlot = slots.find(s => s.name === 'order');

  if (!statusSlot?.content || statusSlot.content.length === 0 ||
      !measureSlot?.content || measureSlot.content.length === 0) {
    return {
      dimensions: [],
      measures: [],
      order: []
    };
  }

  const dimensions: any[] = [];
  const measures: any[] = [];

  // Add status attribute column as dimension (GROUP BY)
  const statusColumn = statusSlot.content[0];
  dimensions.push({
    dataset_id: statusColumn.datasetId || (statusColumn as any).set,
    column_id: statusColumn.columnId || (statusColumn as any).column,
    level: statusColumn.level || 1
  });

  // Add measure column as measure with aggregation
  const measureColumn = measureSlot.content[0];
  const measureDef: any = {
    dataset_id: measureColumn.datasetId || (measureColumn as any).set,
    column_id: measureColumn.columnId || (measureColumn as any).column
  };

  // Add aggregation if specified
  if (measureColumn.aggregationFunc && ['sum', 'average', 'min', 'max', 'count'].includes(measureColumn.aggregationFunc)) {
    measureDef.aggregation = { type: measureColumn.aggregationFunc };
  }

  measures.push(measureDef);

  // Add order column as dimension if provided (for grouping)
  if (orderSlot?.content && orderSlot.content.length > 0) {
    const orderColumn = orderSlot.content[0];
    dimensions.push({
      dataset_id: orderColumn.datasetId || (orderColumn as any).set,
      column_id: orderColumn.columnId || (orderColumn as any).column,
      level: 1
    });
  }

  // Note: Title slot is NOT added to query - we only use the column name from slot metadata

  return {
    dimensions,
    measures,
    order: []
  };
};
