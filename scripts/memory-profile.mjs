#!/usr/bin/env node

/** Deterministic browser memory regression for the immersive feed. */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const fixturePath = resolve(rootDir, 'public/videos/The_Neon_Mascot_A_short_loop.mp4')
const args = process.argv.slice(2)
const targetUrl = flag('--url')
const visible = args.includes('--visible')
const totalTransitions = parseInt(flag('--transitions') || '100', 10)
const sampleInterval = parseInt(flag('--sample') || '10', 10)
const transitionDelayMs = parseInt(flag('--delay') || '100', 10)
const heapBudgetMb = parseFloat(flag('--heap-budget-mb') || '20')
const reportPath = resolve(flag('--report') || `/tmp/scrollstr-memory-profile-${Date.now()}.json`)
const port = 5173

function flag(name) {
  const item = args.find(value => value.startsWith(`${name}=`))
  return item ? item.slice(name.length + 1) : null
}

function startDevServer() {
  return new Promise((resolvePromise, reject) => {
    const processHandle = spawn('npx', ['vite', '--force', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, npm_config_cache: '/tmp/npm-scrollstr-cache' },
      detached: true,
    })
    const timeout = setTimeout(() => {
      if (processHandle.pid) process.kill(-processHandle.pid, 'SIGTERM')
      reject(new Error('Vite dev server timed out'))
    }, 40_000)
    processHandle.stdout.on('data', data => {
      const output = data.toString()
      process.stdout.write(`[vite] ${output}`)
      if (output.includes('Local:')) {
        clearTimeout(timeout)
        resolvePromise(processHandle)
      }
    })
    processHandle.stderr.on('data', data => process.stderr.write(`[vite] ${data}`))
    processHandle.on('exit', code => {
      if (code && code !== 0) {
        clearTimeout(timeout)
        reject(new Error(`Vite exited with code ${code}`))
      }
    })
  })
}

function regressionSlope(samples) {
  if (samples.length < 2) return 0
  const meanX = (samples.length - 1) / 2
  const meanY = samples.reduce((sum, value) => sum + value, 0) / samples.length
  let numerator = 0
  let denominator = 0
  for (let index = 0; index < samples.length; index++) {
    numerator += (index - meanX) * (samples[index] - meanY)
    denominator += (index - meanX) ** 2
  }
  return denominator ? numerator / denominator : 0
}

async function main() {
  let devServer = null
  let browser = null
  try {
    const url = targetUrl || `http://127.0.0.1:${port}`
    if (!targetUrl) devServer = await startDevServer()

    browser = await chromium.launch({
      headless: !visible,
      args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
    })
    const context = await browser.newContext({ viewport: { width: 480, height: 900 } })
    await context.addInitScript(() => {
      localStorage.setItem('scrollstr_has_opened', 'true')
      localStorage.setItem('scrollstr_session', JSON.stringify({ pubkey: 'a'.repeat(64), method: 'readonly' }))
    })
    await context.route(/\.(mp4|webm|mov)(\?.*)?$/i, route => route.fulfill({
      path: fixturePath,
      contentType: 'video/mp4',
    }))
    if (typeof context.routeWebSocket === 'function') {
      await context.routeWebSocket(/.*/, socket => socket.close())
    }

    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40_000 })
    await page.waitForSelector('.media-stack-viewport', { timeout: 25_000 })
    await page.waitForTimeout(1_000)

    const structure = await page.evaluate(() => ({
      viewports: document.querySelectorAll('.media-stack-viewport').length,
      wrappers: document.querySelectorAll('.media-stack-item-wrapper').length,
      videos: document.querySelectorAll('.media-stack-viewport video').length,
      blobSources: [...document.querySelectorAll('video')].filter(video => video.currentSrc.startsWith('blob:') || video.src.startsWith('blob:')).length,
    }))
    if (structure.viewports !== 1) throw new Error(`Expected one MediaStack viewport, found ${structure.viewports}`)
    if (structure.videos > 1) throw new Error(`Expected at most one mounted video decoder, found ${structure.videos}`)
    if (structure.blobSources !== 0) throw new Error(`Expected streaming URLs, found ${structure.blobSources} Blob source(s)`)
    if (structure.wrappers < 2) throw new Error(`Fixture feed did not initialize (${structure.wrappers} item wrappers)`)

    const cdp = await context.newCDPSession(page)
    async function sample(label) {
      await cdp.send('HeapProfiler.collectGarbage')
      const metrics = await page.evaluate(() => ({
        heap: performance.memory?.usedJSHeapSize ?? 0,
        domNodes: document.querySelectorAll('*').length,
        viewports: document.querySelectorAll('.media-stack-viewport').length,
        videos: document.querySelectorAll('.media-stack-viewport video').length,
      }))
      return {
        label,
        heapMb: +(metrics.heap / 1e6).toFixed(2),
        domNodes: metrics.domNodes,
        viewports: metrics.viewports,
        videos: metrics.videos,
      }
    }

    const samples = [await sample('baseline')]
    for (let index = 0; index < totalTransitions; index++) {
      await page.evaluate(step => {
        const viewport = document.querySelector('.media-stack-viewport')
        const count = document.querySelectorAll('.media-stack-item-wrapper').length
        if (!(viewport instanceof HTMLElement) || count < 1) return
        const height = viewport.clientHeight || window.innerHeight
        viewport.scrollTop = ((step + 1) % count) * height
        viewport.dispatchEvent(new Event('scroll'))
      }, index)
      await page.waitForTimeout(transitionDelayMs)
      if ((index + 1) % sampleInterval === 0) {
        const current = await sample(`transition-${index + 1}`)
        samples.push(current)
        console.log(`${current.label}: ${current.heapMb} MB, ${current.domNodes} DOM nodes, ${current.videos} video(s)`)
      }
    }

    const final = await sample('final')
    samples.push(final)
    const baseline = samples[0]
    const tail = samples.slice(-Math.min(6, samples.length)).map(item => item.heapMb)
    const tailSlopeMbPerSample = +regressionSlope(tail).toFixed(3)
    const growthMb = +(final.heapMb - baseline.heapMb).toFixed(2)
    const noSustainedPositiveTrend = tailSlopeMbPerSample <= 0.5
    const passed = growthMb <= heapBudgetMb
      && noSustainedPositiveTrend
      && samples.every(item => item.viewports === 1 && item.videos <= 1)
    const report = {
      url,
      fixturePath,
      totalTransitions,
      sampleInterval,
      transitionDelayMs,
      structure,
      samples,
      summary: { baselineHeapMb: baseline.heapMb, finalHeapMb: final.heapMb, growthMb, heapBudgetMb, tailSlopeMbPerSample, noSustainedPositiveTrend, passed },
    }
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`Memory report: ${reportPath}`)
    console.log(`Retained growth: ${growthMb} MB (budget ${heapBudgetMb} MB); tail slope: ${tailSlopeMbPerSample} MB/sample`)
    if (!passed) throw new Error('Memory regression acceptance criteria failed')
  } finally {
    await browser?.close()
    if (devServer?.pid) process.kill(-devServer.pid, 'SIGTERM')
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
