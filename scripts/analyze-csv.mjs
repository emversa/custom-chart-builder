#!/usr/bin/env node
import { readFileSync } from 'fs';

const csv = readFileSync('/Users/matt/Downloads/SAMPLE_LUZMO_CC.csv', 'utf-8');
const lines = csv.trim().split('\n');
const header = lines[0].split(',').map(h => h.replace(/"/g, ''));

// Parse CSV (handles quoted fields with commas)
function parseLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { fields.push(current); current = ''; continue; }
    current += ch;
  }
  fields.push(current);
  return fields;
}

const rows = lines.slice(1).map(parseLine);
const data = rows.map(r => {
  const obj = {};
  header.forEach((h, i) => obj[h] = r[i] || null);
  return obj;
});

console.log(`${'='.repeat(80)}`);
console.log(`DATA DISCOVERY REPORT: SAMPLE_LUZMO_CC.csv`);
console.log(`${'='.repeat(80)}`);
console.log(`\nColumns: ${header.join(', ')}`);
console.log(`Total rows: ${data.length}`);

// ── CATEGORY ANALYSIS ──
console.log(`\n${'='.repeat(80)}`);
console.log('1. CATEGORY DISTRIBUTION');
console.log(`${'='.repeat(80)}\n`);

const catCounts = {};
data.forEach(r => { catCounts[r.CATEGORY || '(null)'] = (catCounts[r.CATEGORY || '(null)'] || 0) + 1; });
Object.entries(catCounts).sort(([,a],[,b]) => b - a).forEach(([cat, count]) => {
  console.log(`  ${cat.padEnd(20)} ${count} rows`);
});

// ── DATE ANALYSIS PER CATEGORY ──
console.log(`\n${'='.repeat(80)}`);
console.log('2. DATE COMPLETENESS BY CATEGORY');
console.log(`${'='.repeat(80)}\n`);

const catDateStats = {};
data.forEach(r => {
  const cat = r.CATEGORY || '(null)';
  if (!catDateStats[cat]) catDateStats[cat] = { total: 0, withBothDates: 0, noStart: 0, noEnd: 0, noBoth: 0, invalidRange: 0 };
  const s = catDateStats[cat];
  s.total++;
  const hasStart = r.START_DAY && r.START_DAY !== '' && r.START_DAY !== 'null';
  const hasEnd = r.END_DAY && r.END_DAY !== '' && r.END_DAY !== 'null';
  if (hasStart && hasEnd) {
    s.withBothDates++;
    if (new Date(r.START_DAY) > new Date(r.END_DAY)) s.invalidRange++;
  }
  else if (!hasStart && !hasEnd) s.noBoth++;
  else if (!hasStart) s.noStart++;
  else s.noEnd++;
});

console.log('Category             Total  Both Dates  No Start  No End  No Dates  Start>End');
console.log('-'.repeat(85));
Object.entries(catDateStats).sort(([a],[b]) => a.localeCompare(b)).forEach(([cat, s]) => {
  console.log(`${cat.padEnd(20)} ${String(s.total).padStart(6)}  ${String(s.withBothDates).padStart(10)}  ${String(s.noStart).padStart(8)}  ${String(s.noEnd).padStart(6)}  ${String(s.noBoth).padStart(8)}  ${String(s.invalidRange).padStart(9)}`);
});

// ── PARENT-CHILD RELATIONSHIP ANALYSIS ──
console.log(`\n${'='.repeat(80)}`);
console.log('3. PARENT-CHILD RELATIONSHIPS');
console.log(`${'='.repeat(80)}\n`);

// Build ID→row lookup
const idToRows = new Map();
data.forEach(r => {
  if (!r.ID) return;
  if (!idToRows.has(r.ID)) idToRows.set(r.ID, []);
  idToRows.get(r.ID).push(r);
});

const parentChildCombos = {};
let orphanCount = 0;
let noParentCount = 0;
let validParentCount = 0;
const orphanSamples = [];

data.forEach(r => {
  if (!r.PARENT_ID || r.PARENT_ID === '' || r.PARENT_ID === 'null') {
    noParentCount++;
    return;
  }
  const parents = idToRows.get(r.PARENT_ID);
  if (!parents || parents.length === 0) {
    orphanCount++;
    if (orphanSamples.length < 10) orphanSamples.push(r);
    return;
  }
  validParentCount++;
  parents.forEach(p => {
    const combo = `${r.CATEGORY} → ${p.CATEGORY}`;
    parentChildCombos[combo] = (parentChildCombos[combo] || 0) + 1;
  });
});

console.log('Child Category → Parent Category         Count');
console.log('-'.repeat(55));
Object.entries(parentChildCombos).sort(([,a],[,b]) => b - a).forEach(([combo, count]) => {
  console.log(`  ${combo.padEnd(40)} ${count}`);
});

console.log(`\n  Rows with no parent_id:          ${noParentCount}`);
console.log(`  Rows with valid parent:          ${validParentCount}`);
console.log(`  Orphans (parent_id not found):   ${orphanCount}`);

if (orphanSamples.length > 0) {
  console.log('\n  Sample orphans:');
  orphanSamples.forEach(r => {
    console.log(`    [${r.CATEGORY}] ID=${r.ID} PARENT_ID=${r.PARENT_ID} name="${r.ENTITY_NAME}"`);
  });
}

// ── ROOT-LEVEL ANALYSIS ──
console.log(`\n${'='.repeat(80)}`);
console.log('4. ROOT-LEVEL ENTITIES (no parent)');
console.log(`${'='.repeat(80)}\n`);

const roots = data.filter(r => !r.PARENT_ID || r.PARENT_ID === '' || r.PARENT_ID === 'null');
const rootByCat = {};
roots.forEach(r => { rootByCat[r.CATEGORY] = (rootByCat[r.CATEGORY] || 0) + 1; });
Object.entries(rootByCat).sort(([,a],[,b]) => b - a).forEach(([cat, count]) => {
  console.log(`  ${cat.padEnd(20)} ${count}`);
});

// ── HIERARCHY DEPTH ANALYSIS ──
console.log(`\n${'='.repeat(80)}`);
console.log('5. HIERARCHY DEPTH BY CATEGORY');
console.log(`${'='.repeat(80)}\n`);

function getDepth(row, visited = new Set()) {
  if (!row.PARENT_ID || row.PARENT_ID === '' || row.PARENT_ID === 'null') return 0;
  if (visited.has(row.ID + '_' + row.CATEGORY)) return 0;
  visited.add(row.ID + '_' + row.CATEGORY);
  const parents = idToRows.get(row.PARENT_ID);
  if (!parents || parents.length === 0) return 0;
  return 1 + getDepth(parents[0], visited);
}

const catDepths = {};
data.forEach(r => {
  const depth = getDepth(r);
  if (!catDepths[r.CATEGORY]) catDepths[r.CATEGORY] = {};
  catDepths[r.CATEGORY][depth] = (catDepths[r.CATEGORY][depth] || 0) + 1;
});

Object.entries(catDepths).forEach(([cat, depths]) => {
  const depthStr = Object.entries(depths).sort(([a],[b]) => Number(a) - Number(b)).map(([d,c]) => `depth ${d}: ${c}`).join(', ');
  console.log(`  ${cat.padEnd(20)} ${depthStr}`);
});

// ── ID COLLISION ANALYSIS ──
console.log(`\n${'='.repeat(80)}`);
console.log('6. ID COLLISIONS ACROSS CATEGORIES');
console.log(`${'='.repeat(80)}\n`);

const idCats = {};
data.forEach(r => {
  if (!r.ID) return;
  if (!idCats[r.ID]) idCats[r.ID] = new Set();
  idCats[r.ID].add(r.CATEGORY);
});

const collisions = Object.entries(idCats).filter(([,cats]) => cats.size > 1);
console.log(`  Unique IDs: ${Object.keys(idCats).length}`);
console.log(`  IDs in multiple categories: ${collisions.length}`);
if (collisions.length > 0) {
  console.log('\n  Samples (first 20):');
  collisions.slice(0, 20).forEach(([id, cats]) => {
    console.log(`    ID "${id}" → ${[...cats].join(', ')}`);
  });
}

// ── CLIENT vs ENTITY_NAME for organisations ──
console.log(`\n${'='.repeat(80)}`);
console.log('7. CLIENT vs ENTITY_NAME FOR ORGANISATION ROWS');
console.log(`${'='.repeat(80)}\n`);

const orgs = data.filter(r => r.CATEGORY?.toLowerCase() === 'organisation' || r.CATEGORY?.toLowerCase() === 'organization');
let nameClientMatch = 0, nameClientMismatch = 0;
const mismatchSamples = [];
orgs.forEach(r => {
  if (r.ENTITY_NAME === r.CLIENT) nameClientMatch++;
  else { nameClientMismatch++; if (mismatchSamples.length < 5) mismatchSamples.push(r); }
});
console.log(`  Organisation rows: ${orgs.length}`);
console.log(`  ENTITY_NAME === CLIENT: ${nameClientMatch}`);
console.log(`  ENTITY_NAME !== CLIENT: ${nameClientMismatch}`);
if (mismatchSamples.length > 0) {
  console.log('\n  Sample mismatches:');
  mismatchSamples.forEach(r => {
    console.log(`    ID=${r.ID}  name="${r.ENTITY_NAME}"  client="${r.CLIENT}"`);
  });
}

// Check if CLIENT is populated for non-org rows
console.log('\n  CLIENT field population by category:');
const clientByCat = {};
data.forEach(r => {
  const cat = r.CATEGORY || '(null)';
  if (!clientByCat[cat]) clientByCat[cat] = { hasClient: 0, noClient: 0 };
  if (r.CLIENT && r.CLIENT !== '' && r.CLIENT !== 'null') clientByCat[cat].hasClient++;
  else clientByCat[cat].noClient++;
});
Object.entries(clientByCat).forEach(([cat, s]) => {
  console.log(`    ${cat.padEnd(20)} has CLIENT: ${s.hasClient}, no CLIENT: ${s.noClient}`);
});

// ── COLOR CODE ANALYSIS ──
console.log(`\n${'='.repeat(80)}`);
console.log('8. COLOR_CODE DISTRIBUTION');
console.log(`${'='.repeat(80)}\n`);

const colorCounts = {};
data.forEach(r => { colorCounts[r.COLOR_CODE || '(null)'] = (colorCounts[r.COLOR_CODE || '(null)'] || 0) + 1; });
Object.entries(colorCounts).sort(([,a],[,b]) => b - a).forEach(([c, n]) => {
  console.log(`  ${c.padEnd(15)} ${n}`);
});

console.log('\n  Color by category:');
const colorByCat = {};
data.forEach(r => {
  const cat = r.CATEGORY || '(null)';
  if (!colorByCat[cat]) colorByCat[cat] = {};
  colorByCat[cat][r.COLOR_CODE || '(null)'] = (colorByCat[cat][r.COLOR_CODE || '(null)'] || 0) + 1;
});
Object.entries(colorByCat).forEach(([cat, colors]) => {
  const colorStr = Object.entries(colors).sort(([,a],[,b]) => b - a).map(([c,n]) => `${c}:${n}`).join(', ');
  console.log(`    ${cat.padEnd(20)} ${colorStr}`);
});

// ── ENTITY_STATUS ANALYSIS ──
console.log(`\n${'='.repeat(80)}`);
console.log('9. ENTITY_STATUS DISTRIBUTION');
console.log(`${'='.repeat(80)}\n`);

const statusCounts = {};
data.forEach(r => { statusCounts[r.ENTITY_STATUS || '(empty)'] = (statusCounts[r.ENTITY_STATUS || '(empty)'] || 0) + 1; });
Object.entries(statusCounts).sort(([,a],[,b]) => b - a).forEach(([s, n]) => {
  console.log(`  ${(s || '(empty)').padEnd(20)} ${n}`);
});

// ── HIERARCHY TREE SAMPLES ──
console.log(`\n${'='.repeat(80)}`);
console.log('10. HIERARCHY TREE SAMPLES (first 5 root orgs with full tree)');
console.log(`${'='.repeat(80)}\n`);

const orgRoots = orgs.filter(r => !r.PARENT_ID || r.PARENT_ID === '' || r.PARENT_ID === 'null').slice(0, 5);

function printTree(row, indent = 0, maxChildren = 5) {
  const prefix = '  '.repeat(indent) + (indent > 0 ? '├─ ' : '');
  const dateInfo = (row.START_DAY && row.END_DAY) ? `${row.START_DAY.substring(0,10)} → ${row.END_DAY.substring(0,10)}` : 'NO DATES';
  console.log(`${prefix}[${row.CATEGORY}] "${row.ENTITY_NAME}" (ID=${row.ID}) ${dateInfo}`);
  const children = data.filter(r => r.PARENT_ID === row.ID);
  // Group children by category for clarity
  const byCategory = {};
  children.forEach(c => {
    if (!byCategory[c.CATEGORY]) byCategory[c.CATEGORY] = [];
    byCategory[c.CATEGORY].push(c);
  });
  let shown = 0;
  for (const [cat, catChildren] of Object.entries(byCategory)) {
    catChildren.slice(0, maxChildren - shown).forEach(child => {
      printTree(child, indent + 1, 3);
      shown++;
    });
    if (catChildren.length > maxChildren - shown + catChildren.slice(0, maxChildren - shown).length) {
      console.log(`${'  '.repeat(indent + 1)}├─ ... and ${catChildren.length - (maxChildren - shown)} more ${cat} children`);
    }
  }
}

orgRoots.forEach(root => {
  printTree(root, 0, 4);
  console.log('');
});

// ── HOURS ANALYSIS ──
console.log(`\n${'='.repeat(80)}`);
console.log('11. HOURS FIELDS ANALYSIS');
console.log(`${'='.repeat(80)}\n`);

const hoursCats = {};
data.forEach(r => {
  const cat = r.CATEGORY || '(null)';
  if (!hoursCats[cat]) hoursCats[cat] = { total: 0, hasBilled: 0, hasEstimated: 0, hasBudgeted: 0, allZero: 0 };
  const s = hoursCats[cat];
  s.total++;
  const billed = parseFloat(r.HOURS_BILLED);
  const estimated = parseFloat(r.HOURS_ESTIMATED);
  const budgeted = parseFloat(r.HOURS_BUDGETED);
  if (!isNaN(billed) && billed !== 0) s.hasBilled++;
  if (!isNaN(estimated) && estimated !== 0) s.hasEstimated++;
  if (!isNaN(budgeted) && budgeted !== 0) s.hasBudgeted++;
  if (billed === 0 && estimated === 0 && budgeted === 0) s.allZero++;
});

console.log('Category             Total  Has Billed  Has Estimated  Has Budgeted  All Zero');
console.log('-'.repeat(80));
Object.entries(hoursCats).sort(([a],[b]) => a.localeCompare(b)).forEach(([cat, s]) => {
  console.log(`${cat.padEnd(20)} ${String(s.total).padStart(6)}  ${String(s.hasBilled).padStart(10)}  ${String(s.hasEstimated).padStart(13)}  ${String(s.hasBudgeted).padStart(12)}  ${String(s.allZero).padStart(8)}`);
});

// ── VERIFY ASSUMED HIERARCHY: organisation → deal → epic → story ──
console.log(`\n${'='.repeat(80)}`);
console.log('12. HIERARCHY CHAIN VERIFICATION');
console.log(`    Testing: organisation → deal → epic → story`);
console.log(`${'='.repeat(80)}\n`);

// For each story, trace up to root and record the chain
function traceChain(row, maxDepth = 10) {
  const chain = [row.CATEGORY];
  let current = row;
  let depth = 0;
  while (current.PARENT_ID && current.PARENT_ID !== '' && current.PARENT_ID !== 'null' && depth < maxDepth) {
    const parents = idToRows.get(current.PARENT_ID);
    if (!parents || parents.length === 0) { chain.push('(orphan)'); break; }
    current = parents[0];
    chain.push(current.CATEGORY);
    depth++;
  }
  return chain.reverse();
}

const chainCounts = {};
data.forEach(r => {
  const chain = traceChain(r);
  const key = chain.join(' → ');
  chainCounts[key] = (chainCounts[key] || 0) + 1;
});

console.log('Full hierarchy chains found:');
console.log('-'.repeat(70));
Object.entries(chainCounts).sort(([,a],[,b]) => b - a).forEach(([chain, count]) => {
  console.log(`  ${chain.padEnd(55)} ${count} rows`);
});
