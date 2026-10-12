import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function openBrowser(extraArgs = []) {
  const profile = await mkdtemp(join(tmpdir(), 'eluvin-space3d-'))
  const chrome = spawn(process.env.CHROMIUM_BIN || '/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--remote-debugging-port=0', '--remote-allow-origins=http://localhost',
    `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    ...extraArgs, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  const socketUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Chromium startup timeout: ${stderr.slice(-500)}`)), 20000)
    chrome.on('error', reject)
    chrome.stderr.on('data', chunk => {
      stderr += chunk
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
  })
  const socket = new WebSocket(socketUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject) })
  let seq = 0
  const pending = new Map(), listeners = new Set()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const entry = pending.get(message.id); if (!entry) return
      pending.delete(message.id); clearTimeout(entry.timer)
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result)
    } else listeners.forEach(listener => listener(message))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 120000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const target = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  const cdp = (method, params) => send(method, params, sessionId)
  await cdp('Page.enable'); await cdp('Runtime.enable')
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, timeout = 60000) => {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Browser wait timeout: ${expression}`)
  }
  return { cdp, evaluate, waitFor, onEvent: listener => listeners.add(listener),
    close: async () => {
      socket.close()
      await new Promise(resolve => { chrome.once('exit', resolve); chrome.kill() })
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } }
}

export async function startVite(port = 4178) {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite startup timeout')), 20000)
    child.on('error', reject); child.on('exit', code => { if (code) reject(new Error(`Vite exited ${code}`)) })
    child.stdout.on('data', chunk => { if (String(chunk).includes('Local:')) { clearTimeout(timeout); resolve() } })
  })
  return { origin: `http://127.0.0.1:${port}`, close: () => child.kill() }
}
