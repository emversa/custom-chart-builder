import { formatter } from '@luzmo/analytics-components-kit/utils';
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
  value?: any; // Original value for filtering
}

interface ChartState {
  categories: StatusCategory[];
  total: number;
  aggregatedScore: number; // The aggregated score to display in center
  categorySlot?: Slot;
  sizeSlot?: Slot; // For COUNT of records per category
  measureSlot?: Slot; // For AVERAGE health score
  orderSlot?: Slot;
  legendSlot?: Slot;
  selectedCategory?: string | null; // Track selected filter
  title?: string;
  allCategoryData: Record<string, { count: number; avgScore: number }>; // Store all data for recalculation
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

  const paletteFromTheme = (theme?.colors ?? []).filter(Boolean) as string[];
  const mainColor = theme?.mainColor || paletteFromTheme[0] || '#6366f1';

  // Default status colors: green, yellow, red
  const defaultColors = ['#10b981', '#f59e0b', '#ef4444'];
  const colors = paletteFromTheme.length >= 3
    ? paletteFromTheme.slice(0, 3)
    : [...paletteFromTheme, ...defaultColors].slice(0, 3);

  const fontFamily = theme?.font?.fontFamily ||
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

  return {
    backgroundColor,
    textColor,
    fontFamily,
    mainColor,
    colors
  };
}

function sendFilterEvent(filters: ItemFilter[]): void {
  window.parent.postMessage({ type: 'setFilter', filters }, '*');
}

function sendCustomEvent(data: any): void {
  window.parent.postMessage({ type: 'customEvent', data }, '*');
}

/**
 * Extract column label from slot content
 */
function extractColumnLabel(column: any, language: string, fallback = 'Category'): string {
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
 */
function formatTitle(title: string): string {
  return title
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Process data from slots into StatusCategory array
 * Uses server-side aggregated health category data
 *
 * LOGIC:
 * 1. Input: Aggregated rows with [Category, Order?, Count, Avg Score]
 * 2. Read pre-aggregated values directly from server
 * 3. Legend shows: COUNT of records per category (from count measure)
 * 4. Center shows: AVERAGE score (weighted average from avgScore measure)
 * 5. Display order: uses order column if provided, otherwise hardcoded: Healthy, Warning, Error
 * 6. Clicking category filters data and recalculates center score
 *
 * Data structure:
 *  - With order: [Category, Order, Count, AvgScore]
 *  - Without order: [Category, Count, AvgScore]
 *
 * Example: Server returns 3 rows (already aggregated)
 *  - ["Healthy", 0, 500, 87.5] → Healthy count = 500, avg = 87.5
 *  - ["Warning", 1, 300, 65.2] → Warning count = 300, avg = 65.2
 *  - ["Error", 2, 200, 35.8] → Error count = 200, avg = 35.8
 *  - Center displays: Weighted average = (500*87.5 + 300*65.2 + 200*35.8) / 1000 = 72
 */
function processData(
  data: ItemData['data'],
  slots: Slot[],
  colors: string[],
  language: string,
  selectedCategory?: string | null
): ChartState {
  const categorySlot = slots.find(s => s.name === 'category');
  const sizeSlot = slots.find(s => s.name === 'size');
  const measureSlot = slots.find(s => s.name === 'measure');
  const orderSlot = slots.find(s => s.name === 'order');
  const legendSlot = slots.find(s => s.name === 'legend');

  // Predefined colors for health categories
  const healthyColor = '#75BB43';  // Green
  const warningColor = '#FEC325';  // Yellow
  const errorColor = '#BA1A1A';    // Red

  // Default color mapping
  const colorMapping: Record<string, string> = {
    'Healthy': healthyColor,
    'Warning': warningColor,
    'Error': errorColor
  };

  // Track aggregated data per category
  const categoryData: Record<string, { count: number; avgScore: number }> = {};
  const categoryOrders: Record<string, number> = {};

  const hasOrderColumn = orderSlot?.content && orderSlot.content.length > 0;
  const hasTitleColumn = legendSlot?.content && legendSlot.content.length > 0;

  // Process data - data is already aggregated by server
  if (categorySlot?.content && categorySlot.content.length > 0 &&
      sizeSlot?.content && sizeSlot.content.length > 0 &&
      measureSlot?.content && measureSlot.content.length > 0 &&
      data && data.length > 0) {

    // Data structure:
    //   With order: [Category, Order, Count, AvgScore]
    //   Without order: [Category, Count, AvgScore]
    data.forEach((row) => {
      const categoryObj = row[0];
      const orderValueObj = hasOrderColumn ? row[1] : undefined;
      const sizeObj = hasOrderColumn ? row[2] : row[1];
      const avgScoreObj = hasOrderColumn ? row[3] : row[2];

      // Extract display name from category object
      let categoryValue: string;
      if (categoryObj && typeof categoryObj === 'object' && 'name' in categoryObj) {
        const nameObj = categoryObj.name;
        if (typeof nameObj === 'object' && nameObj !== null) {
          categoryValue = String(nameObj[language] ?? nameObj.en ?? Object.values(nameObj)[0] ?? categoryObj.id ?? 'Unknown');
        } else {
          categoryValue = String(nameObj ?? categoryObj.id ?? 'Unknown');
        }
      } else {
        categoryValue = String(categoryObj?.id ?? categoryObj ?? 'Unknown');
      }

      // Extract count value
      let countValue = 0;
      if (typeof sizeObj === 'number') {
        countValue = sizeObj;
      } else if (typeof sizeObj === 'object' && sizeObj !== null && 'id' in sizeObj) {
        countValue = Number(sizeObj.id);
      } else {
        countValue = Number(sizeObj);
      }

      // Extract average score value
      let avgScoreValue = 0;
      if (typeof avgScoreObj === 'number') {
        avgScoreValue = avgScoreObj;
      } else if (typeof avgScoreObj === 'object' && avgScoreObj !== null && 'id' in avgScoreObj) {
        avgScoreValue = Number(avgScoreObj.id);
      } else {
        avgScoreValue = Number(avgScoreObj);
      }

      // Store both count and average score
      categoryData[categoryValue] = { count: countValue, avgScore: avgScoreValue };

      // Extract and store order value if provided
      if (hasOrderColumn && orderValueObj !== undefined && orderValueObj !== null) {
        let orderValue: number | undefined = undefined;
        if (typeof orderValueObj === 'number') {
          orderValue = orderValueObj;
        } else if (typeof orderValueObj === 'object' && 'id' in orderValueObj) {
          orderValue = Number(orderValueObj.id);
        } else {
          orderValue = Number(orderValueObj);
        }

        if (orderValue !== undefined && !isNaN(orderValue)) {
          categoryOrders[categoryValue] = orderValue;
        }
      }
    });
  }

  // Extract title from title slot column name only if provided
  const customTitle = hasTitleColumn && legendSlot?.content?.[0]
    ? formatTitle(extractColumnLabel(legendSlot.content[0], language, ''))
    : undefined;

  // Fallback: sample data
  if (Object.keys(categoryData).length === 0) {
    categoryData['Healthy'] = { count: 6, avgScore: 87 };
    categoryData['Warning'] = { count: 4, avgScore: 65 };
    categoryData['Error'] = { count: 2, avgScore: 35 };
  }

  // Store all category data for recalculation on filter
  const allCategoryData = { ...categoryData };

  // Determine sort order
  let uniqueCategories: string[];
  if (hasOrderColumn && Object.keys(categoryOrders).length > 0) {
    // Sort by order column
    uniqueCategories = Object.keys(categoryData).sort((a, b) => {
      const orderA = categoryOrders[a] ?? 999;
      const orderB = categoryOrders[b] ?? 999;
      return orderA - orderB;
    });
  } else {
    // Use hardcoded order: Healthy, Warning, Error
    const orderedCategoryNames = ['Healthy', 'Warning', 'Error'];
    uniqueCategories = orderedCategoryNames.filter(cat => categoryData[cat] !== undefined);
    // Add any categories not in the hardcoded list
    Object.keys(categoryData).forEach(cat => {
      if (!uniqueCategories.includes(cat)) {
        uniqueCategories.push(cat);
      }
    });
  }

  // Filter data if category is selected
  let filteredCategories = uniqueCategories;
  if (selectedCategory) {
    filteredCategories = uniqueCategories.filter(cat => cat === selectedCategory);
  }

  // Calculate total count and weighted average score (based on filtered data)
  const total = filteredCategories.reduce((sum, cat) => sum + categoryData[cat].count, 0);
  const weightedSum = filteredCategories.reduce((sum, cat) =>
    sum + (categoryData[cat].count * categoryData[cat].avgScore), 0);
  const aggregatedScore = total > 0 ? Math.round(weightedSum / total) : 0;

  // Build categories array
  const categories: StatusCategory[] = uniqueCategories.map(categoryValue => {
    // Determine color based on order or name mapping
    let color = colorMapping[categoryValue] || healthyColor;
    if (hasOrderColumn && categoryOrders[categoryValue] !== undefined) {
      const orderValue = categoryOrders[categoryValue];
      const colorArray = [healthyColor, warningColor, errorColor];
      color = colorArray[orderValue % colorArray.length];
    }

    return {
      name: categoryValue,
      count: categoryData[categoryValue].count,
      color: color,
      columnId: categorySlot?.content?.[0]?.columnId,
      datasetId: categorySlot?.content?.[0]?.datasetId,
      value: categoryValue
    };
  });

  return {
    categories,
    total,
    aggregatedScore,
    categorySlot,
    sizeSlot,
    measureSlot,
    orderSlot,
    legendSlot,
    selectedCategory: selectedCategory || null,
    title: customTitle,
    allCategoryData
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

  // Store data for recalculation on filter
  (container as any).__chartState = state;
  (container as any).__theme = theme;
  (container as any).__data = data;
  (container as any).__slots = slots;
  (container as any).__language = language;
  (container as any).__width = width;
  (container as any).__height = height;

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

/**
 * Get background color based on aggregated score
 */
function getBackgroundColor(score: number): string {
  if (score >= 81) return '#F3FBED'; // Healthy
  if (score >= 51) return '#FFF9F0'; // Warning
  return '#FFF6F7'; // Error
}

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

  // Create main container with conditional background
  const widget = document.createElement('div');
  widget.className = 'status-widget';

  // Set conditional background color based on score
  const backgroundColor = getBackgroundColor(state.aggregatedScore);
  widget.style.backgroundColor = backgroundColor;

  container.appendChild(widget);

  // Add title (use custom title if provided, otherwise default)
  const title = document.createElement('div');
  title.className = 'widget-title';
  title.textContent = state.title || 'Health Score Status';
  title.style.color = theme.textColor;
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

  // Render chart SECOND (right side or top on mobile)
  const chartContainer = document.createElement('div');
  chartContainer.className = 'chart-section';
  contentWrapper.appendChild(chartContainer);

  // Donut takes about 45% of width for good balance
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
  message.textContent = 'Add up to 3 numeric columns to the "Status Metrics" slot to get started.';
  emptyState.appendChild(message);

  container.appendChild(emptyState);
}

/**
 * Render the donut chart with center metric
 * Dynamic sizing: takes 45% of component width (scales with container)
 * Dynamic stroke: matches kpi-with-donut stroke calculation
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
        .attr('d', arcHover)
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
        .attr('d', arc)
        .style('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))');

      tooltip.style('opacity', 0);
    });

  // Center text - aggregated score with configurable decimal places
  const centerText = state.aggregatedScore.toFixed(0); // No decimals by default, can be made configurable
  const fontSize = radius * 0.48; // Slightly smaller for numbers without %

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
 * Handle category click for filtering and recalculation
 * Filters data to selected category and recalculates center score
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
  const newSelection = wasSelected ? null : clickedValue;

  // Retrieve stored data from container
  const data = (container as any).__data;
  const slots = (container as any).__slots;
  const language = (container as any).__language;

  // Reprocess data with the new selection to recalculate score
  const newState = processData(data, slots, theme.colors, language, newSelection);

  // Update container's stored state
  (container as any).__chartState = newState;

  // Re-render the widget with recalculated data
  renderWidget(container, newState, theme, width, height);

  // Send custom event
  sendCustomEvent({
    eventType: 'categorySelected',
    category: category.name,
    count: category.count,
    totalRecords: newState.total,
    aggregatedScore: newState.aggregatedScore,
    isFiltered: newState.selectedCategory !== null
  });

  // Send filter event to dashboard
  if (newState.selectedCategory && newState.categorySlot?.content && newState.categorySlot.content.length > 0) {
    const column = newState.categorySlot.content[0];
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
  } else {
    // Clear filter when deselected
    sendFilterEvent([]);
  }
}

/**
 * Build query for data retrieval
 * Uses server-side aggregation for measures
 *
 * Query structure:
 * - Dimension 1: Status Category (e.g., Healthy, Warning, Error) - GROUP BY
 * - Dimension 2 (optional): Order column - for sorting and color assignment
 * - Measure 1: Record count (COUNT aggregation) - for legend counts
 * - Measure 2: Average score (AVERAGE aggregation) - for center KPI
 *
 * Data structure returned:
 *  - With order: [Category, Order, Count, AvgScore]
 *  - Without order: [Category, Count, AvgScore]
 *
 * Display order: uses order column if provided, otherwise: Healthy, Warning, Error
 *
 * User must create a formula column in Luzmo:
 * IF([Score] >= 81, 'Healthy', IF([Score] >= 51, 'Warning', 'Error'))
 */
export const buildQuery = ({
  slots = [],
  slotConfigurations = []
}: {
  slots: Slot[];
  slotConfigurations: SlotConfig[];
}): ItemQuery => {
  const categorySlot = slots.find(s => s.name === 'category');
  const sizeSlot = slots.find(s => s.name === 'size');
  const measureSlot = slots.find(s => s.name === 'measure');
  const orderSlot = slots.find(s => s.name === 'order');

  if (!categorySlot?.content || categorySlot.content.length === 0 ||
      !sizeSlot?.content || sizeSlot.content.length === 0 ||
      !measureSlot?.content || measureSlot.content.length === 0) {
    return {
      dimensions: [],
      measures: [],
      order: []
    };
  }

  const dimensions: any[] = [];
  const measures: any[] = [];

  // Add category column as dimension (GROUP BY)
  const categoryColumn = categorySlot.content[0];
  dimensions.push({
    dataset_id: categoryColumn.datasetId || (categoryColumn as any).set,
    column_id: categoryColumn.columnId || (categoryColumn as any).column,
    level: categoryColumn.level || 1
  });

  // Add order column as dimension if provided (for sorting and color assignment)
  if (orderSlot?.content && orderSlot.content.length > 0) {
    const orderColumn = orderSlot.content[0];
    dimensions.push({
      dataset_id: orderColumn.datasetId || (orderColumn as any).set,
      column_id: orderColumn.columnId || (orderColumn as any).column,
      level: 1
    });
  }

  // Add size measure (Measure 1) - for legend counts
  const sizeColumn = sizeSlot.content[0];
  const sizeMeasureDef: any = {
    dataset_id: sizeColumn.datasetId || (sizeColumn as any).set,
    column_id: sizeColumn.columnId || (sizeColumn as any).column
  };

  // Add aggregation if specified
  if (sizeColumn.aggregationFunc && ['sum', 'average', 'min', 'max', 'count'].includes(sizeColumn.aggregationFunc)) {
    sizeMeasureDef.aggregation = { type: sizeColumn.aggregationFunc };
  }

  measures.push(sizeMeasureDef);

  // Add measure column (Measure 2) - for center KPI average score
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

  // Note: Title slot is NOT added to query - we only use the column name from slot metadata

  return {
    dimensions,
    measures,
    order: []
  };
};
