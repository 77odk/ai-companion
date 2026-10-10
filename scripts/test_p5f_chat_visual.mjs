import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
const chatCss = fs.readFileSync(new URL('../src/styles/chat.css', import.meta.url), 'utf8')
const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/lib/useChatScroll.ts', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/lib/useChatMessages.ts', import.meta.url), 'utf8')
const bubble = fs.readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')
const controls = fs.readFileSync(new URL('../src/components/ChatCompanionControls.tsx', import.meta.url), 'utf8')

function expectPressAfterLift(activeSelector, hoverSelector, focusSelector) {
  const activeIndex = chatCss.lastIndexOf(activeSelector)
  const hoverIndex = chatCss.lastIndexOf(hoverSelector)
  const focusIndex = chatCss.lastIndexOf(focusSelector)
  assert.ok(activeIndex >= 0, 'missing active selector: ' + activeSelector)
  assert.ok(hoverIndex >= 0, 'missing hover selector: ' + hoverSelector)
  assert.ok(focusIndex >= 0, 'missing focus selector: ' + focusSelector)
  assert.ok(
    activeIndex > hoverIndex && activeIndex > focusIndex,
    activeSelector + ' must win the cascade over hover/focus Lift',
  )
}

console.log('[P5-F] Chat visual layer is loaded last without touching Chat components')
const chatImport = main.indexOf("import './styles/chat.css'")
const keyGuideImport = main.indexOf("import './styles/keyGuide.css'")
assert.ok(chatImport > keyGuideImport, 'chat.css must be the final CSS integration layer')
assert.equal(chat.includes("import '../styles/chat.css'"), false)
assert.equal(bubble.includes("import '../styles/chat.css'"), false)
assert.equal(controls.includes("import '../styles/chat.css'"), false)
const composerSrc = fs.readFileSync(new URL('../src/components/ChatComposer.tsx', import.meta.url), 'utf8')
assert.ok(composerSrc.includes('className="chat-composer-panel"'))
assert.ok(bubble.includes('message-actions-trigger'))
assert.ok(controls.includes('chat-control-capsule'))

console.log('[P5-F] compact bubbles stay content surfaces; depth belongs to real layers')
assert.match(chatCss, /\.chat-page \.bubble-user,[\s\S]*\.chat-page \.bubble-assistant \{[\s\S]*box-shadow: var\(--el-shadow-surface/)
assert.match(chatCss, /\.chat-page \.chat-composer-panel \{[\s\S]*box-shadow: var\(--el-shadow-raised/)
assert.match(chatCss, /\.chat-page \.chat-control-menu,[\s\S]*\.chat-page \.context-meter-popover,[\s\S]*\.chat-page \.message-actions-menu \{[\s\S]*box-shadow: var\(--el-shadow-floating/)
assert.equal(chatCss.includes('translateX('), false, 'P5-F must not introduce horizontal motion or overflow risk')
assert.equal(chatCss.includes('perspective:'), false, 'Chat must remain faux-depth, not a 3D scene')
assert.equal(chatCss.includes('translateZ('), false, 'Chat bubbles/controls must not create a large compositor stack')

console.log('[P5-F] Press wins over Lift for primary Chat controls')
expectPressAfterLift(
  '.chat-page .msg-avatar-btn:active',
  '.chat-page .msg-avatar-btn:hover',
  '.chat-page .msg-avatar-btn:focus-visible',
)
expectPressAfterLift(
  '.chat-page .think-bar:active',
  '.chat-page .think-bar:hover',
  '.chat-page .think-bar:focus-visible',
)
expectPressAfterLift(
  '.chat-page .message-actions-trigger:active',
  '.chat-page .message-actions-trigger:hover',
  '.chat-page .message-actions-trigger:focus-visible',
)
expectPressAfterLift(
  '.chat-page .chat-control-capsule:active',
  '.chat-page .chat-control-capsule:hover',
  '.chat-page .chat-control-capsule:focus-visible',
)
expectPressAfterLift(
  '.chat-page .context-meter-circle:active',
  '.chat-page .context-meter-circle:hover',
  '.chat-page .context-meter-circle:focus-visible',
)
expectPressAfterLift(
  '.chat-page .btn-action-narration:active:not(:disabled)',
  '.chat-page .btn-action-narration:hover:not(:disabled)',
  '.chat-page .btn-action-narration:focus-visible',
)
expectPressAfterLift(
  '.chat-page .btn-send:active:not(:disabled)',
  '.chat-page .btn-send:hover:not(:disabled)',
  '.chat-page .btn-send:focus-visible',
)
expectPressAfterLift(
  '.chat-page .btn-stop:active:not(:disabled)',
  '.chat-page .btn-stop:hover:not(:disabled)',
  '.chat-page .btn-stop:focus-visible',
)

console.log('[P5-F] desktop hover is fine-pointer only and keyboard focus stays visible')
const hoverMedia = chatCss.indexOf('@media (hover: hover) and (pointer: fine)')
assert.ok(hoverMedia >= 0)
const pressComment = chatCss.indexOf('/* Press stays after focus / hover')
assert.ok(pressComment > hoverMedia)
const beforeHoverMedia = chatCss.slice(0, hoverMedia)
assert.equal(beforeHoverMedia.includes(':hover'), false, 'no P5-F hover behavior may leak outside fine-pointer media')
assert.match(chatCss, /\.chat-page \.message-actions-menu button:focus-visible,[\s\S]*outline: 2px solid/)
assert.match(chatCss, /\.chat-page \.chat-control-menu button:focus-visible,[\s\S]*outline: 2px solid/)

console.log('[P5-F] reduced motion removes continuous / interactive movement')
const reducedStart = chatCss.indexOf('@media (prefers-reduced-motion: reduce)')
assert.ok(reducedStart >= 0)
const reduced = chatCss.slice(reducedStart)
assert.ok(reduced.includes('transition: none;'))
assert.ok(reduced.includes('transform: none;'))
assert.ok(reduced.includes('.chat-page .typing i'))
assert.ok(reduced.includes('animation: none !important;'))
assert.ok(reduced.includes('opacity: .9;'))
assert.equal(chatCss.includes('@keyframes'), false, 'P5-F adds no new ambient/keyframe animation')

console.log('[P5-F] hidden pages pause the one existing continuous Chat animation')
assert.match(chatCss, /html\[data-el-page-hidden='true'\] \.chat-page \.typing i/)
assert.match(chatCss, /animation-play-state: paused !important;/)

console.log('[P5-F] style-only boundary: no runtime/data mechanisms are added')
for (const forbidden of [
  'localStorage',
  'sessionStorage',
  'fetch(',
  'postMessage(',
  'requestAnimationFrame',
  'setInterval(',
  'setTimeout(',
  '<canvas',
]) {
  assert.equal(chatCss.includes(forbidden), false, 'chat.css must not contain runtime mechanism: ' + forbidden)
}

console.log('P5-F Chat visual closure tests passed')


if (process.env.CI === 'true') {
  console.log('[P5-F runtime] 390x844 主路径 headless Chromium QA')

  const repoRoot = fileURLToPath(new URL('../', import.meta.url))
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const freePort = () => new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })

  const findChrome = () => {
    const candidates = [
      process.env.CHROME_PATH,
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ].filter(Boolean)
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      const found = spawnSync('which', [command], { encoding: 'utf8' }).stdout?.trim()
      if (found && fs.existsSync(found)) return found
    }
    throw new Error('P5 runtime QA needs a system Chrome/Chromium binary')
  }

  const waitHttp = async (url, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs
    let lastError = null
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url)
        if (response.ok) return response
        lastError = new Error('HTTP ' + response.status)
      } catch (error) {
        lastError = error
      }
      await sleep(120)
    }
    throw lastError ?? new Error('Timed out waiting for ' + url)
  }

  class CdpClient {
    constructor(url) {
      this.nextId = 1
      this.pending = new Map()
      this.handlers = new Map()
      this.closedError = null
      this.commandTimeoutMs = 10_000
      this.ws = new WebSocket(url)

      this.ready = new Promise((resolve, reject) => {
        let settled = false
        const handshakeTimer = setTimeout(() => {
          finish(reject, new Error('CDP websocket handshake timed out'))
          try { this.ws.close() } catch {}
        }, 10_000)
        const finish = (fn, value) => {
          if (settled) return
          settled = true
          clearTimeout(handshakeTimer)
          fn(value)
        }
        this.ws.addEventListener('open', () => finish(resolve), { once: true })
        this.ws.addEventListener('error', () => finish(reject, new Error('CDP websocket failed before open')), { once: true })
        this.ws.addEventListener('close', () => finish(reject, new Error('CDP websocket closed before open')), { once: true })
      })

      const rejectPending = (error) => {
        if (!this.closedError) this.closedError = error
        for (const [id, waiter] of this.pending) {
          this.pending.delete(id)
          clearTimeout(waiter.timer)
          waiter.reject(error)
        }
      }

      this.ws.addEventListener('error', () => {
        rejectPending(new Error('CDP websocket error'))
      })
      this.ws.addEventListener('close', (event) => {
        rejectPending(new Error('CDP websocket closed (' + event.code + ')'))
      })
      this.ws.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data))
        if (message.id) {
          const waiter = this.pending.get(message.id)
          if (!waiter) return
          this.pending.delete(message.id)
          clearTimeout(waiter.timer)
          if (message.error) waiter.reject(new Error(message.error.message || 'CDP error'))
          else waiter.resolve(message.result)
          return
        }
        const list = this.handlers.get(message.method) ?? []
        for (const handler of list) {
          Promise.resolve(handler(message.params ?? {})).catch((error) => {
            console.error('CDP event handler failed', message.method, error)
          })
        }
      })
    }

    async send(method, params = {}) {
      await this.ready
      if (this.closedError) throw this.closedError
      const id = this.nextId++
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!this.pending.has(id)) return
          this.pending.delete(id)
          reject(new Error('CDP command timed out: ' + method))
        }, this.commandTimeoutMs)
        this.pending.set(id, { resolve, reject, timer })
      })
      try {
        this.ws.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        const waiter = this.pending.get(id)
        if (waiter) {
          this.pending.delete(id)
          clearTimeout(waiter.timer)
          waiter.reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
      return promise
    }

    on(method, handler) {
      const list = this.handlers.get(method) ?? []
      list.push(handler)
      this.handlers.set(method, list)
    }

    close() {
      const error = new Error('CDP client closed')
      if (!this.closedError) this.closedError = error
      for (const [id, waiter] of this.pending) {
        this.pending.delete(id)
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }
      try { this.ws.close() } catch {}
    }
  }

  const vitePort = await freePort()
  const chromePort = await freePort()
  const browserPath = findChrome()
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eluvin-p5-qa-'))
  const viteEntry = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const viteLogs = []
  const chromeLogs = []

  const vite = spawn(process.execPath, [
    viteEntry,
    '--host', '127.0.0.1',
    '--port', String(vitePort),
    '--strictPort',
  ], {
    cwd: repoRoot,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  vite.stdout.on('data', (chunk) => viteLogs.push(String(chunk)))
  vite.stderr.on('data', (chunk) => viteLogs.push(String(chunk)))

  const chrome = spawn(browserPath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--remote-debugging-port=' + chromePort,
    '--user-data-dir=' + profileDir,
    '--window-size=390,844',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  chrome.stdout.on('data', (chunk) => chromeLogs.push(String(chunk)))
  chrome.stderr.on('data', (chunk) => chromeLogs.push(String(chunk)))

  let cdp = null
  try {
    await waitHttp('http://127.0.0.1:' + vitePort + '/')
    await waitHttp('http://127.0.0.1:' + chromePort + '/json/version')

    const targetResponse = await fetch(
      'http://127.0.0.1:' + chromePort + '/json/new?about:blank',
      { method: 'PUT' },
    )
    assert.equal(targetResponse.ok, true, 'Chrome DevTools target should open')
    const target = await targetResponse.json()
    assert.ok(target.webSocketDebuggerUrl, 'Chrome target must expose CDP websocket')

    cdp = new CdpClient(target.webSocketDebuggerUrl)
    await cdp.ready
    await Promise.all([
      cdp.send('Runtime.enable'),
      cdp.send('Page.enable'),
      cdp.send('Network.enable'),
      cdp.send('Log.enable'),
      cdp.send('Fetch.enable', {
        patterns: [
          { urlPattern: 'https://api.eluvin.space/*', requestStage: 'Request' },
          { urlPattern: 'http://127.0.0.1:' + vitePort + '/version.json', requestStage: 'Request' },
        ],
      }),
      cdp.send('Emulation.setDeviceMetricsOverride', {
        mobile: true,
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        screenWidth: 390,
        screenHeight: 844,
      }),
      cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }),
    ])

    const now = Date.now()
    const session = {
      id: 1,
      title: '小忆',
      persona: '你是小忆，和用户保持温柔、自然、真实的陪伴关系。',
      created_at: '2026-09-01T12:00:00.000Z',
      updatedAt: '2026-10-05T08:00:00.000Z',
      firstSeenAt: '2026-09-01T12:00:00.000Z',
    }
    const messages = [
      { id: 101, role: 'assistant', content: '你回来啦。', ts: now - 180_000 },
      { id: 102, role: 'user', content: '今天想和你待一会儿。', ts: now - 120_000 },
      { id: 103, role: 'assistant', content: '好，我在。慢慢说。', ts: now - 60_000 },
    ]
    const cloudMessages = messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: new Date(message.ts).toISOString(),
    }))
    const memoryTexts = [
      '喜欢在晚上喝热茶',
      '最近在认真做自己的项目',
      '喜欢安静一点的陪伴',
      '说过想把重要的日子记下来',
      '不喜欢被突然打断',
      '希望 TA 记得真实发生过的事',
    ]
    const sourceTexts = [
      '我晚上挺喜欢喝热茶的',
      '我最近在认真做自己的项目',
      '我更喜欢安静一点的陪伴',
      '重要的日子还是想记下来',
      '我不喜欢说话时被突然打断',
      '真实发生过的事情记得就好',
    ]
    const memories = Array.from({ length: 6 }, (_, index) => ({
      id: String(201 + index),
      text: memoryTexts[index],
      topic: index === 1 ? '工作' : '其他',
      explicit: true,
      createdAt: now - (index + 1) * 86_400_000,
      source: sourceTexts[index],
      taReply: '嗯，我会按你真的说过的来记。',
    }))
    const cloudMemories = memories.map((memory) => ({
      id: Number(memory.id),
      content: memory.text,
      createdAt: new Date(memory.createdAt).toISOString(),
      source: memory.source,
      taReply: memory.taReply,
    }))
    const svgData = (label) =>
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">' +
        '<rect width="100%" height="100%" fill="#eee8df"/>' +
        '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-size="80" fill="#8b8177">' +
        label +
        '</text></svg>',
      )
    const photos = Array.from({ length: 12 }, (_, index) => ({
      id: 'local-qa-' + index,
      sessionId: '1',
      width: index % 3 === 0 ? 600 : 800,
      height: index % 3 === 0 ? 800 : 600,
      createdAt: now - index * 3_600_000,
      dataUrl: svgData(String(index + 1)),
    }))
    const modelSettings = {
      provider: 'zhipu',
      providers: {
        zhipu: {
          apiKey: 'qa-local-key',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'glm-4.7-flash',
        },
      },
    }

    const seedStorage = {
      ai_companion_account: { token: 'qa-token', account: 'qa@example.test', consentVersion: 'v1' },
      eluvin_consent: { version: 'v1', consentedAt: '2026-10-05T00:00:00.000Z' },
      ai_companion_active_session_id: '1',
      ai_companion_sessions_cache: [session],
      ai_companion_msgs_1: messages,
      ai_companion_mem_1: memories,
      ai_companion_settings: modelSettings,
      ai_space_photos_1: photos,
      eluvin_last_primary_view: 'home',
    }
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: '(() => { try { if (!/^https?:$/.test(location.protocol)) return; const values = ' +
        JSON.stringify(seedStorage) +
        '; for (const [key, value] of Object.entries(values)) { localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value)); } } catch {} })();',
    })

    const runtimeExceptions = []
    const consoleErrors = []
    const browserLogErrors = []
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      runtimeExceptions.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'Unknown page exception')
    })
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type !== 'error') return
      consoleErrors.push((args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type).join(' '))
    })
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (entry?.level !== 'error') return
      browserLogErrors.push({
        source: entry.source || 'unknown',
        text: entry.text || 'browser log error',
        url: entry.url || '',
      })
    })

    const corsHeaders = [
      { name: 'Content-Type', value: 'application/json; charset=utf-8' },
      { name: 'Access-Control-Allow-Origin', value: '*' },
      { name: 'Access-Control-Allow-Headers', value: 'Authorization, Content-Type' },
      { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, DELETE, OPTIONS' },
    ]
    const fulfillJson = (requestId, value, status = 200) =>
      cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        responseHeaders: corsHeaders,
        body: Buffer.from(JSON.stringify(value)).toString('base64'),
      })

    cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
      const method = String(request.method || 'GET').toUpperCase()
      const url = new URL(request.url)
      if (method === 'OPTIONS') {
        await cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 204,
          responseHeaders: corsHeaders,
        })
        return
      }
      if (url.origin === 'http://127.0.0.1:' + vitePort && url.pathname === '/version.json') {
        const currentSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim()
        await fulfillJson(requestId, { version: currentSha })
        return
      }
      if (url.origin !== 'https://api.eluvin.space') {
        await cdp.send('Fetch.continueRequest', { requestId })
        return
      }

      if (url.pathname === '/api/state/pull') {
        await fulfillJson(requestId, { ok: true, cursor: 0, serverRevision: 0, hasMore: false, changes: [] })
        return
      }
      if (url.pathname === '/api/state/push') {
        let ops = []
        try { ops = JSON.parse(request.postData || '{}').ops || [] } catch {}
        await fulfillJson(requestId, {
          results: ops.map((op, index) => ({
            opId: op.opId,
            status: 'applied',
            version: index + 1,
          })),
        })
        return
      }
      if (url.pathname === '/api/sessions' && method === 'GET') {
        await fulfillJson(requestId, { sessions: [session] })
        return
      }
      if (url.pathname === '/api/sessions/1/memories' && method === 'GET') {
        await fulfillJson(requestId, { memories: cloudMemories })
        return
      }
      if (url.pathname === '/api/sessions/1' && method === 'GET') {
        await fulfillJson(requestId, { session, messages: cloudMessages, memories: cloudMemories })
        return
      }
      if (url.pathname === '/api/notifications' && method === 'GET') {
        await fulfillJson(requestId, { revision: 0, unread: false })
        return
      }
      if (url.pathname === '/api/photos' && method === 'GET') {
        await fulfillJson(requestId, { photos: [] })
        return
      }
      await fulfillJson(requestId, { ok: true })
    })

    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (result?.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed')
      }
      return result?.result?.value
    }

    const waitFor = async (expression, label, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        try {
          if (await evaluate(expression)) return
        } catch {}
        await sleep(100)
      }
      throw new Error('Timed out waiting for ' + label)
    }

    const clickNav = async (label) => {
      const clicked = await evaluate(
        '(() => { const button = [...document.querySelectorAll(".app-nav .nav-btn")].find((node) => node.textContent.trim() === ' +
        JSON.stringify(label) +
        '); if (!button) return false; button.click(); return true; })()',
      )
      assert.equal(clicked, true, 'nav button should exist: ' + label)
    }

    const assertNoHorizontalOverflow = async (label) => {
      const metrics = await evaluate('(() => ({ innerWidth: window.innerWidth, docScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, appScrollWidth: document.querySelector(".app")?.scrollWidth ?? 0, appMainScrollWidth: document.querySelector(".app-main")?.scrollWidth ?? 0, appMainClientWidth: document.querySelector(".app-main")?.clientWidth ?? 0 }))()')
      assert.equal(metrics.innerWidth, 390, label + ': viewport width must stay 390')
      assert.ok(metrics.docScrollWidth <= 391, label + ': document must not horizontally overflow: ' + JSON.stringify(metrics))
      assert.ok(metrics.bodyScrollWidth <= 391, label + ': body must not horizontally overflow: ' + JSON.stringify(metrics))
      if (metrics.appMainClientWidth > 0) {
        assert.ok(
          metrics.appMainScrollWidth <= metrics.appMainClientWidth + 1,
          label + ': app-main must not horizontally overflow: ' + JSON.stringify(metrics),
        )
      }
    }

    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + vitePort + '/' })
    await waitFor('Boolean(document.querySelector(".home-talk") && document.querySelector(".app-nav"))', 'Home')

    const viewport = await evaluate('({ width: innerWidth, height: innerHeight, coarse: matchMedia("(pointer: coarse)").matches })')
    assert.equal(viewport.width, 390)
    assert.equal(viewport.height, 844)
    assert.equal(viewport.coarse, true, 'mobile QA must run with coarse pointer semantics')
    await assertNoHorizontalOverflow('Home')

    const homeLayout = await evaluate('(() => { const rect = (selector) => { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; }; return { time: rect(".home-time"), myTime: rect(".home-my-time"), companion: rect(".home-companion"), talk: rect(".home-talk"), life: rect(".home-life") }; })()')
    for (const [name, rect] of Object.entries(homeLayout)) assert.ok(rect, 'Home missing ' + name)
    assert.ok(homeLayout.time.top < homeLayout.myTime.top)
    assert.ok(homeLayout.myTime.top < homeLayout.companion.top)
    assert.ok(homeLayout.companion.top < homeLayout.talk.top)
    assert.ok(homeLayout.talk.top < homeLayout.life.top)
    assert.ok(homeLayout.talk.top >= 0 && homeLayout.talk.bottom <= 844, 'Home CTA must be fully visible in 390x844 first screen')

    await clickNav('空间')
    await waitFor('Boolean(document.querySelector(".ai-space-page .photo-stack-preview"))', 'Space')
    await assertNoHorizontalOverflow('Space')
    const previewCount = await evaluate('document.querySelectorAll(".photo-stack-preview .photo-stack-card").length')
    assert.equal(previewCount, 12, 'Photo Wall preview should exercise all 12 deterministic slots')
    const previewRect = await evaluate('(() => { const r = document.querySelector(".photo-stack-preview").getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; })()')
    assert.ok(previewRect.left >= -1 && previewRect.right <= 391, 'Photo Wall preview must stay within the mobile viewport')

    await evaluate('document.querySelector(".photo-stack-preview").click(); true')
    await waitFor('Boolean(document.querySelector(".photo-archive-page"))', 'Photo Wall full archive')
    await assertNoHorizontalOverflow('Photo Wall full archive')
    const fullPhotoCount = await evaluate('document.querySelectorAll(".photo-archive-card").length')
    assert.equal(fullPhotoCount, 12)
    await evaluate('document.querySelector(".photo-archive-back").click(); true')
    await waitFor('!document.querySelector(".photo-archive-page")', 'Photo Wall close')

    await clickNav('记忆')
    await waitFor('Boolean(document.querySelector(".memory-page .chaomu-memory-river"))', 'Chaomu Memory River')
    await assertNoHorizontalOverflow('Chaomu Memory River')
    const memoryCount = await evaluate('document.querySelectorAll(".memory-entry").length')
    assert.ok(memoryCount >= 6, 'Memory River should render the seeded memories')
    await evaluate('document.querySelector(".memory-entry").click(); true')
    await waitFor('Boolean(document.querySelector(".memory-detail-page .memory-book-entry"))', 'Memory detail')
    await assertNoHorizontalOverflow('Memory detail')
    await evaluate('document.querySelector(".memory-book-entry").click(); true')
    await waitFor('Boolean(document.querySelector(".memory-book-overlay .memory-book-body-page"))', 'Memory Book body')
    await assertNoHorizontalOverflow('Memory Book body')
    await evaluate('document.querySelector(".memory-book-exit").click(); true')
    await waitFor('Boolean(document.querySelector(".memory-detail-page .memory-back"))', 'Memory detail return')
    await evaluate('document.querySelector(".memory-back").click(); true')
    await waitFor('Boolean(document.querySelector(".memory-page .chaomu-memory-river"))', 'Chaomu Memory River return')

    await clickNav('我的')
    await waitFor('Boolean(document.querySelector(".settings-page"))', 'Mine / Settings')
    await assertNoHorizontalOverflow('Mine / Settings')

    await clickNav('TA')
    await waitFor('Boolean(document.querySelector(".home-talk"))', 'Home return')
    await evaluate('document.querySelector(".home-talk").click(); true')
    await waitFor('Boolean(document.querySelector(".chat-page .chat-composer-panel"))', 'Chat')
    await assertNoHorizontalOverflow('Chat')
    const chatLayout = await evaluate('(() => { const panel = document.querySelector(".chat-composer-panel")?.getBoundingClientRect(); const textarea = document.querySelector(".chat-composer-panel textarea")?.getBoundingClientRect(); return { navVisible: Boolean(document.querySelector(".app-nav")), panel: panel && { top: panel.top, bottom: panel.bottom, left: panel.left, right: panel.right }, textarea: textarea && { top: textarea.top, bottom: textarea.bottom, left: textarea.left, right: textarea.right }, messages: document.querySelectorAll("[data-msg-role]").length }; })()')
    assert.equal(chatLayout.navVisible, false, 'Chat is full-screen and must not keep the primary nav')
    assert.ok(chatLayout.panel, 'Chat composer must render')
    assert.ok(chatLayout.panel.left >= -1 && chatLayout.panel.right <= 391, 'Chat composer must stay within viewport width')
    assert.ok(chatLayout.panel.bottom <= 844 && chatLayout.panel.bottom > 0, 'Chat composer must stay visible above the mobile viewport bottom')
    assert.ok(chatLayout.textarea, 'Chat textarea must render')
    assert.ok(chatLayout.messages >= 3, 'Chat history should remain visible')

    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    const reduced = await evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches')
    assert.equal(reduced, true)
    await assertNoHorizontalOverflow('Chat reduced-motion')

    assert.deepEqual(runtimeExceptions, [], '390x844 run must have 0 page errors')
    assert.deepEqual(consoleErrors, [], '390x844 run must have 0 console API errors')
    assert.deepEqual(browserLogErrors, [], '390x844 run must have 0 error-level browser logs')
    console.log('[P5-F runtime] 390x844 Home / Space / PhotoWall / Memory / Mine / Chat 全通过')
  } catch (error) {
    console.error('P5 runtime QA failed')
    console.error(error)
    if (viteLogs.length) console.error('--- vite logs ---\n' + viteLogs.join(''))
    if (chromeLogs.length) console.error('--- chrome logs ---\n' + chromeLogs.join(''))
    throw error
  } finally {
    cdp?.close()
    try { vite.kill('SIGTERM') } catch {}
    try { chrome.kill('SIGTERM') } catch {}
    await sleep(150)
    try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch {}
  }
}
