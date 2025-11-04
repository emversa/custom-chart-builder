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
  measureSlot?: Slot;
  legendSlot?: Slot;
  allScores: number[]; // Store all raw scores for filtering
  selectedCategory?: 'Healthy' | 'Warning' | 'Error' | null; // Track selected filter
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
 * Categorize a score into health status
 * Healthy: 81-100
 * Warning: 51-80
 * Error: 0-50
 */
function categorizeScore(score: number): 'Healthy' | 'Warning' | 'Error' {
  if (score >= 81) return 'Healthy';
  if (score >= 51) return 'Warning';
  return 'Error';
}

/**
 * Process data from slots into StatusCategory array
 *
 * LOGIC:
 * 1. Input: Multiple rows with health scores (e.g., 1000 records)
 * 2. For each score, categorize into: Healthy (81-100), Warning (51-80), Error (0-50)
 * 3. Legend shows: COUNT of records in each category
 * 4. Center shows: AVERAGE (aggregated) score across all records
 *
 * Example: 1000 records
 *  - 500 records with scores 81-100 → Healthy count = 500
 *  - 300 records with scores 51-80 → Warning count = 300
 *  - 200 records with scores 0-50 → Error count = 200
 *  - Center displays: Average of all 1000 scores (e.g., 72)
 */
function processData(
  data: ItemData['data'],
  slots: Slot[],
  colors: string[],
  language: string
): ChartState {
  const measureSlot = slots.find(s => s.name === 'measure');
  const legendSlot = slots.find(s => s.name === 'legend');

  // Predefined colors for health categories
  const healthyColor = '#75BB43';  // Green
  const warningColor = '#FEC235';  // Yellow
  const errorColor = '#BA1A1A';    // Red

  // Track COUNT of records in each category
  const categoryCounts = {
    'Healthy': 0,
    'Warning': 0,
    'Error': 0
  };

  let scores: number[] = [];

  // Process data - expecting one score column with multiple rows (e.g., 1000 records)
  if (measureSlot?.content && measureSlot.content.length > 0 && data.length > 0) {
    // Get the first (and should be only) measure column
    const scoreColumn = measureSlot.content[0];

    // Check if we have a dimension column (ID) - if so, score is at index 1, otherwise index 0
    const categorySlot = slots.find(s => s.name === 'category');
    const hasDimension = categorySlot?.content && categorySlot.content.length > 0;
    const scoreIndex = hasDimension ? 1 : 0;

    // Process each row: categorize the score and count it
    data.forEach((row) => {
      const scoreValue = Number(row[scoreIndex]) || 0;
      scores.push(scoreValue);

      // Categorize this record and increment the count
      const category = categorizeScore(scoreValue);
      categoryCounts[category]++;
    });
  }

  // Fallback: sample data (12 records for demo)
  if (scores.length === 0) {
    scores = [95, 87, 92, 78, 65, 45, 32, 88, 91, 56, 72, 38];
    scores.forEach(score => {
      const category = categorizeScore(score);
      categoryCounts[category]++;
    });
  }

  // Calculate aggregated score = AVERAGE of all scores
  const aggregatedScore = scores.length > 0
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : 0;

  // Total = number of records processed
  const total = scores.length;

  // Build categories array
  const categories: StatusCategory[] = [
    {
      name: 'Healthy (81-100)',
      count: categoryCounts['Healthy'],
      color: healthyColor,
      columnId: measureSlot?.content?.[0]?.columnId,
      datasetId: measureSlot?.content?.[0]?.datasetId,
      value: 'Healthy'
    },
    {
      name: 'Warning (51-80)',
      count: categoryCounts['Warning'],
      color: warningColor,
      columnId: measureSlot?.content?.[0]?.columnId,
      datasetId: measureSlot?.content?.[0]?.datasetId,
      value: 'Warning'
    },
    {
      name: 'Error (0-50)',
      count: categoryCounts['Error'],
      color: errorColor,
      columnId: measureSlot?.content?.[0]?.columnId,
      datasetId: measureSlot?.content?.[0]?.datasetId,
      value: 'Error'
    }
  ];

  return {
    categories,
    total,
    aggregatedScore,
    measureSlot,
    legendSlot,
    allScores: scores, // Store all scores for filtering
    selectedCategory: null // No filter by default
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

/**
 * Get background color based on aggregated score
 */
function getBackgroundColor(score: number): string {
  if (score >= 81) return '#DDF3CD'; // Healthy
  if (score >= 51) return '#FFEFD4'; // Warning
  return '#FFE2E4'; // Error
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

  // Add title
  const title = document.createElement('div');
  title.className = 'widget-title';
  title.textContent = 'Health Score Status';
  title.style.color = theme.textColor;
  widget.appendChild(title);

  // Create content wrapper for categories and chart
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'widget-content';
  widget.appendChild(contentWrapper);

  // Always use horizontal layout - never stack vertically
  contentWrapper.classList.add('desktop-layout');

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
 * Render the donut chart with center percentage
 */
function renderDonutChart(
  container: HTMLElement,
  state: ChartState,
  theme: ThemeContext,
  containerWidth: number
): void {
  // Scale donut size based on container, optimized for horizontal layout
  // At small sizes, donut should be smaller to fit alongside legend
  const size = Math.min(Math.max(containerWidth * 0.8, 80), 260);
  const radius = size / 2;
  const innerRadius = radius * 0.6;

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

  // Center text - aggregated score (perfectly centered)
  g.append('text')
    .attr('class', 'center-score')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('x', 0)
    .attr('y', 0)
    .style('font-size', `${radius * 0.5}px`)
    .style('font-weight', '700')
    .style('fill', theme.textColor)
    .text(`${state.aggregatedScore}`);
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
  const clickedValue = category.value as 'Healthy' | 'Warning' | 'Error';
  const wasSelected = state.selectedCategory === clickedValue;

  // Update selection state
  state.selectedCategory = wasSelected ? null : clickedValue;

  // Recalculate based on selection
  let filteredScores: number[];
  let newAggregatedScore: number;
  let newTotal: number;

  if (state.selectedCategory) {
    // Filter scores based on selected category
    filteredScores = state.allScores.filter(score => {
      const cat = categorizeScore(score);
      return cat === state.selectedCategory;
    });
    newTotal = filteredScores.length;
    newAggregatedScore = newTotal > 0
      ? Math.round(filteredScores.reduce((sum, score) => sum + score, 0) / newTotal)
      : 0;
  } else {
    // Show all data
    filteredScores = state.allScores;
    newTotal = state.allScores.length;
    newAggregatedScore = newTotal > 0
      ? Math.round(filteredScores.reduce((sum, score) => sum + score, 0) / newTotal)
      : 0;
  }

  // Update state
  state.total = newTotal;
  state.aggregatedScore = newAggregatedScore;

  // Recalculate category counts based on filtered data
  const newCounts = { 'Healthy': 0, 'Warning': 0, 'Error': 0 };
  filteredScores.forEach(score => {
    const cat = categorizeScore(score);
    newCounts[cat]++;
  });

  // Update category counts
  state.categories.forEach(cat => {
    cat.count = newCounts[cat.value as 'Healthy' | 'Warning' | 'Error'];
  });

  // Re-render the widget with updated state
  renderWidget(container, state, theme, width, height);

  // Send custom event
  sendCustomEvent({
    eventType: 'statusCategorySelected',
    category: category.name,
    count: category.count,
    totalRecords: state.total,
    aggregatedScore: state.aggregatedScore,
    isFiltered: state.selectedCategory !== null
  });

  // Also send filter event to dashboard (only if category is selected, not deselected)
  if (state.selectedCategory && state.measureSlot?.content && state.measureSlot.content.length > 0) {
    const column = state.measureSlot.content[0];
    let filters: ItemFilter[] = [];

    // Determine the score range based on category
    if (clickedValue === 'Healthy') {
      filters = [{
        expression: '? >= ?',
        parameters: [
          {
            column_id: column.columnId,
            dataset_id: column.datasetId
          },
          81
        ],
        properties: {
          origin: 'filterFromVizItem',
          type: 'where'
        }
      }];
    } else if (clickedValue === 'Warning') {
      // Filter for scores >= 51 AND <= 80 using two filters
      filters = [
        {
          expression: '? >= ?',
          parameters: [
            {
              column_id: column.columnId,
              dataset_id: column.datasetId
            },
            51
          ],
          properties: {
            origin: 'filterFromVizItem',
            type: 'where'
          }
        },
        {
          expression: '? <= ?',
          parameters: [
            {
              column_id: column.columnId,
              dataset_id: column.datasetId
            },
            80
          ],
          properties: {
            origin: 'filterFromVizItem',
            type: 'where'
          }
        }
      ];
    } else if (clickedValue === 'Error') {
      filters = [{
        expression: '? < ?',
        parameters: [
          {
            column_id: column.columnId,
            dataset_id: column.datasetId
          },
          51
        ],
        properties: {
          origin: 'filterFromVizItem',
          type: 'where'
        }
      }];
    }

    if (filters.length > 0) {
      sendFilterEvent(filters);
    }
  } else if (!state.selectedCategory) {
    // Clear filter when deselected
    sendFilterEvent([]);
  }
}

/**
 * Build query for data retrieval
 *
 * CRITICAL: We need ROW-LEVEL data (not aggregated) to count records in each health category
 *
 * To get row-level data from Luzmo, we MUST have a dimension (like ID or timestamp)
 * Without a dimension, Luzmo will aggregate all measures into a single row!
 *
 * Example with ID dimension:
 * - Input: 1000 records with [ID, Score]
 * - Output: 1000 rows, each with a unique ID and its score
 * - We can then count: 800 Healthy, 150 Warning, 50 Error
 */
export const buildQuery = ({
  slots = [],
  slotConfigurations = []
}: {
  slots: Slot[];
  slotConfigurations: SlotConfig[];
}): ItemQuery => {
  const measureSlot = slots.find(s => s.name === 'measure');
  const categorySlot = slots.find(s => s.name === 'category');

  if (!measureSlot?.content || measureSlot.content.length === 0) {
    return {
      dimensions: [],
      measures: [],
      limit: { by: 10000, offset: 0 }
    };
  }

  const scoreColumn = measureSlot.content[0];
  const dimensions: any[] = [];
  const measures: any[] = [];

  // Add the ID/dimension column if provided - THIS IS CRITICAL for row-level data
  if (categorySlot?.content && categorySlot.content.length > 0) {
    const idColumn = categorySlot.content[0];
    dimensions.push({
      dataset_id: idColumn.datasetId || (idColumn as any).set,
      column_id: idColumn.columnId || (idColumn as any).column,
      level: idColumn.level || 1
    });
  }

  // Add the score column as a measure without aggregation
  measures.push({
    dataset_id: scoreColumn.datasetId || (scoreColumn as any).set,
    column_id: scoreColumn.columnId || (scoreColumn as any).column,
    // No aggregation - just return the raw values
  });

  return {
    dimensions,
    measures,
    order: []
    // No limit - process all records
  };
};
