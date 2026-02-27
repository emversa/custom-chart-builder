#!/usr/bin/env node
/**
 * Data Discovery Script
 * Queries a Luzmo dataset and produces a full analysis of the hierarchy,
 * categories, parent-child relationships, and data quality.
 *
 * Usage:
 *   node scripts/data-discovery.mjs --key <API_KEY> --token <API_TOKEN> --dataset <DATASET_ID> [--api-url <URL>]
 *
 * If --dataset is omitted, lists all available datasets.
 */

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const API_KEY = getArg('key');
const API_TOKEN = getArg('token');
const DATASET_ID = getArg('dataset');
const API_URL = getArg('api-url') || 'https://api.luzmo.com';

if (!API_KEY || !API_TOKEN) {
  console.error('Usage: node scripts/data-discovery.mjs --key <KEY> --token <TOKEN> [--dataset <ID>] [--api-url <URL>]');
  console.error('\nTo get your key and token:');
  console.error('  1. Log into the builder at http://localhost:4200');
  console.error('  2. Open browser DevTools → Application → Cookies → localhost');
  console.error('  3. Copy the values of cookies "k" (key) and "t" (token)');
  process.exit(1);
}

async function apiCall(endpoint, body) {
  const res = await fetch(`${API_URL}/0.1.0/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'get',
      version: '0.1.0',
      key: API_KEY,
      token: API_TOKEN,
      ...body
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── List datasets ──────────────────────────────────────────────────
async function listDatasets() {
  const result = await apiCall('securable', {
    find: {
      attributes: ['id', 'name', 'created_at', 'subtype'],
      where: { type: 'dataset', is_variant: false },
      order: [['created_at', 'desc']],
      options: { public: false }
    }
  });
  return result.rows || [];
}

// ── Get dataset columns ────────────────────────────────────────────
async function getColumns(datasetId) {
  const result = await apiCall('securable', {
    find: {
      attributes: ['id', 'name'],
      where: { id: datasetId },
      include: [{
        model: 'Column',
        attributes: ['id', 'name', 'type', 'subtype', 'format', 'lowestLevel', 'level'],
        separate: true,
        order: [['order', 'asc']]
      }]
    }
  });
  return result.rows?.[0] || null;
}

// ── Query data ─────────────────────────────────────────────────────
async function queryData(datasetId, columnIds) {
  const dimensions = columnIds.map(colId => ({
    dataset_id: datasetId,
    column_id: colId
  }));

  const result = await apiCall('data', {
    find: {
      queries: [{
        dimensions,
        measures: [],
        order: [],
        limit: { by: 10000, offset: 0 },
        options: { locale_id: 'en', timezone_id: 'UTC' }
      }]
    }
  });
  return result;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  // Step 1: If no dataset specified, list all
  if (!DATASET_ID) {
    console.log('No --dataset specified. Listing all datasets:\n');
    const datasets = await listDatasets();
    if (datasets.length === 0) {
      console.log('No datasets found. Check your API key/token.');
      return;
    }
    datasets.forEach(ds => {
      console.log(`  ${ds.id}  ${ds.name?.en || ds.name || '(unnamed)'}  [${ds.subtype || 'dataset'}]  created: ${ds.created_at}`);
    });
    console.log(`\nTotal: ${datasets.length} datasets`);
    console.log('\nRe-run with --dataset <ID> to analyze a specific dataset.');
    return;
  }

  // Step 2: Get columns
  console.log(`\n${'='.repeat(80)}`);
  console.log(`DATASET DISCOVERY: ${DATASET_ID}`);
  console.log(`${'='.repeat(80)}\n`);

  const dataset = await getColumns(DATASET_ID);
  if (!dataset) {
    console.error('Dataset not found. Check the ID.');
    return;
  }

  console.log(`Dataset: ${dataset.name?.en || dataset.name || '(unnamed)'}`);
  console.log(`\n── COLUMNS (${dataset.columns.length}) ──\n`);

  const columns = dataset.columns;
  columns.forEach(col => {
    const name = col.name?.en || col.name || '(unnamed)';
    console.log(`  ${col.id}  ${name.padEnd(30)} type=${col.type}  subtype=${col.subtype || '-'}  level=${col.level || '-'}`);
  });

  // Step 3: Query ALL columns as dimensions to see raw data
  const allColumnIds = columns.map(c => c.id);
  console.log(`\n── QUERYING DATA (all ${allColumnIds.length} columns as dimensions, limit 10000) ──\n`);

  const result = await queryData(DATASET_ID, allColumnIds);

  if (result.error) {
    console.error('Query error:', result.error);
    return;
  }

  const rows = result.data || [];
  console.log(`Total rows returned: ${rows.length}`);

  if (rows.length === 0) {
    console.log('No data returned.');
    return;
  }

  // Build column name map
  const colNameMap = {};
  columns.forEach((col, i) => {
    colNameMap[i] = (col.name?.en || col.name || `col_${i}`).toLowerCase().replace(/\s+/g, '_');
  });

  // Find key columns by name pattern
  function findColIndex(patterns) {
    for (const pattern of patterns) {
      const idx = columns.findIndex(c => {
        const name = (c.name?.en || c.name || '').toLowerCase();
        return name.includes(pattern);
      });
      if (idx !== -1) return idx;
    }
    return -1;
  }

  const idIdx = findColIndex(['id', 'identifier']);
  const categoryIdx = findColIndex(['category', 'type', 'entity_type']);
  const nameIdx = findColIndex(['entity_name', 'name', 'title']);
  const parentIdx = findColIndex(['parent_id', 'parent', 'parentid']);
  const clientIdx = findColIndex(['client']);
  const startDateIdx = findColIndex(['start_date', 'start', 'begin']);
  const endDateIdx = findColIndex(['end_date', 'end', 'finish', 'due']);
  const colorIdx = findColIndex(['color', 'colour']);

  console.log(`\n── COLUMN INDEX MAPPING ──\n`);
  console.log(`  ID column:         index=${idIdx} (${idIdx >= 0 ? colNameMap[idIdx] : 'NOT FOUND'})`);
  console.log(`  Category column:   index=${categoryIdx} (${categoryIdx >= 0 ? colNameMap[categoryIdx] : 'NOT FOUND'})`);
  console.log(`  Name column:       index=${nameIdx} (${nameIdx >= 0 ? colNameMap[nameIdx] : 'NOT FOUND'})`);
  console.log(`  Parent ID column:  index=${parentIdx} (${parentIdx >= 0 ? colNameMap[parentIdx] : 'NOT FOUND'})`);
  console.log(`  Client column:     index=${clientIdx} (${clientIdx >= 0 ? colNameMap[clientIdx] : 'NOT FOUND'})`);
  console.log(`  Start date column: index=${startDateIdx} (${startDateIdx >= 0 ? colNameMap[startDateIdx] : 'NOT FOUND'})`);
  console.log(`  End date column:   index=${endDateIdx} (${endDateIdx >= 0 ? colNameMap[endDateIdx] : 'NOT FOUND'})`);
  console.log(`  Color column:      index=${colorIdx} (${colorIdx >= 0 ? colNameMap[colorIdx] : 'NOT FOUND'})`);

  // ── Extract cell values ──
  function val(row, idx) {
    if (idx < 0 || idx >= row.length) return null;
    const cell = row[idx];
    if (cell === null || cell === undefined) return null;
    if (typeof cell === 'object' && 'id' in cell) return cell.id;
    return cell;
  }

  function strVal(row, idx) {
    const v = val(row, idx);
    return v !== null && v !== undefined ? String(v) : null;
  }

  // ── CATEGORY ANALYSIS ──
  console.log(`\n${'='.repeat(80)}`);
  console.log('CATEGORY ANALYSIS');
  console.log(`${'='.repeat(80)}\n`);

  if (categoryIdx < 0) {
    console.log('WARNING: No category column found. Cannot analyze hierarchy.');
  } else {
    const categoryCounts = {};
    const categoryDateStats = {};
    const categoryNullParents = {};
    const categoryWithParents = {};

    rows.forEach(row => {
      const cat = strVal(row, categoryIdx) || '(null)';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

      // Date stats
      if (!categoryDateStats[cat]) categoryDateStats[cat] = { withDates: 0, withoutDates: 0 };
      const start = val(row, startDateIdx);
      const end = val(row, endDateIdx);
      if (start && end) {
        categoryDateStats[cat].withDates++;
      } else {
        categoryDateStats[cat].withoutDates++;
      }

      // Parent stats
      const parentId = strVal(row, parentIdx);
      if (!parentId || parentId === 'null' || parentId === '') {
        categoryNullParents[cat] = (categoryNullParents[cat] || 0) + 1;
      } else {
        categoryWithParents[cat] = (categoryWithParents[cat] || 0) + 1;
      }
    });

    console.log('Category           Count    With Dates   No Dates   Has Parent   No Parent');
    console.log('-'.repeat(80));
    Object.keys(categoryCounts).sort().forEach(cat => {
      const count = categoryCounts[cat];
      const ds = categoryDateStats[cat] || { withDates: 0, withoutDates: 0 };
      const wp = categoryWithParents[cat] || 0;
      const np = categoryNullParents[cat] || 0;
      console.log(
        `${cat.padEnd(20)} ${String(count).padStart(5)}    ${String(ds.withDates).padStart(10)}   ${String(ds.withoutDates).padStart(8)}   ${String(wp).padStart(10)}   ${String(np).padStart(9)}`
      );
    });
    console.log(`${'Total'.padEnd(20)} ${String(rows.length).padStart(5)}`);
  }

  // ── ID COLLISION ANALYSIS ──
  console.log(`\n${'='.repeat(80)}`);
  console.log('ID COLLISION ANALYSIS');
  console.log(`${'='.repeat(80)}\n`);

  if (idIdx >= 0) {
    const idToCategories = {};
    rows.forEach(row => {
      const id = strVal(row, idIdx);
      const cat = strVal(row, categoryIdx) || '(null)';
      if (id) {
        if (!idToCategories[id]) idToCategories[id] = new Set();
        idToCategories[id].add(cat);
      }
    });

    const collisions = Object.entries(idToCategories).filter(([, cats]) => cats.size > 1);
    console.log(`Unique IDs: ${Object.keys(idToCategories).length}`);
    console.log(`IDs appearing in multiple categories: ${collisions.length}`);
    if (collisions.length > 0) {
      console.log('\nSample collisions (first 20):');
      collisions.slice(0, 20).forEach(([id, cats]) => {
        console.log(`  ID "${id}" → categories: ${[...cats].join(', ')}`);
      });
    }
  }

  // ── HIERARCHY / PARENT-CHILD ANALYSIS ──
  console.log(`\n${'='.repeat(80)}`);
  console.log('HIERARCHY ANALYSIS');
  console.log(`${'='.repeat(80)}\n`);

  if (idIdx >= 0 && parentIdx >= 0 && categoryIdx >= 0) {
    // Build maps: id+category → row data
    const entities = [];
    rows.forEach(row => {
      entities.push({
        id: strVal(row, idIdx),
        category: strVal(row, categoryIdx),
        name: strVal(row, nameIdx),
        parentId: strVal(row, parentIdx),
        client: strVal(row, clientIdx),
        hasStart: !!val(row, startDateIdx),
        hasEnd: !!val(row, endDateIdx)
      });
    });

    // Build a set of all known IDs
    const allIds = new Set(entities.map(e => e.id).filter(Boolean));

    // Analyze parent references
    const parentCategoryCombos = {};
    let orphanCount = 0;
    let validParentCount = 0;
    let noParentCount = 0;

    entities.forEach(e => {
      if (!e.parentId || e.parentId === 'null' || e.parentId === '') {
        noParentCount++;
        return;
      }

      // Find what category the parent belongs to
      const parentEntities = entities.filter(p => p.id === e.parentId);
      if (parentEntities.length === 0) {
        orphanCount++;
        return;
      }

      validParentCount++;
      parentEntities.forEach(pe => {
        const combo = `${e.category} → ${pe.category}`;
        parentCategoryCombos[combo] = (parentCategoryCombos[combo] || 0) + 1;
      });
    });

    console.log('Parent-child relationship patterns (child_category → parent_category):');
    console.log('-'.repeat(60));
    Object.entries(parentCategoryCombos)
      .sort(([, a], [, b]) => b - a)
      .forEach(([combo, count]) => {
        console.log(`  ${combo.padEnd(40)} ${count} rows`);
      });

    console.log(`\nRows with no parent:       ${noParentCount}`);
    console.log(`Rows with valid parent:    ${validParentCount}`);
    console.log(`Orphans (parent ID not found): ${orphanCount}`);

    // ── VERIFY HIERARCHY DEPTH ──
    console.log(`\n── INFERRED HIERARCHY ──\n`);

    // Find roots (no parent)
    const roots = entities.filter(e => !e.parentId || e.parentId === 'null' || e.parentId === '');
    const rootCategories = {};
    roots.forEach(e => {
      rootCategories[e.category] = (rootCategories[e.category] || 0) + 1;
    });
    console.log('Root-level categories (no parent):');
    Object.entries(rootCategories).sort(([, a], [, b]) => b - a).forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count}`);
    });

    // Walk the tree to determine actual depths
    const idToEntity = new Map();
    entities.forEach(e => {
      // If duplicate IDs, keep all (grouped by category)
      const key = `${e.category}_${e.id}`;
      idToEntity.set(key, e);
    });

    // Also build raw ID lookup for parent resolution
    const rawIdLookup = new Map();
    entities.forEach(e => {
      if (!rawIdLookup.has(e.id)) rawIdLookup.set(e.id, []);
      rawIdLookup.get(e.id).push(e);
    });

    function getDepth(entity, visited = new Set()) {
      if (!entity.parentId || entity.parentId === 'null' || entity.parentId === '') return 0;
      if (visited.has(entity.id)) return 0; // circular
      visited.add(entity.id);
      const parents = rawIdLookup.get(entity.parentId) || [];
      if (parents.length === 0) return 0;
      return 1 + getDepth(parents[0], visited);
    }

    const categoryDepths = {};
    entities.forEach(e => {
      const depth = getDepth(e);
      if (!categoryDepths[e.category]) categoryDepths[e.category] = {};
      categoryDepths[e.category][depth] = (categoryDepths[e.category][depth] || 0) + 1;
    });

    console.log('\nCategory depth distribution:');
    console.log('-'.repeat(60));
    Object.entries(categoryDepths).forEach(([cat, depths]) => {
      const depthStr = Object.entries(depths)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([d, c]) => `depth ${d}: ${c}`)
        .join(', ');
      console.log(`  ${cat.padEnd(20)} ${depthStr}`);
    });

    // ── CLIENT vs ENTITY_NAME check ──
    console.log(`\n── CLIENT / ENTITY_NAME RELATIONSHIP ──\n`);
    if (nameIdx >= 0 && clientIdx >= 0 && categoryIdx >= 0) {
      const orgEntities = entities.filter(e => e.category?.toLowerCase() === 'organisation' || e.category?.toLowerCase() === 'organization');
      let matchCount = 0;
      let mismatchCount = 0;
      const mismatches = [];

      orgEntities.forEach(e => {
        if (e.name === e.client) {
          matchCount++;
        } else {
          mismatchCount++;
          if (mismatches.length < 10) {
            mismatches.push({ id: e.id, name: e.name, client: e.client });
          }
        }
      });

      console.log(`Organisation rows where entity_name === client: ${matchCount}`);
      console.log(`Organisation rows where entity_name !== client: ${mismatchCount}`);
      if (mismatches.length > 0) {
        console.log('Sample mismatches:');
        mismatches.forEach(m => {
          console.log(`  ID=${m.id}  name="${m.name}"  client="${m.client}"`);
        });
      }
    }

    // ── COLOR CODE ANALYSIS ──
    console.log(`\n── COLOR CODE DISTRIBUTION ──\n`);
    if (colorIdx >= 0) {
      const colorCounts = {};
      const colorByCategory = {};
      rows.forEach(row => {
        const color = strVal(row, colorIdx) || '(null)';
        const cat = strVal(row, categoryIdx) || '(null)';
        colorCounts[color] = (colorCounts[color] || 0) + 1;
        if (!colorByCategory[cat]) colorByCategory[cat] = {};
        colorByCategory[cat][color] = (colorByCategory[cat][color] || 0) + 1;
      });

      console.log('Overall color distribution:');
      Object.entries(colorCounts).sort(([, a], [, b]) => b - a).forEach(([color, count]) => {
        console.log(`  ${color.padEnd(15)} ${count}`);
      });

      console.log('\nColor by category:');
      Object.entries(colorByCategory).forEach(([cat, colors]) => {
        const colorStr = Object.entries(colors).sort(([, a], [, b]) => b - a).map(([c, n]) => `${c}:${n}`).join(', ');
        console.log(`  ${cat.padEnd(20)} ${colorStr}`);
      });
    }

    // ── SAMPLE ROWS PER CATEGORY ──
    console.log(`\n── SAMPLE ROWS (first 3 per category) ──\n`);
    const categories = [...new Set(entities.map(e => e.category))];
    categories.forEach(cat => {
      const samples = entities.filter(e => e.category === cat).slice(0, 3);
      console.log(`[${cat}]`);
      samples.forEach(s => {
        console.log(`  ID=${s.id}  name="${s.name}"  parentId=${s.parentId || '(none)'}  client=${s.client || '(none)'}  dates=${s.hasStart && s.hasEnd ? 'yes' : 'NO'}`);
      });
      console.log('');
    });

    // ── FULL HIERARCHY TREE SAMPLE ──
    console.log(`\n── HIERARCHY TREE SAMPLE (first 3 root entities with children) ──\n`);
    const rootEntities = entities.filter(e => !e.parentId || e.parentId === 'null' || e.parentId === '');
    const sampleRoots = rootEntities.slice(0, 3);

    function printTree(entity, indent = 0) {
      const prefix = '  '.repeat(indent) + (indent > 0 ? '├─ ' : '');
      console.log(`${prefix}[${entity.category}] "${entity.name}" (ID=${entity.id}, dates=${entity.hasStart && entity.hasEnd ? 'yes' : 'NO'})`);
      const children = entities.filter(e => e.parentId === entity.id);
      children.slice(0, 5).forEach(child => printTree(child, indent + 1));
      if (children.length > 5) {
        console.log(`${'  '.repeat(indent + 1)}├─ ... and ${children.length - 5} more children`);
      }
    }

    sampleRoots.forEach(root => {
      printTree(root);
      console.log('');
    });
  }

  // ── Print all column names and first row as reference ──
  console.log(`\n── RAW FIRST ROW (for column verification) ──\n`);
  if (rows.length > 0) {
    columns.forEach((col, i) => {
      const name = col.name?.en || col.name || `col_${i}`;
      const cellVal = rows[0][i];
      const display = cellVal !== null && cellVal !== undefined
        ? (typeof cellVal === 'object' ? JSON.stringify(cellVal) : String(cellVal))
        : '(null)';
      console.log(`  [${i}] ${name.padEnd(30)} = ${display}`);
    });
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
