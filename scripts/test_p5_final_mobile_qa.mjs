import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WIDTH = 390
const HEIGHT = 844
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitHttp(url, timeoutMs = 20_000) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error('HTTP ' + response.status)
    } catch (error) {
      lastError = error
    }
    await sleep(100)
  }
  throw lastError ?? new Error('Timed out waiting for ' + url)
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {}
  }
  for (const command of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [command], { encoding: 'utf8' }).stdout.trim()
    if (found) return found
  }
  throw new Error('Chromium/Chrome not available on this runner')
}

class Cdp {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.events = []
  }

  async open() {
    this.ws = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket open timeout')), 10_000)
      this.ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      this.ws.addEventListener('error', (event) => {
        clearTimeout(timer)
        reject(event?.error ?? new Error('CDP websocket error'))
      }, { once: true })
    })
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)))
        else pending.resolve(message.result ?? {})
        return
      }
      this.events.push(message)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.ws?.close()
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
  }
  return result.result?.value
}

async function waitFor(cdp, expression, label, timeoutMs = 15_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(cdp, expression)) return
    } catch {}
    await sleep(80)
  }
  throw new Error('Timed out waiting for ' + label)
}

async function pageTarget(port) {
  const started = Date.now()
  while (Date.now() - started < 15_000) {
    try {
      const list = await fetch('http://127.0.0.1:' + port + '/json/list').then((r) => r.json())
      const page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
      if (page) return page
    } catch {}
    await sleep(100)
  }
  throw new Error('Timed out waiting for Chrome remote debugging target')
}

function initScript() {
  return String.raw`
(() => {
  const now = Date.now()
  const session = {
    id: 1,
    title: '测试TA',
    persona: '温柔、自然、真实地陪伴用户。',
    created_at: new Date(now - 21 * 86400000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    firstSeenAt: new Date(now - 21 * 86400000).toISOString(),
  }
  const messages = [
    { id: 1, role: 'assistant', content: '我在。', ts: now - 120000 },
    { id: 2, role: 'user', content: '今天有点累。', ts: now - 60000 },
    { id: 3, role: 'assistant', content: '那就先在这里歇一会儿。', ts: now - 30000 },
  ]
  const sessionMemory = {
    id: 'mem-qa-1',
    text: '用户喜欢喝咖啡',
    createdAt: now - 3 * 86400000,
    topic: '饮食',
    explicit: true,
    source: '我喜欢喝咖啡',
    taReply: '好，我记住了。',
  }
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('eluvin_consent', JSON.stringify({ version: 'v1', consentedAt: new Date(now).toISOString() }))
  sessionStorage.setItem('eluvin_consent_session', '1')
  localStorage.setItem('ai_companion_account', JSON.stringify({ token: 'qa-token', account: 'qa@example.test', consentVersion: 'v1' }))
  localStorage.setItem('ai_companion_sessions_cache', JSON.stringify([session]))
  localStorage.setItem('ai_companion_active_session_id', '1')
  localStorage.setItem('ai_companion_msgs_1', JSON.stringify(messages))
  localStorage.setItem('ai_companion_mem_1', JSON.stringify([sessionMemory]))
  localStorage.setItem('ai_companion_memory', JSON.stringify([]))
  localStorage.setItem('eluvin_last_primary_view', 'home')
  localStorage.setItem('ai_companion_settings', JSON.stringify({
    provider: 'zhipu',
    providers: {
      zhipu: { apiKey: 'qa-key', baseUrl: 'https://mock-model.invalid/v1', model: 'qa-model' }
    }
  }))

  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input?.url || String(input)
    if (raw.startsWith('https://api.eluvin.space')) {
      const url = new URL(raw)
      const method = String(init?.method || 'GET').toUpperCase()
      if (url.pathname === '/api/sessions' && method === 'GET') {
        return json({ sessions: [session] })
      }
      if (url.pathname === '/api/state/pull' && method === 'GET') {
        return json({ ok: true, cursor: 0, serverRevision: 0, hasMore: false, changes: [] })
      }
      if (url.pathname === '/api/state/push' && method === 'POST') {
        return json({ results: [] })
      }
      if (url.pathname === '/api/notifications' && method === 'GET') {
        return json({ revision: 0, unread: false })
      }
      if (url.pathname === '/api/notifications/read' && method === 'POST') {
        return json({ ok: true })
      }
      if (url.pathname === '/api/photos' && method === 'GET') {
        return json({ photos: [] })
      }
      if (url.pathname === '/api/sessions/1' && method === 'GET') {
        return json({
          session,
          messages: messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: new Date(m.ts).toISOString(),
          })),
          memories: [{
            id: 101,
            content: sessionMemory.text,
            createdAt: new Date(sessionMemory.createdAt).toISOString(),
            source: sessionMemory.source,
            taReply: sessionMemory.taReply,
          }],
        })
      }
      if (url.pathname === '/api/sessions/1/memories' && method === 'GET') {
        return json({ memories: [{
          id: 101,
          content: sessionMemory.text,
          createdAt: new Date(sessionMemory.createdAt).toISOString(),
          source: sessionMemory.source,
          taReply: sessionMemory.taReply,
        }] })
      }
      if (url.pathname === '/api/sync' && method === 'GET') {
        return json({ data: null, updatedAt: new Date(now).toISOString() })
      }
      return json({ ok: true })
    }
    if (raw.startsWith('https://mock-model.invalid')) {
      return json({ choices: [{ message: { content: 'QA mock reply' } }] })
    }
    return realFetch(input, init)
  }
})()
`
}

async function assertNoOverflow(cdp, label) {
  const metrics = await evaluate(cdp, `(() => ({
    innerWidth,
    innerHeight,
    docWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body?.scrollWidth ?? 0
  }))()`)
  assert.equal(metrics.innerWidth, WIDTH, label + ': viewport width must be 390')
  assert.equal(metrics.innerHeight, HEIGHT, label + ': viewport height must be 844')
  const widest = Math.max(metrics.docWidth, metrics.bodyWidth)
  assert.ok(widest <= WIDTH + 1, label + ': horizontal overflow ' + widest + 'px > ' + WIDTH + 'px')
}

async function assertVisible(cdp, selector, label, fully = false) {
  const result = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return { exists: false }
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const visible = r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
    return {
      exists: true,
      visible,
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      width: r.width,
      height: r.height
    }
  })()`)
  assert.equal(result.exists, true, label + ': missing ' + selector)
  assert.equal(result.visible, true, label + ': hidden ' + selector)
  assert.ok(result.right <= WIDTH + 1 && result.left >= -1, label + ': horizontal clipping ' + JSON.stringify(result))
  if (fully) {
    assert.ok(result.top >= -1 && result.bottom <= HEIGHT + 1, label + ': not fully in first viewport ' + JSON.stringify(result))
  }
  return result
}

async function clickNav(cdp, text) {
  const ok = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.app-nav .nav-btn')].find((el) => el.textContent?.trim() === ${JSON.stringify(text)})
    if (!button) return false
    button.click()
    return true
  })()`)
  assert.equal(ok, true, 'bottom nav button missing: ' + text)
}

let vite = null
let chrome = null
let cdp = null
let profileDir = null

try {
  const vitePort = await freePort()
  const debugPort = await freePort()
  profileDir = await mkdtemp(join(tmpdir(), 'eluvin-p5-qa-'))

  vite = spawn(process.execPath, [
    viteBin,
    '--host', '127.0.0.1',
    '--port', String(vitePort),
    '--strictPort',
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let viteStderr = ''
  vite.stderr.on('data', (chunk) => { viteStderr += String(chunk) })
  await waitHttp('http://127.0.0.1:' + vitePort + '/')

  const chromeBin = await findChrome()
  chrome = spawn(chromeBin, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--remote-debugging-port=' + debugPort,
    '--user-data-dir=' + profileDir,
    '--window-size=' + WIDTH + ',' + HEIGHT,
    '--hide-scrollbars',
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  let chromeStderr = ''
  chrome.stderr.on('data', (chunk) => { chromeStderr += String(chunk) })

  const target = await pageTarget(debugPort)
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: WIDTH,
    screenHeight: HEIGHT,
  })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript() })

  console.log('[P5 Final QA] boot current main in real Chromium @ 390x844')
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + vitePort + '/' })
  await waitFor(cdp, `document.readyState === 'complete'`, 'document complete')
  await waitFor(cdp, `Boolean(document.querySelector('.home-page'))`, 'Home')

  const media = await evaluate(cdp, `({
    coarse: matchMedia('(pointer: coarse)').matches,
    hover: matchMedia('(hover: hover)').matches,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches
  })`)
  assert.equal(media.coarse, true, 'mobile QA must exercise coarse pointer rules')
  assert.equal(media.hover, false, 'mobile QA must not exercise desktop hover rules')

  console.log('[P5 Final QA] Home')
  await assertNoOverflow(cdp, 'Home')
  await assertVisible(cdp, '.home-companion', 'Home TA Presence')
  await assertVisible(cdp, '.home-talk', 'Home CTA', true)
  await assertVisible(cdp, '.app-nav', 'Home bottom nav', true)

  console.log('[P5 Final QA] Space + Photo Wall')
  await clickNav(cdp, '空间')
  await waitFor(cdp, `Boolean(document.querySelector('.ai-space-page'))`, 'Space')
  await assertNoOverflow(cdp, 'Space')
  await assertVisible(cdp, '.ai-space-page', 'Space page')
  const spaceCopy = await evaluate(cdp, `document.querySelector('.ai-space-page')?.innerText || ''`)
  assert.match(spaceCopy, /一周情书/, 'Space weekly-letter entry must render')
  await assertVisible(cdp, '.app-nav', 'Space bottom nav', true)

  console.log('[P5 Final QA] Memory')
  await clickNav(cdp, '记忆')
  await waitFor(cdp, `Boolean(document.querySelector('.memory-page'))`, 'Memory')
  await assertNoOverflow(cdp, 'Memory')
  await assertVisible(cdp, '.memory-page', 'Memory page')
  const memoryCopy = await evaluate(cdp, `document.querySelector('.memory-page')?.innerText || ''`)
  assert.match(memoryCopy, /喜欢喝咖啡|记忆/, 'Memory content/empty shell must render')
  await assertVisible(cdp, '.app-nav', 'Memory bottom nav', true)

  console.log('[P5 Final QA] Settings / Mine')
  await clickNav(cdp, '我的')
  await waitFor(cdp, `Boolean(document.querySelector('.settings-page'))`, 'Settings')
  await assertNoOverflow(cdp, 'Settings')
  await assertVisible(cdp, '.settings-page', 'Settings page')
  await assertVisible(cdp, '.app-nav', 'Settings bottom nav', true)

  console.log('[P5 Final QA] return Home then enter Chat')
  await clickNav(cdp, 'TA')
  await waitFor(cdp, `Boolean(document.querySelector('.home-page'))`, 'Home return')
  const clickedTalk = await evaluate(cdp, `(() => {
    const button = document.querySelector('.home-talk')
    if (!button) return false
    button.click()
    return true
  })()`)
  assert.equal(clickedTalk, true, 'Home CTA must remain clickable')
  await waitFor(cdp, `Boolean(document.querySelector('.chat-page'))`, 'Chat')

  console.log('[P5 Final QA] Chat visual closure')
  await assertNoOverflow(cdp, 'Chat')
  await assertVisible(cdp, '.chat-page', 'Chat page')
  await assertVisible(cdp, '.chat-composer-panel', 'Chat composer', true)
  await assertVisible(cdp, '.chat-page textarea', 'Chat textarea', true)
  const navInChat = await evaluate(cdp, `Boolean(document.querySelector('.chat-page') && document.querySelector('.app-nav'))`)
  assert.equal(navInChat, false, 'Chat is a full-screen secondary view; primary nav must stay hidden')

  const exceptions = cdp.events
    .filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => event.params?.exceptionDetails?.text || 'Runtime exception')
  assert.deepEqual(exceptions, [], 'browser runtime exceptions: ' + exceptions.join(' | '))

  console.log('[P5 Final QA] PASS — Home / Space / Memory / Mine / Chat @ 390x844')
} catch (error) {
  console.error('[P5 Final QA] FAIL', error)
  throw error
} finally {
  try { cdp?.close() } catch {}
  if (chrome && !chrome.killed) chrome.kill('SIGTERM')
  if (vite && !vite.killed) vite.kill('SIGTERM')
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {})
}
