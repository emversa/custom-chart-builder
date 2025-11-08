import type {
  ItemData,
  ItemFilter,
  ItemThemeConfig,
  ItemQuery,
  Slot,
  SlotConfig
} from '@luzmo/dashboard-contents-types';

// Data structures
interface AlertItem {
  category: string;
  count: number;
  color: string;
  backgroundColor: string;
  columnId?: string;
  datasetId?: string;
  value?: string;
  order?: number;
  percentage?: number;
  textColor?: string;
  borderColor?: string;
  countColor?: string;
}

interface ChartState {
  items: AlertItem[];
  total: number;
  categorySlot?: Slot;
  measureSlot?: Slot;
  orderSlot?: Slot;
  title?: string;
  selectedCategory?: string | null;
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

// Default color configuration
// Order determines severity: 0=Critical (Red), 1=Warning (Yellow), 2=Info (Green), etc.
const DEFAULT_COLORS: string[] = [
  '#BA1A1A', // 0 = Critical (Red)
  '#FEC325', // 1 = Warning (Yellow)
  '#75BB43', // 2 = Info/Success (Green)
  '#3b82f6', // 3 = Info (Blue)
  '#8b5cf6', // 4 = Purple
  '#ec4899', // 5 = Pink
  '#06b6d4', // 6 = Cyan
  '#84cc16', // 7 = Lime
];

// Map colors to light background colors
const BACKGROUND_COLOR_MAP: Record<string, string> = {
  '#BA1A1A': '#FFE2E4', // Red -> light red
  '#FEC325': '#FFEFD4', // Yellow -> light yellow
  '#75BB43': '#DDF3CD', // Green -> light green
  '#3b82f6': '#E0EFFF', // Blue -> light blue
  '#8b5cf6': '#F3E8FF', // Purple -> light purple
  '#ec4899': '#FCE7F3', // Pink -> light pink
  '#06b6d4': '#CFFAFE', // Cyan -> light cyan
  '#84cc16': '#ECFCCB', // Lime -> light lime
};

/**
 * Helper function to extract column label
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

/**
 * Get background color for a given color
 */
function getBackgroundColor(color: string): string {
  return BACKGROUND_COLOR_MAP[color] || '#F3F4F6';
}

/**
 * Get conditional colors based on percentage
 * Returns {backgroundColor, textColor, borderColor, countColor} based on percentage ranges
 */
function getConditionalColors(percentage: number): {
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  countColor: string;
} {
  if (percentage >= 0 && percentage < 20) {
    // Healthy
    return {
      backgroundColor: '#E6F6DA',
      textColor: '#245100',
      borderColor: '#75BB43',
      countColor: '#326B00'
    };
  } else if (percentage >= 20 && percentage <= 51) {
    // Warning
    return {
      backgroundColor: '#FFF3DF',
      textColor: '#785A00',
      borderColor: '#F5B200',
      countColor: '#785A00'
    };
  } else {
    // Error (52-100%)
    return {
      backgroundColor: '#FFEAEB',
      textColor: '#690005',
      borderColor: '#BA1A1A',
      countColor: '#93000A'
    };
  }
}

/**
 * Resolve theme from options
 */
function resolveTheme(theme?: ItemThemeConfig): ThemeContext {
  const backgroundColor = theme?.itemsBackground || '#ffffff';

  // Simple luminance check for text color
  const rgb = backgroundColor.match(/\w\w/g);
  let textColor = '#1f2937';
  if (rgb) {
    const r = parseInt(rgb[0], 16);
    const g = parseInt(rgb[1], 16);
    const b = parseInt(rgb[2], 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    textColor = luminance < 0.5 ? '#f8fafc' : '#1f2937';
  }

  const fontFamily = theme?.font?.fontFamily ||
    'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

  return {
    backgroundColor,
    textColor,
    fontFamily,
    mainColor: (theme as any)?.mainColor || '#6366f1',
    colors: theme?.colors || DEFAULT_COLORS
  };
}

/**
 * Process data from slots into AlertItem array
 * For single card component - returns only the first category
 */
function processData(
  data: ItemData['data'],
  slots: Slot[],
  theme: ThemeContext,
  language: string
): ChartState {
  const categorySlot = slots.find(s => s.name === 'category');
  const measureSlot = slots.find(s => s.name === 'measure');
  const orderSlot = slots.find(s => s.name === 'order');
  const titleSlot = slots.find(s => s.name === 'legend');

  const hasOrderColumn = orderSlot?.content && orderSlot.content.length > 0;
  const hasTitleColumn = titleSlot?.content && titleSlot.content.length > 0;

  // Extract title from title slot column name
  const customTitle = hasTitleColumn && titleSlot?.content?.[0]
    ? formatTitle(extractColumnLabel(titleSlot.content[0], language, ''))
    : undefined;

  // Build items array
  const items: AlertItem[] = [];

  // Process data - expecting grouped/aggregated data
  // Data structure: [category, order (optional), measure]
  if (categorySlot?.content && categorySlot.content.length > 0 &&
      measureSlot?.content && measureSlot.content.length > 0 &&
      data && data.length > 0) {

    // Parse all rows and store them
    interface ParsedRow {
      categoryLabel: string;
      orderValue: number;
      measureValue: number;
    }

    const parsedRows: ParsedRow[] = [];

    data.forEach((row) => {
      // Data structure: dimensions first, then measures
      // Without order: [categoryValue, measureValue]
      // With order: [categoryValue, orderValue, measureValue]

      const categoryObj = row[0];
      const categoryLabel = String(categoryObj?.id ?? categoryObj ?? 'Unknown');

      let orderValue = 0;
      let measureIndex = 1; // Measure is at index 1 by default (no order)

      if (hasOrderColumn) {
        const orderObj = row[1];
        if (orderObj !== undefined && orderObj !== null) {
          if (typeof orderObj === 'number') {
            orderValue = orderObj;
          } else if (typeof orderObj === 'object' && 'id' in orderObj) {
            orderValue = Number(orderObj.id);
          } else {
            orderValue = Number(orderObj);
          }
        }
        measureIndex = 2; // With order, measure is at index 2
      }

      const measureObj = row[measureIndex];
      let measureValue = 0;
      if (measureObj !== undefined && measureObj !== null) {
        if (typeof measureObj === 'number') {
          measureValue = measureObj;
        } else if (typeof measureObj === 'object' && 'id' in measureObj) {
          measureValue = Number(measureObj.id);
        } else {
          measureValue = Number(measureObj);
        }
      }

      parsedRows.push({ categoryLabel, orderValue, measureValue });
    });

    // Sort by order value (ascending)
    parsedRows.sort((a, b) => a.orderValue - b.orderValue);

    // Take the first row after sorting
    if (parsedRows.length > 0) {
      const firstRow = parsedRows[0];

      // Use order value to determine color (0=Healthy, 1=Warning, 2+=Error)
      const conditionalColors = firstRow.orderValue === 0
        ? { backgroundColor: '#E6F6DA', textColor: '#245100', borderColor: '#75BB43', countColor: '#326B00' }
        : firstRow.orderValue === 1
        ? { backgroundColor: '#FFF3DF', textColor: '#785A00', borderColor: '#F5B200', countColor: '#785A00' }
        : { backgroundColor: '#FFEAEB', textColor: '#690005', borderColor: '#BA1A1A', countColor: '#93000A' };

      const color = theme.colors[firstRow.orderValue % theme.colors.length];

      items.push({
        category: firstRow.categoryLabel,
        count: firstRow.measureValue,
        color: color,
        backgroundColor: conditionalColors.backgroundColor,
        textColor: conditionalColors.textColor,
        borderColor: conditionalColors.borderColor,
        countColor: conditionalColors.countColor,
        columnId: categorySlot?.content?.[0]?.columnId,
        datasetId: categorySlot?.content?.[0]?.datasetId,
        value: firstRow.categoryLabel,
        order: firstRow.orderValue,
        percentage: 100 // Single value displayed
      });
    }
  }

  // Fallback: sample data (single item)
  if (items.length === 0) {
    const color = theme.colors[0];
    const conditionalColors = { backgroundColor: '#FFEAEB', textColor: '#690005', borderColor: '#BA1A1A', countColor: '#93000A' };
    items.push({
      category: 'Sample KPI',
      count: 42,
      color,
      backgroundColor: conditionalColors.backgroundColor,
      textColor: conditionalColors.textColor,
      borderColor: conditionalColors.borderColor,
      countColor: conditionalColors.countColor,
      order: 2,
      percentage: 100
    });
  }

  // Calculate total
  const total = items[0]?.count ?? 0;

  return {
    items,
    total,
    categorySlot,
    measureSlot,
    orderSlot,
    title: customTitle,
    selectedCategory: null
  };
}

/**
 * Main render function
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
  const state = processData(data, slots, theme, language);

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
 * Main widget rendering function - Single card layout
 */
function renderWidget(
  container: HTMLElement,
  state: ChartState,
  theme: ThemeContext,
  width: number,
  height: number
): void {
  container.innerHTML = '';
  container.style.backgroundColor = theme.backgroundColor;

  // Handle empty state
  if (state.items.length === 0) {
    renderEmptyState(container, theme);
    return;
  }

  // Create main container
  const widget = document.createElement('div');
  widget.className = 'alert-widget-single';
  container.appendChild(widget);

  // Title (optional)
  const title = document.createElement('div');
  title.className = 'alert-title';
  title.textContent = state.title || '\u00A0';
  title.style.color = theme.textColor;
  if (!state.title) {
    title.style.opacity = '0';
  }
  widget.appendChild(title);

  // Single card container
  const cardContainer = document.createElement('div');
  cardContainer.className = 'alert-card-container';
  widget.appendChild(cardContainer);

  // Render the single alert item
  const item = state.items[0];
  const card = document.createElement('div');
  card.className = 'alert-card';

  // Determine layout based on dimensions
  // Horizontal (stacked) layout when height >= width
  // Vertical (side-by-side) layout when height < width
  const isHorizontalLayout = height >= width;
  if (isHorizontalLayout) {
    card.classList.add('alert-card-horizontal');
  }

  // Use conditional background color
  // Horizontal/wide: white background, Vertical/tall: conditional background
  card.style.backgroundColor = isHorizontalLayout ? item.backgroundColor : '#FFF';

  // Add selected state styling
  // Vertical/tall layout: no border when unselected, 2px when selected (uses textColor)
  // Horizontal/wide layout: 1px border when unselected, 2px when selected (uses borderColor)
  if (state.selectedCategory === item.value) {
    card.classList.add('alert-card-selected');
    card.style.borderColor = isHorizontalLayout ? (item.textColor || item.color) : (item.borderColor || item.color);
    card.style.borderWidth = '2px';
  } else {
    card.style.borderColor = isHorizontalLayout ? (item.textColor || item.color) : (item.borderColor || item.color);
    card.style.borderWidth = isHorizontalLayout ? '0' : '1px';
  }

  card.setAttribute('data-category', item.category);

  // Color indicator (left border) - use border color for indicator
  const indicator = document.createElement('div');
  indicator.className = 'alert-indicator';
  indicator.style.backgroundColor = item.borderColor || item.color;
  card.appendChild(indicator);

  // Content container
  const content = document.createElement('div');
  content.className = 'alert-content';

  // Count - vertical/tall uses textColor, horizontal/wide uses countColor
  const count = document.createElement('div');
  count.className = 'alert-count';
  count.style.color = isHorizontalLayout ? (item.textColor || theme.textColor) : (item.countColor || theme.textColor);
  count.textContent = item.count.toLocaleString();
  content.appendChild(count);

  // Description - vertical/tall uses textColor, horizontal/wide uses fixed gray
  const description = document.createElement('div');
  description.className = 'alert-description';
  description.style.color = isHorizontalLayout ? (item.textColor || theme.textColor) : 'rgba(24, 28, 32, 0.60)';
  description.textContent = item.category;
  content.appendChild(description);

  card.appendChild(content);
  cardContainer.appendChild(card);

  // Add click handler for filtering
  card.addEventListener('click', () => {
    handleCardClick(item, state, container, theme, width, height);
  });
}

/**
 * Render empty state
 */
function renderEmptyState(container: HTMLElement, theme: ThemeContext): void {
  const emptyState = document.createElement('div');
  emptyState.className = 'empty-state';
  emptyState.style.color = theme.textColor;

  const icon = document.createElement('div');
  icon.className = 'empty-state-icon';
  icon.innerHTML = '📋';
  emptyState.appendChild(icon);

  const title = document.createElement('div');
  title.className = 'empty-state-title';
  title.textContent = 'No Alerts Available';
  emptyState.appendChild(title);

  const message = document.createElement('div');
  message.className = 'empty-state-message';
  message.textContent = 'Add an Alert Category and Record ID to get started.';
  emptyState.appendChild(message);

  container.appendChild(emptyState);
}

/**
 * Handle card click for filtering
 */
function handleCardClick(
  item: AlertItem,
  state: ChartState,
  container: HTMLElement,
  theme: ThemeContext,
  width: number,
  height: number
): void {
  // Toggle selection: if clicking same category, deselect it
  const clickedValue = item.value!;
  const wasSelected = state.selectedCategory === clickedValue;

  // Update selection state
  state.selectedCategory = wasSelected ? null : clickedValue;

  // Re-render the widget with updated state
  renderWidget(container, state, theme, width, height);

  // Send custom event
  window.parent.postMessage({
    type: 'customEvent',
    data: {
      eventType: 'alertSelected',
      category: item.category,
      count: item.count,
      isFiltered: !wasSelected
    }
  }, '*');

  // Send filter event (only if category is selected, not deselected)
  if (!wasSelected && state.categorySlot?.content && state.categorySlot.content.length > 0) {
    const column = state.categorySlot.content[0];
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

    window.parent.postMessage({ type: 'setFilter', filters }, '*');
  } else if (wasSelected) {
    // Clear filter when deselected
    window.parent.postMessage({ type: 'setFilter', filters: [] }, '*');
  }
}

/**
 * Build query for data retrieval
 */
export const buildQuery = ({
  slots = [],
  slotConfigurations = []
}: {
  slots: Slot[];
  slotConfigurations: SlotConfig[];
}): ItemQuery => {
  const categorySlot = slots.find(s => s.name === 'category');
  const measureSlot = slots.find(s => s.name === 'measure');
  const orderSlot = slots.find(s => s.name === 'order');

  // Category and measure are required
  if (!categorySlot?.content || categorySlot.content.length === 0 ||
      !measureSlot?.content || measureSlot.content.length === 0) {
    return {
      dimensions: [],
      measures: [],
      order: []
    };
  }

  const dimensions: any[] = [];
  const measures: any[] = [];

  // Add category dimension (for grouping)
  const categoryColumn = categorySlot.content[0];
  dimensions.push({
    dataset_id: categoryColumn.datasetId || (categoryColumn as any).set,
    column_id: categoryColumn.columnId || (categoryColumn as any).column,
    level: categoryColumn.level || 1
  });

  // Add order dimension if provided (for sorting which category appears first)
  if (orderSlot?.content && orderSlot.content.length > 0) {
    const orderColumn = orderSlot.content[0];
    dimensions.push({
      dataset_id: orderColumn.datasetId || (orderColumn as any).set,
      column_id: orderColumn.columnId || (orderColumn as any).column,
      level: 1
    });
  }

  // Add measure (will be aggregated per category)
  const measureColumn = measureSlot.content[0];
  const measureDef: any = {
    dataset_id: measureColumn.datasetId || (measureColumn as any).set,
    column_id: measureColumn.columnId || (measureColumn as any).column,
    // When grouping by dimensions, aggregation is required - default to sum
    aggregation: (measureColumn as any).aggregation || 'sum'
  };

  // Only add format if it exists on the column
  if ((measureColumn as any).format) {
    measureDef.format = (measureColumn as any).format;
  }

  measures.push(measureDef);

  return {
    dimensions,
    measures,
    order: []
  };
};
