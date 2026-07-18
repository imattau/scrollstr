#!/usr/bin/env node

/**
 * Scrollstr Memory Profiler
 *
 * Launches the app, scrolls through the video feed, and samples JS heap /
 * DOM node counts at regular intervals.
 *
 * Usage:
 *   node scripts/memory-profile.mjs                           # headless
 *   node scripts/memory-profile.mjs --visible                 # visible browser (debug)
 *   node scripts/memory-profile.mjs --url=http://localhost:5173  # attach to running app
 *   node scripts/memory-profile.mjs --scrolls=100 --sample=10   # custom params
 */

import puppeteer from 'puppeteer'
import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DEV_PORT = 5173

const args = process.argv.slice(2)
const TARGET_URL        = _flag('--url')
const VISIBLE           = args.includes('--visible')
const TOTAL_SCROLLS     = parseInt(_flag('--scrolls') || '50', 10)
const SAMPLE_INTERVAL   = parseInt(_flag('--sample') || '5', 10)

const NAV_TIMEOUT       = 40000
const SCROLL_DELAY      = 1500

function _flag(name) {
  const a = args.find(a => a.startsWith(`${name}=`))
  return a ? a.split('=')[1] : null
}

// ── Dev server ──────────────────────────────────────────────────────

function startDevServer() {
  return new Promise((resolve_, reject) => {
    const proc = spawn('npx', ['vite', '--port', String(DEV_PORT)], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: true,
    })
    let started = false
    const timeout = setTimeout(() => {
      if (!started) { proc.kill(); reject(new Error('Dev server timed out')) }
    }, NAV_TIMEOUT)
    proc.stdout.on('data', (data) => {
      process.stdout.write(`[vite] ${data}`)
      if (!started && data.toString().includes('Local:')) {
        started = true; clearTimeout(timeout); resolve_(proc)
      }
    })
    proc.stderr.on('data', (data) => process.stderr.write(`[vite:err] ${data}`))
    proc.on('exit', (code) => { if (!started) reject(new Error(`Vite exited (${code})`)) })
  })
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  let devServer = null
  let url = TARGET_URL

  if (!url) {
    console.log('Starting Vite dev server...')
    devServer = await startDevServer()
    url = `http://localhost:${DEV_PORT}`
    await sleep(1500)
  }

  console.log(`Launching browser → ${url} (${VISIBLE ? 'visible' : 'headless'})`)
  const browser = await puppeteer.launch({
    headless: VISIBLE ? false : true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-precise-memory-info',
    ],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 480, height: 900 })

  // Suppress expected CORS / font CSP errors (spammy)
  const suppressed = [
    'fonts.googleapis.com',
    'Access-Control-Allow-Origin',
    'the server responded with a status of 403',
    'net::ERR_FAILED',
    'net::ERR_CONTENT_LENGTH_MISMATCH',
    'Failed to load resource',
  ]
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (suppressed.some(s => text.includes(s))) return
    console.log(`[browser] ${msg.type()}: ${text}`)
  })

  console.log('Navigating...')
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
  console.log('Page loaded. Waiting for feed...')

  try {
    await page.waitForSelector('.media-stack-viewport', { timeout: 25000 })
    console.log('MediaStack viewport found')
  } catch {
    const html = await page.evaluate(() => document.body.innerHTML.substring(0, 600))
    console.log('Viewport not found. Partial body:', html)
  }

  await sleep(6000) // initial data fetch / render

  async function sampleMemory(label) {
    const mem = await page.evaluate(() => {
      const m = (performance).memory
      return {
        jsHeapUsed: m ? m.usedJSHeapSize : 0,
        jsHeapTotal: m ? m.jsHeapSizeLimit : 0,
        domNodes: document.querySelectorAll('*').length,
      }
    })
    return {
      label,
      timestamp: Date.now(),
      jsHeapUsedMB: +(mem.jsHeapUsed / 1e6).toFixed(2),
      jsHeapTotalMB: +(mem.jsHeapTotal / 1e6).toFixed(2),
      domNodes: mem.domNodes,
    }
  }

  // ── Baseline ──
  const samples = []
  const baseline = await sampleMemory('baseline')
  samples.push(baseline)
  console.log(`[baseline]  JS heap: ${baseline.jsHeapUsedMB} MB  DOM: ${baseline.domNodes} nodes`)

  // ── Scroll feed ──
  console.log(`\nScrolling ${TOTAL_SCROLLS} videos (sample every ${SAMPLE_INTERVAL})\n`)

  for (let i = 0; i < TOTAL_SCROLLS; i++) {
    await page.evaluate(() => {
      const vp = document.querySelector('.media-stack-viewport')
      if (vp) { const h = vp.clientHeight || window.innerHeight; vp.scrollTop += h }
    })
    await sleep(SCROLL_DELAY)

    if ((i + 1) % SAMPLE_INTERVAL === 0) {
      const s = await sampleMemory(`scroll-${i + 1}`)
      samples.push(s)
      const d = s.jsHeapUsedMB - baseline.jsHeapUsedMB
      console.log(`[scroll ${(i + 1).toString().padStart(3)}/${TOTAL_SCROLLS}]  JS heap: ${s.jsHeapUsedMB.toString().padStart(7)} MB  (Δ${d >= 0 ? '+' : ''}${d.toFixed(2).padStart(7)})  DOM: ${s.domNodes}`)
    }
  }

  const final = await sampleMemory('final')
  samples.push(final)
  console.log(`[final]     JS heap: ${final.jsHeapUsedMB} MB  DOM: ${final.domNodes} nodes`)

  // ── Report ──
  const peak = samples.reduce((m, s) => s.jsHeapUsedMB > m.jsHeapUsedMB ? s : m, samples[0])
  const summary = {
    baselineHeapMB: baseline.jsHeapUsedMB,
    finalHeapMB: final.jsHeapUsedMB,
    growthMB: +(final.jsHeapUsedMB - baseline.jsHeapUsedMB).toFixed(2),
    peakHeapMB: peak.jsHeapUsedMB,
    peakAtLabel: peak.label,
    baselineDomNodes: baseline.domNodes,
    finalDomNodes: final.domNodes,
  }

  const reportPath = resolve(ROOT, `memory-profile-report-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify({ url, timestamp: new Date().toISOString(), totalScrolls: TOTAL_SCROLLS, sampleInterval: SAMPLE_INTERVAL, scrollDelayMs: SCROLL_DELAY, samples, summary }, null, 2))
  console.log(`\nReport → ${reportPath}`)
  console.log('\n── Summary ──')
  console.log(`  Baseline:  ${baseline.jsHeapUsedMB} MB · ${baseline.domNodes} nodes`)
  console.log(`  Peak:      ${summary.peakHeapMB} MB (at ${summary.peakAtLabel})`)
  console.log(`  Final:     ${final.jsHeapUsedMB} MB · ${final.domNodes} nodes`)
  console.log(`  Growth:    ${summary.growthMB} MB`)

  await browser.close()
  if (devServer) devServer.kill()
}

main().catch(err => { console.error(err); process.exit(1) })
