#!/usr/bin/env node
import { readFileSync } from 'fs';

function parseCsv(filepath) {
  const csv = readFileSync(filepath, 'utf-8');
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, ''));
  function parseLine(line) {
    const fields = []; let current = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { fields.push(current); current = ''; continue; }
      current += ch;
    }
    fields.push(current);
    return fields;
  }
  const rows = lines.slice(1).map(parseLine);
  return { header, rows, data: rows.map(r => { const o = {}; header.forEach((h, i) => o[h] = r[i] || null); return o; }) };
}

const orig = parseCsv('/Users/matt/Downloads/SAMPLE_ORIGINAL.csv');
const prod = parseCsv('/Users/matt/Downloads/SAMPLE_LUZMO_CC.csv');

console.log('COLUMN NAME COMPARISON');
console.log('='.repeat(60));
console.log(`Original (${orig.header.length} cols): ${orig.header.join(', ')}`);
console.log(`Production (${prod.header.length} cols): ${prod.header.join(', ')}`);

// Find renamed columns
const origSet = new Set(orig.header);
const prodSet = new Set(prod.header);
console.log('\nIn original but NOT in production:');
orig.header.filter(h => !prodSet.has(h)).forEach(h => console.log(`  - ${h}`));
console.log('\nIn production but NOT in original:');
prod.header.filter(h => !origSet.has(h)).forEach(h => console.log(`  + ${h}`));

// ID analysis
console.log('\n\nID FORMAT COMPARISON');
console.log('='.repeat(60));
console.log('Original IDs (all):');
orig.data.forEach(r => console.log(`  ${r.ID} [${r.CATEGORY}]`));
console.log('\nProduction ID samples (first 5 per category):');
const prodCats = {};
prod.data.forEach(r => { if (!prodCats[r.CATEGORY]) prodCats[r.CATEGORY] = []; prodCats[r.CATEGORY].push(r); });
Object.entries(prodCats).forEach(([cat, rows]) => {
  console.log(`  [${cat}]: ${rows.slice(0, 5).map(r => r.ID).join(', ')}${rows.length > 5 ? ` ... (${rows.length} total)` : ''}`);
});

// Hierarchy
console.log('\n\nHIERARCHY COMPARISON');
console.log('='.repeat(60));

// Original hierarchy
console.log('Original — all parent-child relationships:');
orig.data.filter(r => r.PARENT_ID && r.PARENT_ID !== 'NULL').forEach(r => {
  const parent = orig.data.find(p => p.ID === r.PARENT_ID);
  console.log(`  [${r.CATEGORY}] "${r[orig.header.includes('NAME') ? 'NAME' : 'ENTITY_NAME']}" → parent [${parent?.CATEGORY || '?'}] "${parent?.[orig.header.includes('NAME') ? 'NAME' : 'ENTITY_NAME'] || '?'}"`);
});

console.log('\nOriginal chain patterns:');
function traceOrig(row) {
  const chain = [row.CATEGORY];
  let cur = row;
  while (cur.PARENT_ID && cur.PARENT_ID !== 'NULL' && cur.PARENT_ID !== '') {
    const parent = orig.data.find(p => p.ID === cur.PARENT_ID);
    if (!parent) break;
    chain.push(parent.CATEGORY);
    cur = parent;
  }
  return chain.reverse().join(' → ');
}
const origChains = {};
orig.data.forEach(r => { const c = traceOrig(r); origChains[c] = (origChains[c] || 0) + 1; });
Object.entries(origChains).sort(([,a],[,b]) => b - a).forEach(([c, n]) => console.log(`  ${c}: ${n}`));

// Date completeness
console.log('\n\nDATE COMPLETENESS');
console.log('='.repeat(60));
const origDateCol = orig.header.includes('START_DATE') ? 'START_DATE' : 'START_DAY';
const origEndCol = orig.header.includes('END_DATE') ? 'END_DATE' : 'END_DAY';
const origMissing = orig.data.filter(r => !r[origDateCol] || !r[origEndCol] || r[origDateCol] === 'NULL' || r[origEndCol] === 'NULL');
console.log(`Original: ${origMissing.length}/${orig.data.length} rows missing dates`);
const prodMissing = prod.data.filter(r => !r.START_DAY || !r.END_DAY || r.START_DAY === '' || r.END_DAY === '');
console.log(`Production: ${prodMissing.length}/${prod.data.length} rows missing dates`);

// Status values
console.log('\n\nSTATUS VALUES');
console.log('='.repeat(60));
const origStatuses = new Set(orig.data.map(r => r.STATUS || r.ENTITY_STATUS));
const prodStatuses = new Set(prod.data.map(r => r.ENTITY_STATUS || r.STATUS));
console.log(`Original (${origStatuses.size}): ${[...origStatuses].join(', ')}`);
console.log(`Production (${prodStatuses.size}): ${[...prodStatuses].join(', ')}`);

// Color codes
console.log('\n\nCOLOR CODES');
console.log('='.repeat(60));
const origColors = new Set(orig.data.map(r => r.COLOR_CODE));
const prodColors = new Set(prod.data.map(r => r.COLOR_CODE));
console.log(`Original: ${[...origColors].join(', ')}`);
console.log(`Production: ${[...prodColors].join(', ')}`);
