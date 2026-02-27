// ============================================================================
// IMPORTS AND TYPE DEFINITIONS
// ============================================================================

import type {
  ItemData,
  ItemThemeConfig,
  ItemQuery,
  Slot,
  SlotConfig
} from '@luzmo/dashboard-contents-types';
import * as d3 from 'd3';

// ============================================================================
// DATA STRUCTURES
// ============================================================================

interface Project {
  id: string;
  category: string;
  name: string;
  startDate: Date;
  endDate: Date;
  assignee: string | null;
  status: string;
  hoursBilled: number | null;
  hoursEstimated: number | null;
  hoursBudgeted: number | null;
  colorCode: string;
  parentId: string | null;
  client?: string;
  link?: string;
  depth: number;
  children?: Project[];
  isExpanded?: boolean;
}

interface ChartState {
  projects: Project[];
  flatProjects: Project[];
  minDate: Date;
  maxDate: Date;
}

interface ThemeContext {
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  mainColor: string;
  isDark: boolean;
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
// CONSTANTS
// ============================================================================

const ROW_HEIGHT = 40;
const LEFT_PANEL_WIDTH = 350;
const TIMELINE_HEADER_HEIGHT = 60;
const BAR_HEIGHT = 32;
const BAR_VERTICAL_PADDING = 4;
const PADDING = 16;
const MIN_BAR_WIDTH_FOR_LABELS = 120;
const MIN_BAR_WIDTH_FOR_INITIALS = 60;

const COLOR_MAP: Record<string, string> = {
  PURPLE: '#A78BFA',
  ORANGE: '#FB923C',
  GREEN: '#4ADE80',
  GRAY: '#94A3B8',
  GREY: '#94A3B8'
};

const STATUS_COLORS: Record<string, string> = {
  active: '#4ADE80',
  'at risk': '#FB923C',
  completed: '#60A5FA',
  'in planning': '#94A3B8',
  pipeline: '#94A3B8'
};

// Hierarchy depth is computed dynamically from the parent chain.
// Category ordering for display purposes only.
const CATEGORY_ORDER: Record<string, number> = {
  organization: 0,
  deal: 1,
  epic: 2,
  story: 3
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function extractValue(obj: any, type: 'string' | 'number' | 'date'): any {
  if (obj === null || obj === undefined) return null;

  switch (type) {
    case 'date': {
      if (obj instanceof Date) return obj;
      const date = new Date(typeof obj === 'object' && 'id' in obj ? obj.id : obj);
      return isNaN(date.getTime()) ? null : date;
    }

    case 'number': {
      if (typeof obj === 'number') return obj;
      if (typeof obj === 'object' && 'id' in obj) {
        if (obj.id === null || obj.id === undefined) return null;
        const num = Number(obj.id);
        return isNaN(num) ? null : num;
      }
      const num = Number(obj);
      return isNaN(num) ? null : num;
    }

    case 'string': {
      if (typeof obj === 'string') return obj;
      if (typeof obj === 'object' && 'name' in obj) {
        const nameObj = obj.name;
        if (typeof nameObj === 'object' && nameObj !== null) {
          return String(nameObj.en ?? Object.values(nameObj)[0] ?? obj.id ?? 'Unknown');
        }
        return String(nameObj ?? obj.id ?? 'Unknown');
      }
      if (typeof obj === 'object' && 'id' in obj) return String(obj.id);
      return String(obj);
    }
  }
}

function getInitials(fullName: string | null): string | null {
  if (!fullName || fullName.trim() === '') return null;

  const parts = fullName.trim().split(' ');
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }

  return parts
    .map(part => part.charAt(0).toUpperCase())
    .join('')
    .substring(0, 2);
}

function formatHours(hours: number | null): string {
  return hours !== null ? hours.toFixed(1) : '—';
}

function formatHoursDisplay(billed: number | null, estimated: number | null, budgeted: number | null): string {
  return `${formatHours(billed)}/${formatHours(estimated)}/${formatHours(budgeted)}`;
}

function calculateProgress(billed: number | null, budgeted: number | null): number {
  if (billed === null || budgeted === null || budgeted === 0) return 0;
  return Math.min(Math.max(billed / budgeted, 0), 1);
}

// ============================================================================
// THEME HELPERS
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
  const backgroundColor = theme?.itemsBackground || '#F8FAFC';
  const backgroundRgb = toRgb(backgroundColor);
  const luminance = getRelativeLuminance(backgroundRgb);
  const isDark = luminance < 0.45;
  const textColor = isDark ? '#F8FAFC' : '#1E293B';
  const mainColor = theme?.mainColor || '#6366F1';
  const fontFamily = theme?.font?.fontFamily ||
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

  return {
    backgroundColor,
    textColor,
    fontFamily,
    mainColor,
    isDark
  };
}

function getThemedColor(lightColor: string, darkColor: string, isDark: boolean): string {
  return isDark ? darkColor : lightColor;
}

// ============================================================================
// DATA PROCESSING
// ============================================================================

function processData(
  data: ItemData['data'],
  slots: Slot[],
  language: string
): ChartState {
  const nameSlot = slots.find(s => s.name === 'name');
  const categorySlot = slots.find(s => s.name === 'category');
  const startDateSlot = slots.find(s => s.name === 'time');
  const endDateSlot = slots.find(s => s.name === 'evolution');
  const statusSlot = slots.find(s => s.name === 'identifier');
  const assigneeSlot = slots.find(s => s.name === 'dimension');
  const hoursBilledSlot = slots.find(s => s.name === 'measure');
  const hoursEstimatedSlot = slots.find(s => s.name === 'columns');
  const hoursBudgetedSlot = slots.find(s => s.name === 'size');
  const colorCodeSlot = slots.find(s => s.name === 'color');
  const parentIdSlot = slots.find(s => s.name === 'levels');
  const projectIdSlot = slots.find(s => s.name === 'row');
  const clientSlot = slots.find(s => s.name === 'slidermetric');
  const linkSlot = slots.find(s => s.name === 'destination');

  let projects: Project[] = [];
  let minDate = new Date();
  let maxDate = new Date();

  if (data && data.length > 0) {
    // Build column index mapping based on which slots have content
    const columnMapping: { [key: string]: number } = {};
    let currentIndex = 0;

    // IMPORTANT: This order MUST match the buildQuery function's dimension order
    // Required dimensions first (matching buildQuery)
    if (nameSlot?.content?.[0]) columnMapping['name'] = currentIndex++;
    if (categorySlot?.content?.[0]) columnMapping['category'] = currentIndex++;
    if (startDateSlot?.content?.[0]) columnMapping['startDate'] = currentIndex++;
    if (endDateSlot?.content?.[0]) columnMapping['endDate'] = currentIndex++;

    // Optional dimensions (matching buildQuery order: row, destination, identifier, dimension, color, levels, slidermetric, measure, columns, size)
    // Numeric slots (hours) are included as dimensions to prevent default API aggregation
    if (projectIdSlot?.content?.[0]) columnMapping['projectId'] = currentIndex++;
    if (linkSlot?.content?.[0]) columnMapping['link'] = currentIndex++;
    if (statusSlot?.content?.[0]) columnMapping['status'] = currentIndex++;
    if (assigneeSlot?.content?.[0]) columnMapping['assignee'] = currentIndex++;
    if (colorCodeSlot?.content?.[0]) columnMapping['colorCode'] = currentIndex++;
    if (parentIdSlot?.content?.[0]) columnMapping['parentId'] = currentIndex++;
    if (clientSlot?.content?.[0]) columnMapping['client'] = currentIndex++;
    if (hoursBilledSlot?.content?.[0]) columnMapping['hoursBilled'] = currentIndex++;
    if (hoursEstimatedSlot?.content?.[0]) columnMapping['hoursEstimated'] = currentIndex++;
    if (hoursBudgetedSlot?.content?.[0]) columnMapping['hoursBudgeted'] = currentIndex++;

    data.forEach((row, index) => {
      const name = 'name' in columnMapping ? extractValue(row[columnMapping['name']], 'string') : `Project ${index + 1}`;
      const category = 'category' in columnMapping ? extractValue(row[columnMapping['category']], 'string') : 'epic';
      const startDate = 'startDate' in columnMapping ? extractValue(row[columnMapping['startDate']], 'date') : new Date();
      const endDate = 'endDate' in columnMapping ? extractValue(row[columnMapping['endDate']], 'date') : new Date();
      const status = 'status' in columnMapping ? extractValue(row[columnMapping['status']], 'string') : 'active';
      const assignee = 'assignee' in columnMapping ? extractValue(row[columnMapping['assignee']], 'string') : null;
      const hoursBilled = 'hoursBilled' in columnMapping ? extractValue(row[columnMapping['hoursBilled']], 'number') : null;
      const hoursEstimated = 'hoursEstimated' in columnMapping ? extractValue(row[columnMapping['hoursEstimated']], 'number') : null;
      const hoursBudgeted = 'hoursBudgeted' in columnMapping ? extractValue(row[columnMapping['hoursBudgeted']], 'number') : null;
      const colorCode = 'colorCode' in columnMapping ? extractValue(row[columnMapping['colorCode']], 'string') : 'PURPLE';
      const parentId = 'parentId' in columnMapping ? extractValue(row[columnMapping['parentId']], 'string') : null;
      const projectId = 'projectId' in columnMapping ? extractValue(row[columnMapping['projectId']], 'string') : `project-${index}`;
      const client = 'client' in columnMapping ? extractValue(row[columnMapping['client']], 'string') : undefined;
      const link = 'link' in columnMapping ? extractValue(row[columnMapping['link']], 'string') : undefined;

      const catLower = (category || 'epic').toLowerCase();
      const rawId = projectId || `project-${index}`;
      const compositeId = `${catLower}_${rawId}`;
      const rawParentId = parentId && parentId !== 'null' && parentId !== '' ? parentId : null;

      // Keep all rows — dateless rows are valid hierarchy parents at any level.
      // Sentinel dates will be replaced by children's date ranges later.
      const hasDates = startDate && endDate && !isNaN(startDate.getTime()) && !isNaN(endDate.getTime());

      const effectiveStart = hasDates ? startDate : new Date('2099-01-01');
      const effectiveEnd = hasDates ? endDate : new Date('1970-01-01');

      projects.push({
        id: compositeId,
        category: catLower,
        name: name || `Project ${index + 1}`,
        startDate: effectiveStart,
        endDate: effectiveEnd,
        assignee,
        status: status || 'active',
        hoursBilled,
        hoursEstimated,
        hoursBudgeted,
        colorCode: colorCode || 'PURPLE',
        parentId: rawParentId, // will be resolved to composite ID below
        client,
        link,
        depth: 0, // will be computed from parent chain after ID resolution
        _rawId: rawId // stash raw ID for parent resolution
      } as any);

      if (hasDates) {
        if (minDate.getTime() === maxDate.getTime() && projects.length === 1) {
          minDate = new Date(effectiveStart);
          maxDate = new Date(effectiveEnd);
        } else {
          if (effectiveStart < minDate) minDate = new Date(effectiveStart);
          if (effectiveEnd > maxDate) maxDate = new Date(effectiveEnd);
        }
      }
    });

    // Resolve parentId from raw IDs to composite IDs.
    // Build a lookup: rawId → composite project, grouped by category.
    const rawIdToComposite = new Map<string, Project[]>();
    projects.forEach(p => {
      const rawId = (p as any)._rawId || p.id;
      if (!rawIdToComposite.has(rawId)) rawIdToComposite.set(rawId, []);
      rawIdToComposite.get(rawId)!.push(p);
    });

    // Parent category priority when an ID collides across categories.
    // Based on production data: deals → org/deal, epics → deal/org, stories → epic/story
    const PARENT_CATEGORY_PRIORITY: Record<string, string[]> = {
      deal: ['organization', 'deal'],
      epic: ['deal', 'organization'],
      story: ['epic', 'story'],
      client: [],
      organization: []
    };

    projects.forEach(p => {
      if (!p.parentId) return;
      const candidates = rawIdToComposite.get(p.parentId);
      if (!candidates || candidates.length === 0) {
        p.parentId = null;
        return;
      }
      if (candidates.length === 1) {
        p.parentId = candidates[0].id;
        return;
      }
      // Multiple candidates — pick the one matching the expected parent category
      const priorities = PARENT_CATEGORY_PRIORITY[p.category] || [];
      const match = priorities.length > 0
        ? candidates.find(c => priorities.includes(c.category))
        : undefined;
      p.parentId = (match || candidates[0]).id;
    });

    // Clean up temporary _rawId
    projects.forEach(p => delete (p as any)._rawId);

    // Compute depth from actual parent chain (not fixed category mapping)
    const projectMap = new Map<string, Project>();
    projects.forEach(p => projectMap.set(p.id, p));

    function computeDepth(p: Project, visited = new Set<string>()): number {
      if (!p.parentId || visited.has(p.id)) return 0;
      visited.add(p.id);
      const parent = projectMap.get(p.parentId);
      if (!parent) return 0;
      return 1 + computeDepth(parent, visited);
    }
    projects.forEach(p => { p.depth = computeDepth(p); });

    // Build children lists for bottom-up date propagation
    const SENTINEL_START = new Date('2099-01-01').getTime();
    const SENTINEL_END = new Date('1970-01-01').getTime();
    const childrenOf = new Map<string, Project[]>();
    projects.forEach(p => {
      if (p.parentId) {
        if (!childrenOf.has(p.parentId)) childrenOf.set(p.parentId, []);
        childrenOf.get(p.parentId)!.push(p);
      }
    });

    // Recursively propagate dates bottom-up: leaves first, then parents
    function propagateDates(p: Project): void {
      const children = childrenOf.get(p.id);
      if (children) {
        children.forEach(c => propagateDates(c));
        // Now all children have resolved dates — derive parent's range
        children.forEach(c => {
          if (c.startDate.getTime() !== SENTINEL_START) {
            if (p.startDate.getTime() === SENTINEL_START || c.startDate < p.startDate) {
              p.startDate = new Date(c.startDate);
            }
          }
          if (c.endDate.getTime() !== SENTINEL_END) {
            if (p.endDate.getTime() === SENTINEL_END || c.endDate > p.endDate) {
              p.endDate = new Date(c.endDate);
            }
          }
        });
      }
    }

    // Start propagation from roots
    projects.filter(p => !p.parentId).forEach(root => propagateDates(root));

    // Final pass: any still-sentinel dates fall back to global min/max
    projects.forEach(p => {
      if (p.startDate.getTime() === SENTINEL_START) p.startDate = new Date(minDate);
      if (p.endDate.getTime() === SENTINEL_END) p.endDate = new Date(maxDate);
      if (p.startDate < minDate) minDate = new Date(p.startDate);
      if (p.endDate > maxDate) maxDate = new Date(p.endDate);
    });

    // Only keep rows that trace back to an organisation root.
    // Orphan deals, epics, and stories with no chain to an org are excluded.
    function tracesToOrg(p: Project, visited = new Set<string>()): boolean {
      if (p.category === 'organization') return true;
      if (!p.parentId || visited.has(p.id)) return false;
      visited.add(p.id);
      const parent = projectMap.get(p.parentId);
      if (!parent) return false;
      return tracesToOrg(parent, visited);
    }

    projects = projects.filter(p => tracesToOrg(p));
  }

  if (projects.length === 0) {
    const sampleProjects: Project[] = [
      {
        id: 'ORG_CLIENT_A',
        category: 'organization',
        name: 'Enterprise Platform',
        startDate: new Date('2024-09-15'),
        endDate: new Date('2025-01-15'),
        assignee: 'J. Smith',
        status: 'active',
        hoursBilled: 320,
        hoursEstimated: 300,
        hoursBudgeted: 350,
        parentId: null,
        client: 'Client A',
        colorCode: 'PURPLE',
        depth: 0
      },
      {
        id: 'EPIC_MOBILE_APP',
        category: 'epic',
        name: 'Mobile Development',
        startDate: new Date('2024-09-20'),
        endDate: new Date('2024-12-15'),
        assignee: 'T. Johnson',
        status: 'active',
        hoursBilled: 220,
        hoursEstimated: 240,
        hoursBudgeted: 260,
        parentId: 'ORG_CLIENT_A',
        client: 'Client A',
        colorCode: 'ORANGE',
        depth: 1
      },
      {
        id: 'EPIC_DATA_MIGRATION',
        category: 'epic',
        name: 'Data Integration',
        startDate: new Date('2024-08-15'),
        endDate: new Date('2025-01-15'),
        assignee: 'M. Williams',
        status: 'at risk',
        hoursBilled: 180,
        hoursEstimated: 200,
        hoursBudgeted: 220,
        parentId: 'ORG_CLIENT_A',
        client: 'Client A',
        colorCode: 'ORANGE',
        depth: 1
      },
      {
        id: 'ORG_CLIENT_B',
        category: 'organization',
        name: 'Digital Transformation',
        startDate: new Date('2024-09-15'),
        endDate: new Date('2024-12-31'),
        assignee: 'R. Davis',
        status: 'active',
        hoursBilled: 150,
        hoursEstimated: 180,
        hoursBudgeted: 190,
        parentId: null,
        client: 'Client B',
        colorCode: 'PURPLE',
        depth: 0
      },
      {
        id: 'ORG_CLIENT_C',
        category: 'organization',
        name: 'Cloud Modernization',
        startDate: new Date('2024-09-15'),
        endDate: new Date('2025-01-31'),
        assignee: 'K. Martinez',
        status: 'active',
        hoursBilled: 260,
        hoursEstimated: 260,
        hoursBudgeted: 280,
        parentId: null,
        client: 'Client C',
        colorCode: 'PURPLE',
        depth: 0
      },
      {
        id: 'EPIC_API_PLATFORM',
        category: 'epic',
        name: 'API Platform',
        startDate: new Date('2024-09-01'),
        endDate: new Date('2024-12-15'),
        assignee: 'K. Martinez',
        status: 'active',
        hoursBilled: 140,
        hoursEstimated: 160,
        hoursBudgeted: 180,
        parentId: 'ORG_CLIENT_C',
        client: 'Client C',
        colorCode: 'ORANGE',
        depth: 1
      },
      {
        id: 'STORY_AUTH_SECURITY',
        category: 'story',
        name: 'Security Module',
        startDate: new Date('2024-10-01'),
        endDate: new Date('2024-11-30'),
        assignee: 'L. Brown',
        status: 'completed',
        hoursBilled: 80,
        hoursEstimated: 80,
        hoursBudgeted: 90,
        parentId: 'EPIC_API_PLATFORM',
        client: 'Client C',
        colorCode: 'GREEN',
        depth: 2
      },
      {
        id: 'STORY_UI_COMPONENTS',
        category: 'story',
        name: 'Component Library',
        startDate: new Date('2024-10-15'),
        endDate: new Date('2024-11-15'),
        assignee: null,
        status: 'in planning',
        hoursBilled: null,
        hoursEstimated: 40,
        hoursBudgeted: 50,
        parentId: 'EPIC_API_PLATFORM',
        client: 'Client C',
        colorCode: 'PURPLE',
        depth: 2
      },
      {
        id: 'EPIC_REPORTING_ENGINE',
        category: 'epic',
        name: 'Reporting Engine',
        startDate: new Date('2024-07-09'),
        endDate: new Date('2025-01-31'),
        assignee: 'A. Anderson',
        status: 'active',
        hoursBilled: 210,
        hoursEstimated: 230,
        hoursBudgeted: 250,
        parentId: 'ORG_CLIENT_C',
        client: 'Client C',
        colorCode: 'ORANGE',
        depth: 1
      },
      {
        id: 'DEAL_CLIENT_A_PHASE2',
        category: 'deal',
        name: 'Phase 2 Expansion',
        startDate: new Date('2024-12-01'),
        endDate: new Date('2025-01-15'),
        assignee: null,
        status: 'pipeline',
        hoursBilled: null,
        hoursEstimated: null,
        hoursBudgeted: null,
        parentId: 'ORG_CLIENT_A',
        client: 'Client A',
        colorCode: 'GRAY',
        depth: 1
      }
    ];

    projects.push(...sampleProjects);
    minDate = new Date('2024-07-01');
    maxDate = new Date('2025-02-01');
  }

  // Add 2 weeks padding and align to week boundaries
  // First, subtract 2 weeks from minDate
  const minWithPadding = new Date(minDate);
  minWithPadding.setDate(minWithPadding.getDate() - 14);

  // Find the start of the week (Sunday) for minDate
  const dayOfWeek = minWithPadding.getDay();
  minDate = new Date(minWithPadding);
  minDate.setDate(minDate.getDate() - dayOfWeek);

  // Add 2 weeks to maxDate
  const maxWithPadding = new Date(maxDate);
  maxWithPadding.setDate(maxWithPadding.getDate() + 14);

  // Find the end of the week (Saturday) for maxDate
  const daysUntilSaturday = 6 - maxWithPadding.getDay();
  maxDate = new Date(maxWithPadding);
  maxDate.setDate(maxDate.getDate() + daysUntilSaturday);

  // Build hierarchy from flat list
  const hierarchy = buildHierarchy(projects);

  // Flatten back for rendering with proper depths
  const flatProjects = flattenHierarchy(hierarchy);

  return {
    projects: hierarchy,
    flatProjects,
    minDate,
    maxDate
  };
}

function getCategoryOrder(category: string): number {
  return CATEGORY_ORDER[category.toLowerCase()] ?? 0;
}

function buildHierarchy(projects: Project[]): Project[] {
  const projectMap = new Map<string, Project>();

  projects.forEach(p => {
    projectMap.set(p.id, { ...p, children: [], isExpanded: true });
  });

  const roots: Project[] = [];

  projects.forEach(project => {
    const node = projectMap.get(project.id)!;

    if (!project.parentId) {
      roots.push(node);
    } else {
      const parent = projectMap.get(project.parentId);
      if (parent?.children) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  });

  return roots;
}

function flattenHierarchy(projects: Project[], depth: number = 0): Project[] {
  const result: Project[] = [];

  projects.forEach(project => {
    result.push({ ...project, depth });

    if (project.isExpanded && project.children?.length) {
      result.push(...flattenHierarchy(project.children, depth + 1));
    }
  });

  return result;
}

// ============================================================================
// EXPAND/COLLAPSE STATE MANAGEMENT
// ============================================================================

// Store expanded state by project ID (persists across re-renders)
const expandedState = new Map<string, boolean>();
let allExpandedState = true; // Track global expand/collapse state

function toggleExpanded(projectId: string): void {
  const current = expandedState.get(projectId);
  expandedState.set(projectId, current === undefined ? false : !current);
}

function isExpanded(projectId: string): boolean {
  const state = expandedState.get(projectId);
  return state === undefined ? true : state; // Default to expanded
}

function expandAll(projects: Project[]): void {
  projects.forEach(p => {
    expandedState.set(p.id, true);
    if (p.children?.length) {
      expandAll(p.children);
    }
  });
  allExpandedState = true;
}

function collapseAll(projects: Project[]): void {
  projects.forEach(p => {
    expandedState.set(p.id, false);
    if (p.children?.length) {
      collapseAll(p.children);
    }
  });
  allExpandedState = false;
}

function updateFlatProjects(state: ChartState): void {
  // Update isExpanded on all projects based on stored state
  const updateExpanded = (projects: Project[]) => {
    projects.forEach(p => {
      p.isExpanded = isExpanded(p.id);
      if (p.children?.length) {
        updateExpanded(p.children);
      }
    });
  };
  updateExpanded(state.projects);

  // Re-flatten the hierarchy
  state.flatProjects = flattenHierarchy(state.projects);
}

// ============================================================================
// MAIN RENDER FUNCTION
// ============================================================================

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
  const state = processData(data, slots, language);

  // Apply stored expanded state
  updateFlatProjects(state);

  // Store state for resize
  (container as any).__chartState = state;
  (container as any).__theme = theme;
  (container as any).__dimensions = { width, height };

  renderGanttChart(container, state, theme, width, height);
};

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
    renderGanttChart(container, state, theme, width, height);
  }
};

// ============================================================================
// GANTT CHART RENDERING
// ============================================================================

function renderGanttChart(
  container: HTMLElement,
  state: ChartState,
  theme: ThemeContext,
  width: number,
  height: number
): void {
  container.innerHTML = '';
  container.style.backgroundColor = theme.backgroundColor;
  container.style.fontFamily = theme.fontFamily;

  if (state.projects.length === 0) {
    renderEmptyState(container, theme);
    return;
  }

  // Create main container
  const mainContainer = document.createElement('div');
  mainContainer.className = `gantt-container${theme.isDark ? ' gantt-dark' : ''}`;
  container.appendChild(mainContainer);

  // Create header
  const header = document.createElement('div');
  header.className = 'gantt-header';
  header.style.color = theme.textColor;
  mainContainer.appendChild(header);

  const title = document.createElement('h2');
  title.className = 'gantt-title';
  title.textContent = 'Project Status Dashboard';
  header.appendChild(title);

  // Create content area
  const contentArea = document.createElement('div');
  contentArea.className = 'gantt-content';
  mainContainer.appendChild(contentArea);

  // Create left panel (project names)
  const leftPanel = document.createElement('div');
  leftPanel.className = 'gantt-left-panel';
  leftPanel.style.width = `${LEFT_PANEL_WIDTH}px`;
  contentArea.appendChild(leftPanel);

  // Create left panel header with expand/collapse toggle button
  const leftPanelHeader = document.createElement('div');
  leftPanelHeader.className = 'gantt-left-header';
  leftPanelHeader.style.height = `${TIMELINE_HEADER_HEIGHT}px`;
  leftPanelHeader.style.borderBottom = `2px solid ${getThemedColor('#E2E8F0', '#334155', theme.isDark)}`;
  leftPanelHeader.style.flexShrink = '0';
  leftPanelHeader.style.display = 'flex';
  leftPanelHeader.style.alignItems = 'flex-end';
  leftPanelHeader.style.justifyContent = 'flex-start';
  leftPanelHeader.style.padding = '0 0 4px 0';
  leftPanel.appendChild(leftPanelHeader);

  // Create toggle expand/collapse button
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'gantt-expand-collapse-btn';
  toggleBtn.title = allExpandedState ? 'Collapse all' : 'Expand all';
  toggleBtn.textContent = allExpandedState ? '▼' : '▶'; // down or right arrow
  toggleBtn.style.cssText = `
    background: ${getThemedColor('#F1F5F9', '#334155', theme.isDark)};
    border: 1px solid ${getThemedColor('#CBD5E1', '#475569', theme.isDark)};
    border-radius: 4px;
    padding: 0;
    width: 20px;
    height: 20px;
    cursor: pointer;
    font-size: 10px;
    color: ${theme.mainColor};
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  `;
  toggleBtn.addEventListener('mouseenter', () => {
    toggleBtn.style.background = getThemedColor('#E2E8F0', '#475569', theme.isDark);
  });
  toggleBtn.addEventListener('mouseleave', () => {
    toggleBtn.style.background = getThemedColor('#F1F5F9', '#334155', theme.isDark);
  });
  toggleBtn.addEventListener('click', () => {
    if (allExpandedState) {
      collapseAll(state.projects);
    } else {
      expandAll(state.projects);
    }
    updateFlatProjects(state);
    renderGanttChart(container, state, theme, width, height);
  });
  leftPanelHeader.appendChild(toggleBtn);

  // Create left panel body (scrollable project names)
  const leftPanelBody = document.createElement('div');
  leftPanelBody.className = 'gantt-left-body';
  leftPanelBody.style.flex = '1';
  leftPanelBody.style.overflowY = 'auto';
  leftPanelBody.style.overflowX = 'hidden';
  leftPanel.appendChild(leftPanelBody);

  // Create right panel (timeline)
  const rightPanel = document.createElement('div');
  rightPanel.className = 'gantt-right-panel';
  contentArea.appendChild(rightPanel);

  // Render timeline
  const timelineWidth = width - LEFT_PANEL_WIDTH - PADDING * 2;
  const timelineHeight = height - TIMELINE_HEADER_HEIGHT - PADDING * 2;

  renderTimeline(container, rightPanel, leftPanelBody, state, theme, timelineWidth, timelineHeight, width, height);
}

function renderTimeline(
  container: HTMLElement,
  rightPanel: HTMLElement,
  leftPanel: HTMLElement,
  state: ChartState,
  theme: ThemeContext,
  timelineWidth: number,
  timelineHeight: number,
  fullWidth: number,
  fullHeight: number
): void {
  const width = timelineWidth;
  const height = timelineHeight;
  // Create timeline header
  const timelineHeader = document.createElement('div');
  timelineHeader.className = 'timeline-header';
  timelineHeader.style.height = `${TIMELINE_HEADER_HEIGHT}px`;
  rightPanel.appendChild(timelineHeader);

  // Create timeline body container
  const timelineBody = document.createElement('div');
  timelineBody.className = 'timeline-body';
  rightPanel.appendChild(timelineBody);

  // Use flatProjects length for height calculation
  const projectCount = state.flatProjects ? state.flatProjects.length : state.projects.length;
  const svgHeight = projectCount * ROW_HEIGHT;

  // Calculate the full timeline width
  // Use pixels per day to determine width - 4 months = ~120 days visible in viewport
  const PIXELS_PER_DAY = width / 120; // Adjust this to control zoom level
  const totalDays = Math.ceil((state.maxDate.getTime() - state.minDate.getTime()) / (1000 * 60 * 60 * 24));
  const svgWidth = totalDays * PIXELS_PER_DAY;

  // Create SVG for timeline
  const svg = d3.select(timelineBody)
    .append('svg')
    .attr('width', svgWidth)
    .attr('height', svgHeight)
    .attr('class', 'timeline-svg');

  // Create time scale spanning the full width
  const xScale = d3.scaleTime()
    .domain([state.minDate, state.maxDate])
    .range([0, svgWidth]);

  // Render timeline header with months and weeks
  renderTimelineHeader(timelineHeader, xScale, svgWidth, theme);

  // Synchronize scroll between header and body
  timelineBody.addEventListener('scroll', () => {
    timelineHeader.scrollLeft = timelineBody.scrollLeft;
  });

  // Render project rows (pass container for re-render on expand/collapse)
  renderProjectRows(container, leftPanel, timelineBody, svg, state, xScale, theme, fullWidth, fullHeight);
}

function renderTimelineHeader(
  container: HTMLElement,
  xScale: d3.ScaleTime<number, number>,
  width: number,
  theme: ThemeContext
): void {
  const [minDate, maxDate] = xScale.domain();

  // Create SVG for header
  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', TIMELINE_HEADER_HEIGHT)
    .attr('class', 'timeline-header-svg');

  // Calculate months in range
  const months: Date[] = [];
  let currentDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);

  while (currentDate <= maxDate) {
    months.push(new Date(currentDate));
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  // Render month headers
  const monthFormat = d3.timeFormat('%b %Y');

  months.forEach((monthDate, index) => {
    const nextMonth = new Date(monthDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const x1 = Math.max(0, xScale(monthDate));
    const x2 = Math.min(width, xScale(nextMonth));
    const monthWidth = x2 - x1;

    if (monthWidth > 0) {
      svg.append('rect')
        .attr('x', x1)
        .attr('y', 0)
        .attr('width', monthWidth)
        .attr('height', 30)
        .attr('fill', index % 2 === 0
          ? getThemedColor('#F8FAFC', '#1E293B', theme.isDark)
          : getThemedColor('#F1F5F9', '#293548', theme.isDark))
        .attr('stroke', getThemedColor('#E2E8F0', '#334155', theme.isDark))
        .attr('stroke-width', 1);

      svg.append('text')
        .attr('x', x1 + monthWidth / 2)
        .attr('y', 20)
        .attr('text-anchor', 'middle')
        .attr('fill', theme.textColor)
        .attr('font-size', '12px')
        .attr('font-weight', '600')
        .text(monthFormat(monthDate));
    }
  });

  // Render week grid lines
  const weekFormat = d3.timeFormat('W%V');
  let weekDate = new Date(minDate);
  weekDate.setDate(weekDate.getDate() - weekDate.getDay() + 1); // Monday

  while (weekDate <= maxDate) {
    const x = xScale(weekDate);
    if (x >= 0 && x <= width) {
      svg.append('line')
        .attr('x1', x)
        .attr('y1', 30)
        .attr('x2', x)
        .attr('y2', TIMELINE_HEADER_HEIGHT)
        .attr('stroke', getThemedColor('#E2E8F0', '#334155', theme.isDark))
        .attr('stroke-width', 1);

      svg.append('text')
        .attr('x', x + 20)
        .attr('y', 50)
        .attr('text-anchor', 'middle')
        .attr('fill', theme.textColor)
        .attr('font-size', '10px')
        .attr('opacity', 0.6)
        .text(weekFormat(weekDate));
    }
    weekDate.setDate(weekDate.getDate() + 7);
  }
}

function renderProjectRows(
  container: HTMLElement,
  leftPanel: HTMLElement,
  timelineBody: HTMLElement,
  svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>,
  state: ChartState,
  xScale: d3.ScaleTime<number, number>,
  theme: ThemeContext,
  width: number,
  height: number
): void {
  const projectsToRender = state.flatProjects || state.projects;

  // Render left panel rows
  projectsToRender.forEach((project, index) => {
    const row = document.createElement('div');
    row.className = 'project-row';
    row.style.height = `${ROW_HEIGHT}px`;
    row.style.color = theme.textColor;

    // Style row based on category level for visual hierarchy
    const isTopLevel = project.depth === 0;
    if (isTopLevel) {
      row.style.backgroundColor = getThemedColor('#F8FAFC', '#1E293B', theme.isDark);
      row.style.borderTop = `1px solid ${getThemedColor('#CBD5E1', '#475569', theme.isDark)}`;
      row.style.borderBottom = `1px solid ${getThemedColor('#E2E8F0', '#334155', theme.isDark)}`;
    }

    // Create content wrapper with hierarchy indentation
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'project-row-content';
    contentWrapper.style.position = 'relative';
    contentWrapper.style.paddingLeft = `${project.depth * 20 + 8}px`;

    // Add expand/collapse indicator if project has children (positioned absolutely before the text)
    if (project.children && project.children.length > 0) {
      const expandIcon = document.createElement('span');
      expandIcon.className = 'expand-icon';
      expandIcon.textContent = project.isExpanded ? '▼' : '▶';
      expandIcon.style.cursor = 'pointer';
      expandIcon.style.color = theme.mainColor;
      expandIcon.style.position = 'absolute';
      expandIcon.style.left = `${project.depth * 20 - 8}px`;
      expandIcon.style.top = '50%';
      expandIcon.style.transform = 'translateY(-50%)';

      // Add click handler for expand/collapse
      expandIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleExpanded(project.id);
        updateFlatProjects(state);
        // Re-render the chart
        renderGanttChart(container, state, theme, width, height);
      });

      contentWrapper.appendChild(expandIcon);
    }

    // Project name container
    const nameContainer = document.createElement('div');
    nameContainer.className = 'project-name-container';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'project-name';
    nameSpan.textContent = project.name;
    nameSpan.style.fontWeight = isTopLevel ? '600' : '500';
    nameContainer.appendChild(nameSpan);

    contentWrapper.appendChild(nameContainer);

    // Metadata section (right side)
    const metaSection = document.createElement('div');
    metaSection.className = 'project-meta-section';

    // Client badge for top-level items only (show first)
    if (isTopLevel && project.client) {
      const clientBadge = document.createElement('span');
      clientBadge.className = 'client-badge';
      clientBadge.textContent = project.client;
      metaSection.appendChild(clientBadge);
    }

    // Category badge (show after client)
    const categoryBadge = document.createElement('span');
    categoryBadge.className = 'category-badge';
    categoryBadge.textContent = project.category.toUpperCase();
    categoryBadge.title = project.category;
    metaSection.appendChild(categoryBadge);

    contentWrapper.appendChild(metaSection);

    row.appendChild(contentWrapper);
    leftPanel.appendChild(row);
  });

  // Render grid lines FIRST (so they appear behind bars)
  const [minDate, maxDate] = xScale.domain();
  let weekDate = new Date(minDate);
  weekDate.setDate(weekDate.getDate() - weekDate.getDay() + 1);

  while (weekDate <= maxDate) {
    const x = xScale(weekDate);
    if (x >= 0 && x <= xScale.range()[1]) {
      svg.append('line')
        .attr('x1', x)
        .attr('y1', 0)
        .attr('x2', x)
        .attr('y2', projectsToRender.length * ROW_HEIGHT)
        .attr('stroke', getThemedColor('#E2E8F0', '#334155', theme.isDark))
        .attr('stroke-width', 1)
        .attr('opacity', 0.3);
    }
    weekDate.setDate(weekDate.getDate() + 7);
  }

  // Render timeline bars
  projectsToRender.forEach((project, index) => {
    const yPosition = index * ROW_HEIGHT + BAR_VERTICAL_PADDING;
    const isStory = project.category === 'story';

    // Create wrapper group for the bar - use SVG <a> element if link exists
    let barGroup;
    if (project.link) {
      barGroup = svg.append('a')
        .attr('href', project.link)
        .attr('target', '_blank')
        .attr('rel', 'noopener noreferrer')
        .append('g')
        .attr('class', 'bar-group')
        .attr('transform', `translate(0, ${yPosition})`)
        .style('cursor', 'pointer');
    } else {
      barGroup = svg.append('g')
        .attr('class', 'bar-group')
        .attr('transform', `translate(0, ${yPosition})`);
    }

    const x1 = xScale(project.startDate);
    const x2 = xScale(project.endDate);
    const barWidth = Math.max(x2 - x1, 20);
    const barColor = COLOR_MAP[project.colorCode] || COLOR_MAP.PURPLE;

    if (!isStory) {
      // Non-story rows (org, deal, epic): render a thin span line instead of a full bar
      const lineY = BAR_HEIGHT / 2;
      barGroup.append('line')
        .attr('x1', x1)
        .attr('y1', lineY)
        .attr('x2', x1 + barWidth)
        .attr('y2', lineY)
        .attr('stroke', barColor)
        .attr('stroke-width', 2)
        .attr('opacity', 0.5);
      // Small start/end markers
      barGroup.append('circle').attr('cx', x1).attr('cy', lineY).attr('r', 3).attr('fill', barColor).attr('opacity', 0.6);
      barGroup.append('circle').attr('cx', x1 + barWidth).attr('cy', lineY).attr('r', 3).attr('fill', barColor).attr('opacity', 0.6);
    } else {
      // Story rows: full bar
      // Background bar
      barGroup.append('rect')
        .attr('x', x1)
        .attr('y', 0)
        .attr('width', barWidth)
        .attr('height', BAR_HEIGHT)
        .attr('rx', 4)
        .attr('fill', barColor)
        .attr('opacity', 0.3);

      // Progress bar
      const progress = calculateProgress(project.hoursBilled, project.hoursBudgeted);
      if (progress > 0) {
        barGroup.append('rect')
          .attr('x', x1)
          .attr('y', 0)
          .attr('width', barWidth * progress)
          .attr('height', BAR_HEIGHT)
          .attr('rx', 4)
          .attr('fill', barColor);
      }
    }

    // Calculate available space and determine what to show
    const showLabels = isStory && barWidth >= MIN_BAR_WIDTH_FOR_LABELS;
    const showInitials = isStory && barWidth >= MIN_BAR_WIDTH_FOR_INITIALS;

    let currentX = x1 + 8;

    // Status indicator
    const statusColor = STATUS_COLORS[project.status.toLowerCase()] || STATUS_COLORS.active;
    if (showLabels || showInitials) {
      barGroup.append('circle')
        .attr('cx', currentX + 5)
        .attr('cy', BAR_HEIGHT / 2)
        .attr('r', 5)
        .attr('fill', statusColor)
        .attr('stroke', '#FFFFFF')
        .attr('stroke-width', 1.5);

      currentX += 18;
    }

    // Assignee initials (glass pill style)
    const initials = getInitials(project.assignee);
    if (initials && showInitials) {
      const pillWidth = 28;
      const pillHeight = 20;

      barGroup.append('rect')
        .attr('x', currentX)
        .attr('y', BAR_HEIGHT / 2 - pillHeight / 2)
        .attr('width', pillWidth)
        .attr('height', pillHeight)
        .attr('rx', pillHeight / 2)
        .attr('fill', '#FFFFFF')
        .attr('opacity', 0.6)
        .attr('stroke', 'rgba(255, 255, 255, 0.3)')
        .attr('stroke-width', 1);

      barGroup.append('text')
        .attr('x', currentX + pillWidth / 2)
        .attr('y', BAR_HEIGHT / 2 + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', barColor)
        .attr('font-size', '10px')
        .attr('font-weight', '700')
        .text(initials);

      currentX += pillWidth + 8;
    }

    // Hours display
    if (project.hoursBudgeted !== null && showLabels) {
      const hoursText = formatHoursDisplay(project.hoursBilled, project.hoursEstimated, project.hoursBudgeted);
      const badgePadding = 6;
      const badgeTextWidth = hoursText.length * 6;
      const badgeWidth = badgeTextWidth + badgePadding * 2;
      const badgeHeight = 18;

      if (currentX + badgeWidth < x1 + barWidth - 8) {
        barGroup.append('rect')
          .attr('x', currentX)
          .attr('y', BAR_HEIGHT / 2 - badgeHeight / 2)
          .attr('width', badgeWidth)
          .attr('height', badgeHeight)
          .attr('rx', 4)
          .attr('fill', '#FFFFFF')
          .attr('opacity', 0.5)
          .attr('stroke', 'rgba(0, 0, 0, 0.08)')
          .attr('stroke-width', 0.5);

        barGroup.append('text')
          .attr('x', currentX + badgeWidth / 2)
          .attr('y', BAR_HEIGHT / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', '#1E293B')
          .attr('font-size', '10px')
          .attr('font-weight', '600')
          .text(hoursText);

        currentX += badgeWidth + 8;
      }
    }

    // Percentage indicator at the end of the bar
    if (project.hoursBilled !== null && project.hoursBudgeted !== null && project.hoursBudgeted > 0) {
      const percentage = Math.round((project.hoursBilled / project.hoursBudgeted) * 100);
      const percentText = `${percentage}%`;
      const percentBadgeWidth = 36;
      const percentBadgeHeight = 20;
      const percentX = x2 - percentBadgeWidth - 6;

      if (percentX > x1 + 50) {
        barGroup.append('rect')
          .attr('x', percentX)
          .attr('y', BAR_HEIGHT / 2 - percentBadgeHeight / 2)
          .attr('width', percentBadgeWidth)
          .attr('height', percentBadgeHeight)
          .attr('rx', percentBadgeHeight / 2)
          .attr('fill', barColor)
          .attr('opacity', 0.6);

        barGroup.append('text')
          .attr('x', percentX + percentBadgeWidth / 2)
          .attr('y', BAR_HEIGHT / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', '#FFFFFF')
          .attr('font-size', '9px')
          .attr('font-weight', '600')
          .text(percentText);
      }
    }

    // End date label
    const dateFormat = d3.timeFormat('%b %d');
    barGroup.append('text')
      .attr('x', x2 + 8)
      .attr('y', BAR_HEIGHT / 2 + 4)
      .attr('fill', theme.textColor)
      .attr('font-size', '10px')
      .attr('font-weight', '500')
      .attr('opacity', 0.6)
      .text(dateFormat(project.endDate));


    // Tooltip and click handlers
    const hoursDisplayText = formatHoursDisplay(project.hoursBilled, project.hoursEstimated, project.hoursBudgeted);
    barGroup
      .on('mouseenter', function(event) {
        // Create tooltip
        const tooltip = d3.select(timelineBody)
          .append('div')
          .attr('class', 'gantt-tooltip')
          .style('position', 'absolute')
          .style('background', 'rgba(0, 0, 0, 0.9)')
          .style('color', 'white')
          .style('padding', '12px')
          .style('border-radius', '8px')
          .style('font-size', '12px')
          .style('pointer-events', 'none')
          .style('z-index', '1000')
          .style('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.3)');

        const tooltipContent = [
          `<div style="font-weight: 600; margin-bottom: 8px; font-size: 13px;">${project.name}</div>`,
          project.client ? `<div><strong>Client:</strong> ${project.client}</div>` : null,
          `<div><strong>Category:</strong> ${project.category}</div>`,
          `<div><strong>Status:</strong> ${project.status}</div>`,
          `<div><strong>Assignee:</strong> ${project.assignee || 'Unassigned'}</div>`,
          `<div><strong>Hours:</strong> ${hoursDisplayText}</div>`,
          `<div><strong>Duration:</strong> ${dateFormat(project.startDate)} - ${dateFormat(project.endDate)}</div>`
        ].filter(Boolean).join('');

        tooltip.html(tooltipContent);

        // Position tooltip
        const [mouseX, mouseY] = d3.pointer(event, timelineBody);
        tooltip
          .style('left', `${mouseX + 15}px`)
          .style('top', `${mouseY - 15}px`);
      })
      .on('mousemove', function(event) {
        const tooltip = d3.select(timelineBody).select('.gantt-tooltip');
        const [mouseX, mouseY] = d3.pointer(event, timelineBody);
        tooltip
          .style('left', `${mouseX + 15}px`)
          .style('top', `${mouseY - 15}px`);
      })
      .on('mouseleave', function() {
        d3.select(timelineBody).selectAll('.gantt-tooltip').remove();
      });
  });

  // Synchronize scroll
  leftPanel.addEventListener('scroll', () => {
    timelineBody.scrollTop = leftPanel.scrollTop;
  });

  timelineBody.addEventListener('scroll', () => {
    leftPanel.scrollTop = timelineBody.scrollTop;
  });
}

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
  title.textContent = 'No Project Data Available';
  emptyState.appendChild(title);

  const message = document.createElement('div');
  message.className = 'empty-state-message';
  message.textContent = 'Add project data to the required slots to display the Gantt chart.';
  emptyState.appendChild(message);

  container.appendChild(emptyState);
}

// ============================================================================
// QUERY BUILDING
// ============================================================================

function buildDimension(column: any): any {
  const dim: any = {
    dataset_id: column.datasetId || column.set,
    column_id: column.columnId || column.column,
  };
  // Only add level for columns that have it (categorical/datetime),
  // not for numeric columns used as dimensions
  if (column.level) {
    dim.level = column.level;
  }
  return dim;
}

export const buildQuery = ({
  slots = [],
  slotConfigurations = []
}: {
  slots: Slot[];
  slotConfigurations: SlotConfig[];
}): ItemQuery => {
  const dimensions: any[] = [];

  // Required dimensions: name, category, time (start), evolution (end)
  const requiredDimensions = ['name', 'category', 'time', 'evolution'];

  requiredDimensions.forEach(slotName => {
    const slot = slots.find(s => s.name === slotName);
    if (slot?.content && slot.content.length > 0) {
      dimensions.push(buildDimension(slot.content[0]));
    }
  });

  // Optional dimensions - includes numeric slots (measure, columns, size)
  // which are added as dimensions instead of measures so that:
  // 1. Rows with NULL values are still returned by the API
  // 2. No default aggregation is applied that would collapse/group rows
  const optionalDimensions = ['row', 'destination', 'identifier', 'dimension', 'color', 'levels', 'slidermetric', 'measure', 'columns', 'size'];

  optionalDimensions.forEach(slotName => {
    const slot = slots.find(s => s.name === slotName);
    if (slot?.content && slot.content.length > 0) {
      dimensions.push(buildDimension(slot.content[0]));
    }
  });

  // Only return query if we have at least the required dimensions
  if (dimensions.length < 4) {
    return {
      dimensions: [],
      measures: [],
      order: [],
      limit: { by: 10000, offset: 0 }
    };
  }

  return {
    dimensions,
    measures: [],
    order: [],
    limit: { by: 10000, offset: 0 }
  };
};
