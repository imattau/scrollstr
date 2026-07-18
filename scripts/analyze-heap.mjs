#!/usr/bin/env node
import { readFileSync } from 'fs'

const filePath = process.argv[2]
if (!filePath) { console.error('Usage: node analyze-heap.mjs <path.heapsnapshot>'); process.exit(1) }

const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
const snapshot = raw.snapshot
const nodes = raw.nodes   // flat array of ints
const edges = raw.edges   // flat array of ints
const strings = raw.strings

const SNODE_FIELDS = snapshot.meta.node_fields  // type, name, id, self_size, edge_count, detachedness
const SEDGE_FIELDS = snapshot.meta.edge_fields
const FIELD_INDEX = Object.fromEntries(SNODE_FIELDS.map((f, i) => [f, i]))
const FN = FIELD_INDEX

function getNode(idx) {
  const offset = idx * SNODE_FIELDS.length
  if (offset + SNODE_FIELDS.length > nodes.length) return null
  return {
    type: nodes[offset + FN.type],
    name: strings[nodes[offset + FN.name]],
    id: nodes[offset + FN.id],
    self_size: nodes[offset + FN.self_size],
    edge_count: nodes[offset + FN.edge_count],
    detachedness: nodes[offset + FN.detachedness],
    _offset: offset,
    _idx: idx,
  }
}

function edgesOf(node) {
  const result = []
  let offset = node._offset + SNODE_FIELDS.length  // edges start after node fields
  for (let i = 0; i < node.edge_count; i++) {
    const eOffset = offset + i * SEDGE_FIELDS.length
    result.push({
      type: edges[eOffset],
      name_or_index: edges[eOffset + 1],
      to_node: edges[eOffset + 2],
    })
  }
  return result
}

// Count by constructor name
const constructorCounts = {}
const constructorSizes = {}
let totalSelfSize = 0
let totalNodes = 0

for (let i = 0; i < nodes.length / SNODE_FIELDS.length; i++) {
  const n = getNode(i)
  if (!n) break
  totalNodes++
  totalSelfSize += n.self_size

  const name = n.name || '(unknown)'
  constructorCounts[name] = (constructorCounts[name] || 0) + 1
  constructorSizes[name] = (constructorSizes[name] || 0) + n.self_size
}

// ── Report ──
console.log('='.repeat(60))
console.log('HEAP SNAPSHOT ANALYSIS')
console.log(`File: ${filePath}`)
console.log(`Snapshot: ${snapshot.meta.node_count} nodes, ${Object.keys(raw.nodes).length ? 'inline' : 'flat'} format`)
console.log('='.repeat(60))
console.log(`\nTotal objects:   ${totalNodes.toLocaleString()}`)
console.log(`Total self size: ${(totalSelfSize / 1024 / 1024).toFixed(1)} MB`)

// Top memory consumers
console.log('\n── Top 30 by instance count ──')
const sortedByCount = Object.entries(constructorCounts)
  .filter(([name]) => !name.startsWith('system /'))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)
for (const [name, count] of sortedByCount) {
  const size = (constructorSizes[name] || 0) / 1024
  console.log(`  ${count.toString().padStart(7)}  ${name.padEnd(45)} ${size.toFixed(1)} KB`)
}

console.log('\n── Top 30 by retained size ──')
const sortedBySize = Object.entries(constructorSizes)
  .filter(([name]) => !name.startsWith('system /'))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)
for (const [name, size] of sortedBySize) {
  const count = constructorCounts[name] || 0
  console.log(`  ${(size / 1024 / 1024).toFixed(2).padStart(8)} MB  ${name.padEnd(45)} ${count} instances`)
}

// ── Graph-specific analysis ──
console.log('\n── PolyGraph-specific ──')
const graphTerms = ['Map', 'Set', 'PolyNode', 'PolyGraph', 'VectorIndex', 'PolyPersistence']
for (const term of graphTerms) {
  const entries = Object.entries(constructorCounts).filter(([name]) => name.includes(term))
  for (const [name, count] of entries) {
    const size = (constructorSizes[name] || 0) / 1024 / 1024
    console.log(`  ${count.toString().padStart(7)}  ${name.padEnd(50)} ${size.toFixed(2)} MB`)
  }
}

// ── Find detached nodes ──
console.log('\n── Detached DOM / graph nodes ──')
let detachedCount = 0
let detachedSize = 0
for (let i = 0; i < nodes.length / SNODE_FIELDS.length; i++) {
  const n = getNode(i)
  if (!n) break
  if (n.detachedness > 0) {
    detachedCount++
    detachedSize += n.self_size
    if (detachedCount <= 10) {
      console.log(`  detached: ${n.name} (size=${n.self_size}, kind=${n.type})`)
    }
  }
}
console.log(`  Total detached: ${detachedCount} nodes, ${(detachedSize / 1024).toFixed(1)} KB`)

// ── Large Map / Set objects ──
console.log('\n── Large Map/Set objects (self_size > 10KB) ──')
for (let i = 0; i < nodes.length / SNODE_FIELDS.length; i++) {
  const n = getNode(i)
  if (!n) continue
  const isMap = n.name === 'Map' || n.name === 'Set' || n.name === 'Object' || n.name === 'Array'
  if (isMap && n.self_size > 10000) {
    console.log(`  ${n.name.padEnd(20)} self_size=${(n.self_size / 1024).toFixed(1)} KB  nodeIdx=${i}`)
  }
}
