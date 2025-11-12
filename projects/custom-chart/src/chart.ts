// ============================================================================
// IMPORTS AND TYPE DEFINITIONS
// ============================================================================

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

// ============================================================================
// DATA STRUCTURES
// ============================================================================
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
  total: number; // Total count (filtered if category selected)
  overallTotal: number; // Overall total across all categories (for percentage calculations)
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

// ============================================================================
// THEME AND COLOR HELPERS
// ============================================================================

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

// ============================================================================
// EVENT COMMUNICATION
// ============================================================================

function sendFilterEvent(filters: ItemFilter[]): void {
  window.parent.postMessage({ type: 'setFilter', filters }, '*');
}

function sendCustomEvent(data: any): void {
  window.parent.postMessage({ type: 'customEvent', data }, '*');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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
 * Extract value from data object (handles both direct values and nested objects)
 */
function extractValue(obj: any, type: 'string' | 'number'): any {
  if (obj === null || obj === undefined) {
    return type === 'number' ? 0 : 'Unknown';
  }

  if (typeof obj === type) {
    return obj;
  }

  if (typeof obj === 'object' && 'id' in obj) {
    return type === 'number' ? Number(obj.id) : String(obj.id);
  }

  return type === 'number' ? Number(obj) : String(obj);
}

/**
 * Extract category display name from category object
 */
function extractCategoryName(categoryObj: any, language: string): string {
  if (!categoryObj) return 'Unknown';

  if (typeof categoryObj === 'object' && 'name' in categoryObj) {
    const nameObj = categoryObj.name;
    if (typeof nameObj === 'object' && nameObj !== null) {
      return String(nameObj[language] ?? nameObj.en ?? Object.values(nameObj)[0] ?? categoryObj.id ?? 'Unknown');
    }
    return String(nameObj ?? categoryObj.id ?? 'Unknown');
  }

  return String(categoryObj?.id ?? categoryObj ?? 'Unknown');
}

// ============================================================================
// DATA PROCESSING
// ============================================================================

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

      // Extract values using helper functions
      const categoryValue = extractCategoryName(categoryObj, language);
      const countValue = extractValue(sizeObj, 'number');
      const avgScoreValue = extractValue(avgScoreObj, 'number');

      // Store both count and average score
      categoryData[categoryValue] = { count: countValue, avgScore: avgScoreValue };

      // Extract and store order value if provided
      if (hasOrderColumn && orderValueObj !== undefined && orderValueObj !== null) {
        const orderValue = extractValue(orderValueObj, 'number');
        if (!isNaN(orderValue)) {
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

  // Calculate overall total across all categories (for percentage display)
  const overallTotal = uniqueCategories.reduce((sum, cat) => sum + categoryData[cat].count, 0);

  // Filter data if category is selected
  let filteredCategories = uniqueCategories;
  if (selectedCategory) {
    filteredCategories = uniqueCategories.filter(cat => cat === selectedCategory);
  }

  // Calculate total and aggregated score (based on filtered data)
  const total = filteredCategories.reduce((sum, cat) => sum + categoryData[cat].count, 0);
  const aggregatedScore = calculateAggregatedScore(filteredCategories, categoryData);

  // Build categories array
  const categories: StatusCategory[] = uniqueCategories.map(categoryValue => ({
    name: categoryValue,
    count: categoryData[categoryValue].count,
    color: getCategoryColor(categoryValue, categoryOrders, hasOrderColumn),
    columnId: categorySlot?.content?.[0]?.columnId,
    datasetId: categorySlot?.content?.[0]?.datasetId,
    value: categoryValue
  }));

  return {
    categories,
    total,
    overallTotal,
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
 * Get color for category based on order or name mapping
 */
function getCategoryColor(
  categoryValue: string,
  categoryOrders: Record<string, number>,
  hasOrderColumn: boolean
): string {
  const healthyColor = '#75BB43';
  const warningColor = '#FEC325';
  const errorColor = '#BA1A1A';

  const colorMapping: Record<string, string> = {
    'Healthy': healthyColor,
    'Warning': warningColor,
    'Error': errorColor
  };

  // Use order-based color if order column exists
  if (hasOrderColumn && categoryOrders[categoryValue] !== undefined) {
    const orderValue = categoryOrders[categoryValue];
    const colorArray = [healthyColor, warningColor, errorColor];
    return colorArray[orderValue % colorArray.length];
  }

  // Fallback to name-based color mapping
  return colorMapping[categoryValue] || healthyColor;
}

/**
 * Calculate aggregated score from categories
 */
function calculateAggregatedScore(
  categories: string[],
  categoryData: Record<string, { count: number; avgScore: number }>
): number {
  const total = categories.reduce((sum, cat) => sum + categoryData[cat].count, 0);
  const weightedSum = categories.reduce((sum, cat) =>
    sum + (categoryData[cat].count * categoryData[cat].avgScore), 0);
  return total > 0 ? Math.round(weightedSum / total) : 0;
}

// ============================================================================
// MAIN RENDER FUNCTIONS
// ============================================================================

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

  // Frame 1010107938 - wrapper with gap: 12px
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'content-wrapper';
  widget.appendChild(contentWrapper);

  // Frame 3467150 - center container
  const centerContainer = document.createElement('div');
  centerContainer.className = 'center-container';
  contentWrapper.appendChild(centerContainer);

  // Frame 1010107450 - content with 51px gap between categories and chart
  const widgetContent = document.createElement('div');
  widgetContent.className = 'widget-content';

  // Determine layout based on aspect ratio: vertical if height > width, horizontal otherwise
  if (height > width) {
    widgetContent.classList.add('layout-vertical');
  }

  centerContainer.appendChild(widgetContent);

  // Render categories list in widget content
  renderCategoriesList(widgetContent, state, theme);

  // Render chart in widget content
  renderDonutChart(widgetContent, state, theme, width * 0.45);

  // Add click handlers for filtering
  addInteractionHandlers(container, state, theme, width, height);
}

// ============================================================================
// RENDERING COMPONENTS
// ============================================================================

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
 * Handle tooltip positioning to keep it within container bounds
 */
function positionTooltip(
  tooltip: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>,
  event: MouseEvent,
  container: HTMLElement
): void {
  const tooltipNode = tooltip.node() as HTMLElement;
  const tooltipRect = tooltipNode.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  let left = event.offsetX + 10;
  let top = event.offsetY - 10;

  // Keep tooltip within horizontal bounds
  if (left + tooltipRect.width > containerRect.width) {
    left = event.offsetX - tooltipRect.width - 10;
  }
  if (left < 0) {
    left = 10;
  }

  // Keep tooltip within vertical bounds
  if (top + tooltipRect.height > containerRect.height) {
    top = event.offsetY - tooltipRect.height - 10;
  }
  if (top < 0) {
    top = 10;
  }

  tooltip.style('left', `${left}px`).style('top', `${top}px`);
}

/**
 * Render the donut chart with center metric - Figma specs
 */
function renderDonutChart(
  container: HTMLElement,
  state: ChartState,
  theme: ThemeContext,
  containerWidth: number
): void {
  // Fixed size from Figma: 120px x 120px with 14px stroke
  // CSS scales it to 80px in vertical layout
  const size = 120;
  const strokeWidth = 14;

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

  // Prepare data for pie chart
  // If filtered, show selected category + empty segment to show proportion
  let pieData: StatusCategory[];
  if (state.selectedCategory) {
    const selectedCat = state.categories.find(cat => cat.value === state.selectedCategory);
    if (selectedCat) {
      // Calculate the "empty" portion
      const emptyCount = state.overallTotal - selectedCat.count;
      pieData = [
        selectedCat,
        {
          name: '__empty__',
          count: emptyCount,
          color: 'transparent',
          value: '__empty__'
        } as StatusCategory
      ];
    } else {
      pieData = state.categories;
    }
  } else {
    pieData = state.categories;
  }

  // Create pie layout
  const pie = d3.pie<StatusCategory>()
    .value(d => d.count)
    .sort(null);

  const arc = d3.arc<d3.PieArcDatum<StatusCategory>>()
    .innerRadius(innerRadius)
    .outerRadius(radius);

  // Render segments
  const segments = g.selectAll('.segment')
    .data(pie(pieData))
    .enter()
    .append('g')
    .attr('class', 'segment');

  segments.append('path')
    .attr('d', arc)
    .attr('fill', d => d.data.color)
    .attr('stroke', d => d.data.name === '__empty__' ? 'none' : '#FFF')
    .attr('stroke-width', d => d.data.name === '__empty__' ? 0 : 1)
    .attr('data-category', d => d.data.name)
    .style('cursor', d => d.data.name === '__empty__' ? 'default' : 'pointer')
    .on('mouseover', function(event, d) {
      if (d.data.name === '__empty__') return;

      const percentage = state.overallTotal > 0 ? Math.round((d.data.count / state.overallTotal) * 100) : 0;

      tooltip
        .style('opacity', 1)
        .html(`
          <div class="tooltip-category">${d.data.name}</div>
          <div class="tooltip-stats">
            <div><strong>${d.data.count}</strong> records</div>
            <div><strong>${percentage}%</strong> of total</div>
          </div>
        `);

      positionTooltip(tooltip, event, container);
    })
    .on('mouseout', function(event, d) {
      if (d.data.name === '__empty__') return;
      tooltip.style('opacity', 0);
    });

  // Center text - animated aggregated score - Figma: display-3
  const fontSize = 40; // Fixed from Figma
  const lineHeight = 46; // Fixed from Figma
  const targetValue = state.aggregatedScore;

  // Get previous value for smooth transition (default to 0 on first render)
  const previousValue = (container as any).__previousScore || 0;
  (container as any).__previousScore = targetValue;

  const centerTextElement = g.append('text')
    .attr('class', 'center-score')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('x', 0)
    .attr('y', 0)
    .text(previousValue.toFixed(0));

  // Animate the number counting up
  centerTextElement
    .transition()
    .duration(800)
    .ease(d3.easeCubicOut)
    .tween('text', function() {
      const interpolate = d3.interpolateNumber(previousValue, targetValue);
      return function(t: number) {
        const currentValue = interpolate(t);
        d3.select(this).text(Math.round(currentValue).toFixed(0));
      };
    });
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
    label.textContent = category.name;
    content.appendChild(label);

    const count = document.createElement('div');
    count.className = 'category-count';
    count.textContent = category.count.toLocaleString();
    content.appendChild(count);

    item.appendChild(content);
    list.appendChild(item);
  });
}

// ============================================================================
// INTERACTION HANDLERS
// ============================================================================

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
 * Create filter for selected category
 */
function createCategoryFilter(
  categorySlot: Slot | undefined,
  categoryValue: any
): ItemFilter[] {
  if (!categorySlot?.content || categorySlot.content.length === 0) {
    return [];
  }

  const column = categorySlot.content[0];
  return [{
    expression: '? = ?',
    parameters: [
      {
        column_id: column.columnId,
        dataset_id: column.datasetId
      },
      categoryValue
    ],
    properties: {
      origin: 'filterFromVizItem',
      type: 'where'
    }
  }];
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
  if (newState.selectedCategory) {
    const filters = createCategoryFilter(newState.categorySlot, clickedValue);
    sendFilterEvent(filters);
  } else {
    sendFilterEvent([]);
  }
}

// ============================================================================
// QUERY BUILDING
// ============================================================================

/**
 * Build dimension object from slot content
 */
function buildDimension(column: any): any {
  return {
    dataset_id: column.datasetId || column.set,
    column_id: column.columnId || column.column,
    level: column.level || 1
  };
}

/**
 * Build measure object from slot content
 */
function buildMeasure(column: any): any {
  const measure: any = {
    dataset_id: column.datasetId || column.set,
    column_id: column.columnId || column.column
  };

  if (column.aggregationFunc && ['sum', 'average', 'min', 'max', 'count'].includes(column.aggregationFunc)) {
    measure.aggregation = { type: column.aggregationFunc };
  }

  return measure;
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
  dimensions.push(buildDimension(categorySlot.content[0]));

  // Add order column as dimension if provided (for sorting and color assignment)
  if (orderSlot?.content && orderSlot.content.length > 0) {
    dimensions.push(buildDimension(orderSlot.content[0]));
  }

  // Add size measure (Measure 1) - for legend counts
  measures.push(buildMeasure(sizeSlot.content[0]));

  // Add measure column (Measure 2) - for center KPI average score
  measures.push(buildMeasure(measureSlot.content[0]));

  // Note: Title slot is NOT added to query - we only use the column name from slot metadata

  return {
    dimensions,
    measures,
    order: []
  };
};
