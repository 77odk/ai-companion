// UI2-03B-1 Memory「看原对话」：完整聊天记录 exact-match 三态 + 返回闭环
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_chat_jump.mjs（npm test 入口自动带上）
// 覆盖：unique / not_found / ambiguous / substring 禁止 / 角色隔离 /
//       sessionStart 不影响聊天记录 / verifyChatJumpTarget 二次校验（ts / content / session / 多命中）

import { readFileSync } from 'node:fs'
import {
  findChatRecordJumpTarget,
  findChatRecordJumpTargetHydrated,
  verifyChatJumpTarget,
} from '../src/lib/chatJump.ts'
import { getMessagesCache, saveMessagesCache } from '../src/lib/sessionStore.ts'

// localStorage / window mock（与现有 test_*.mjs 同款）：storage.ts / sessionStore.ts 在函数体内引用
const memStore = new Map()
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear(),
}
globalThis.window = { dispatchEvent: () => {} }

function resetStore() {
  memStore.clear()
}

let passed = 0
let failed = 0

function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ FAIL ${name}`)
  }
}

const SESSION_START_KEY = 'ai_companion_session_start'

// ---- 数据准备 ----
const msg = (role, content, ts) => ({ id: `x${ts}`, role, content, ts })
const uid = (content, ts) => ({ role: 'user', content, ts })

// ---- A：唯一 exact match ----
{
  resetStore()
  saveMessagesCache('A', [uid('我喜欢拿铁', 1000), msg('assistant', '记住啦', 1001), uid('你呢？', 2000)])
  const r = findChatRecordJumpTarget('A', '我喜欢拿铁')
  ok(r.status === 'unique', 'A unique：唯一 exact match → unique')
  ok(r.target && r.target.ts === 1000 && r.target.sessionId === 'A' && r.target.source === '我喜欢拿铁', 'A target 携带 sessionId/ts/source')
}

// ---- B：0 命中 ----
{
  resetStore()
  saveMessagesCache('A', [uid('今天天气不错', 1000)])
  const r = findChatRecordJumpTarget('A', '我喜欢拿铁')
  ok(r.status === 'not_found' && r.target === null, 'B not_found：聊天没有该句 → not_found')
}

// ---- B2：source 为空 ----
{
  resetStore()
  saveMessagesCache('A', [uid('我喜欢拿铁', 1000)])
  const r = findChatRecordJumpTarget('A', '   ')
  ok(r.status === 'not_found' && r.target === null, 'B2 空 source → not_found（不查）')
}

// ---- B3：sessionId 为空 ----
{
  resetStore()
  const r = findChatRecordJumpTarget(null, '我喜欢拿铁')
  ok(r.status === 'not_found' && r.target === null, 'B3 无 session → not_found（不跨角色）')
}

// ---- C：重复 source（同 session 两次） ----
{
  resetStore()
  saveMessagesCache('A', [uid('我喜欢拿铁', 1000), msg('assistant', '好', 1001), uid('我喜欢拿铁', 2000)])
  const r = findChatRecordJumpTarget('A', '我喜欢拿铁')
  ok(r.status === 'ambiguous' && r.target === null, 'C ambiguous：同 session 两次相同 → ambiguous，不跳第一条')
}

// ---- D：substring 禁止 ----
{
  resetStore()
  saveMessagesCache('A', [uid('我不喜欢拿铁', 1000), uid('我喜欢拿铁蛋糕', 2000)])
  const r = findChatRecordJumpTarget('A', '我喜欢拿铁')
  ok(r.status === 'not_found' && r.target === null, 'D substring 禁止：includes 命中不算 exact → not_found')
}

// ---- D2：前后空白 trim 后全等 ----
{
  resetStore()
  saveMessagesCache('A', [uid('  我喜欢拿铁  ', 1000)])
  const r = findChatRecordJumpTarget('A', '我喜欢拿铁')
  ok(r.status === 'unique' && r.target && r.target.ts === 1000, 'D2 trim 后全等 → unique（两端空白不破坏匹配）')
}

// ---- E：角色隔离 ----
{
  resetStore()
  saveMessagesCache('A', [uid('我喜欢拿铁', 1000)])
  saveMessagesCache('B', [uid('我喜欢拿铁', 3000)])
  const rA = findChatRecordJumpTarget('A', '我喜欢拿铁')
  ok(rA.status === 'unique' && rA.target && rA.target.sessionId === 'A' && rA.target.ts === 1000, 'E A 只查 A cache：命中 A 的那条')
  const rB = findChatRecordJumpTarget('B', '我喜欢拿铁')
  ok(rB.status === 'unique' && rB.target && rB.target.sessionId === 'B' && rB.target.ts === 3000, 'E B 只查 B cache：命中 B 的那条')
  // A 的会话起点过滤后，B 的消息绝不能进入 A 的结果
  const rA2 = findChatRecordJumpTarget('A', 'x')
  ok(rA2.status === 'not_found', 'E 不跨会话：A 查不到 B 的内容')
}

// ---- F：聊天记录不受 sessionStart 影响 ----
{
  resetStore()
  saveMessagesCache('A', [uid('我喜欢拿铁', 1000), uid('最近还好吗', 5000)])
  memStore.set(`${SESSION_START_KEY}_sid_A`, String(4000)) // 起点 4000：1000 那条 Chat 不渲染
  const rOld = findChatRecordJumpTarget('A', '我喜欢拿铁')
  ok(rOld.status === 'unique' && rOld.target?.ts === 1000, 'F 早于 sessionStart → 仍可定位完整聊天记录')
  const rNew = findChatRecordJumpTarget('A', '最近还好吗')
  ok(rNew.status === 'unique' && rNew.target && rNew.target.ts === 5000, 'F 晚于 sessionStart 同样可定位')
}

// ---- verifyChatJumpTarget：Chat 进入前二次校验 ----
{
  const target = { sessionId: 'A', ts: 1000, source: '我喜欢拿铁' }
  const same = [uid('我喜欢拿铁', 1000), msg('assistant', '好', 1001)]
  ok(verifyChatJumpTarget(target, 'A', same) === true, '二次校验 唯一命中（session+ts+content）→ true')

  ok(verifyChatJumpTarget(target, 'B', same) === false, '二次校验 session 变化 → false')
  ok(verifyChatJumpTarget(target, null, same) === false, '二次校验 无 session → false')
  ok(verifyChatJumpTarget(target, 'A', [uid('我喜欢拿铁', 999)]) === false, '二次校验 ts 不匹配 → false')
  ok(verifyChatJumpTarget(target, 'A', [uid('我喜欢拿铁蛋糕', 1000)]) === false, '二次校验 content 不匹配 → false')
  ok(verifyChatJumpTarget(target, 'A', [uid('我喜欢拿铁', 1000), uid('我喜欢拿铁', 1000)]) === false, '二次校验 多命中（含目标 ts）→ false')
  ok(verifyChatJumpTarget(target, 'A', [uid('我不喜欢拿铁', 1000)]) === false, '二次校验 内容不符 → false')
  ok(verifyChatJumpTarget(null, 'A', same) === false, '二次校验 空 target → false')
  ok(verifyChatJumpTarget(target, 'A', []) === false, '二次校验 消息清空（被删除）→ false')
}

// ---- G：不同 ts 的相同内容（校验必须 ts+content 双锁） ----
{
  const target = { sessionId: 'A', ts: 1000, source: '我喜欢拿铁' }
  const shifted = [uid('我喜欢拿铁', 2000)]
  ok(verifyChatJumpTarget(target, 'A', shifted) === false, 'ts 变化但内容相同 → false（不凭 content 就滚）')
}

// ---- H：pending jump 必须让第一次 auto-scroll 让位（源码级断言） ----
{
  const chatSrc = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
  const anchor = chatSrc.indexOf('el.scrollTop = el.scrollHeight')
  const effectStart = chatSrc.lastIndexOf('useEffect(() => {', anchor)
  const effectBody = chatSrc.slice(effectStart, anchor)
  ok(effectStart > -1 && effectBody.includes('jumpAtMountRef.current'), 'H1 auto-scroll effect 内先判 jumpAtMountRef（挂载期 pending jump）')
  ok(effectBody.includes('jumpHoldRef.current'), 'H2 auto-scroll effect 内同时判跳转保护窗口 jumpHoldRef')
  ok(effectBody.includes('jumpSuppressRef.current'), 'H3 auto-scroll effect 同时保留 jumpSuppressRef 让位')
  ok(
    /if \(jumpAtMountRef\.current \|\| jumpHoldRef\.current \|\| jumpSuppressRef\.current \|\| isChatJumpHolding\(\)\) return\s*\n\s*el\.scrollTop = el\.scrollHeight/.test(chatSrc),
    'H4 让位判断紧贴在 scroll-bottom 之前（先判断、后滚动）',
  )
  ok(
    chatSrc.includes('let chatJumpHoldUntil = 0') && chatSrc.includes('markChatJumpHold(2500)'),
    'H4b 跳转保护窗口用模块级时间戳（跨 dev StrictMode remount 存活，第一帧定位不被覆盖）',
  )
  ok(
    chatSrc.includes('const jumpAtMountRef = useRef(Boolean(pendingJump))') &&
      chatSrc.includes('const jumpHoldRef = useRef(Boolean(pendingJump))'),
    'H5 挂载时按 pendingJump 快照初始化（不依赖 effect 声明顺序）',
  )
  const releases = chatSrc.match(/releaseJumpHold\(\)/g) || []
  ok(releases.length >= 2, `H6 失败路径 / 用户发消息都会解除保护（实测 ${releases.length} 处）`)
  ok(
    /jumpHoldTimerRef\.current = window\.setTimeout\([\s\S]{0,200}?2500\)/.test(chatSrc),
    'H7 跳转成功后进入保护窗口（超时自动解除，不会永久压住滚到底）',
  )
  const jumpStart = chatSrc.indexOf('// UI2-03B-1「看原对话」：消费 App 传来的一次性 jump target。')
  const jumpEnd = chatSrc.indexOf('}, [pendingJump, activeSessionId])', jumpStart)
  const jumpRegion = jumpStart > -1 && jumpEnd > jumpStart ? chatSrc.slice(jumpStart, jumpEnd) : null
  ok(
    jumpRegion !== null &&
      !jumpRegion.includes('return () => {') &&
      !jumpRegion.includes('clearTimeout(jumpNoticeTimer'),
    'H8 jump effect 内不写 cleanup、不动提示定时器（pendingJump→null 不会把提示提前清掉）',
  )
  const appSrcNotice = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  ok(
    appSrcNotice.includes('pendingChatLogJump') && !appSrcNotice.includes('pendingJump={pendingChatJump}'),
    'H10 Memory 跳转已从当前 Chat 移到完整聊天记录',
  )
  const noSessionStart = chatSrc.indexOf('if (!activeSessionId) {')
  const noSessionEnd = chatSrc.indexOf('jumpHandledRef.current = true', noSessionStart)
  const noSessionRegion = noSessionStart > -1 && noSessionEnd > noSessionStart ? chatSrc.slice(noSessionStart, noSessionEnd) : null
  const failStart = chatSrc.indexOf('const fail = () => {')
  const failEnd = failStart > -1 ? chatSrc.indexOf('}', failStart) : -1
  const failRegion = failStart > -1 && failEnd > failStart ? chatSrc.slice(failStart, failEnd + 1) : null
  ok(
    noSessionRegion !== null &&
      noSessionRegion.includes('fail()') &&
      failRegion !== null &&
      failRegion.includes('onJumpConsumed?.()'),
    'H11 无 session 分支走统一失败路径并消费 pending（不残留 pendingChatJump）',
  )
  ok(
    failRegion !== null && failRegion.includes("onJumpNotice?.('暂时无法定位原对话')"),
    'H12 无 session 分支给出同样的轻量提示（统一上报 App）',
  )
  ok(
    /\}, \[pendingJump, activeSessionId\]\)/.test(chatSrc) && chatSrc.includes('visibleMessagesRef.current'),
    'H9 jump effect 只依赖 pendingJump/session，消息列表走 ref（避免消息更新触发 cleanup）',
  )
}

// ---- I：DOM 定位必须锁 user role（源码级断言 + 纯逻辑） ----
{
  const chatSrc = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
  const bubbleSrc = readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')
  ok(
    chatSrc.includes('`[data-msg-role="user"][data-msg-ts="${ts}"]`'),
    'I1 querySelector 同时锁 data-msg-role="user" 与 data-msg-ts',
  )
  ok(
    !/querySelector<HTMLElement>\(\s*`\[data-msg-ts=/.test(chatSrc),
    'I2 不再存在只按 data-msg-ts 定位的旧写法',
  )
  ok(bubbleSrc.includes('data-msg-ts={message.ts}'), 'I3 MessageBubble 仍渲染 data-msg-ts')
  ok(bubbleSrc.includes('data-msg-role={message.role}'), 'I4 MessageBubble 仍渲染 data-msg-role')

  // 同 ts 下存在 assistant 行 → 业务判定与 DOM 一样只认 user 行，不产生歧义
  resetStore()
  saveMessagesCache('A', [uid('我喜欢拿铁', 1000), msg('assistant', '我喜欢拿铁', 1000)])
  const r = findChatRecordJumpTarget('A', '我喜欢拿铁')
  ok(r.status === 'unique' && r.target && r.target.ts === 1000, 'I5 同 ts 同内容的 assistant 行不算命中（仍 unique）')
  ok(verifyChatJumpTarget({ sessionId: 'A', ts: 1000, source: '我喜欢拿铁' }, 'A', [uid('我喜欢拿铁', 1000), msg('assistant', '我喜欢拿铁', 1000)]) === true, 'I6 二次校验同样只认 user 行 → true')

  // 同 ts 两条 user（异常数据）→ 依旧不跳
  ok(verifyChatJumpTarget({ sessionId: 'A', ts: 1000, source: '我喜欢拿铁' }, 'A', [uid('我喜欢拿铁', 1000), uid('我喜欢拿铁', 1000)]) === false, 'I7 同 ts 两条 user → 不跳（多命中）')
}

// ---- J：B/C 与 notice 修复的源码契约（防回归） ----
{
  const chatSrc = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
  const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

  // B/C：首次 jump 必须 paint 前 instant 定位
  ok(chatSrc.includes('useLayoutEffect('), 'J1 Chat 用 useLayoutEffect 执行首次 jump')
  ok(
    /scrollIntoView\(\{\s*block:\s*'center',\s*behavior:\s*'auto'\s*\}\)/.test(chatSrc),
    "J2 首次定位 behavior: 'auto'（instant）",
  )
  ok(!chatSrc.includes("behavior: 'smooth'"), 'J3 首次跳转不再用 smooth')
  const jumpEffectStart = chatSrc.indexOf('useLayoutEffect(() => {')
  const jumpEffectEnd = chatSrc.indexOf('  useEffect(() => {', jumpEffectStart)
  const jumpEffectSrc =
    jumpEffectStart >= 0 && jumpEffectEnd > jumpEffectStart
      ? chatSrc.slice(jumpEffectStart, jumpEffectEnd)
      : ''
  ok(
    jumpEffectSrc.length > 0 && !jumpEffectSrc.includes('requestAnimationFrame'),
    'J4 jump effect 已移除双 rAF 延迟（Chat 其他交互可独立使用 rAF）',
  )

  // 失败路径：consume + 上报（App 展示）
  ok(chatSrc.includes("onJumpNotice?.('暂时无法定位原对话')"), 'J5 失败时上报提示文本')
  ok(!chatSrc.includes('showJumpNotice'), 'J6 Chat 不再本地展示 notice')
  ok(!chatSrc.includes('jumpNoticeTimer'), 'J7 Chat 不再本地持 notice timer')

  // App：直达聊天记录，并保留原 Memory Detail 返回目标
  const profileSrc = readFileSync(new URL('../src/components/ChatProfile.tsx', import.meta.url), 'utf8')
  const logsSrc = readFileSync(new URL('../src/components/SpaceChatLogs.tsx', import.meta.url), 'utf8')
  ok(appSrc.includes('pendingChatLogJump') && appSrc.includes('pendingMemoryReturn'), 'J8 App 同时持有聊天记录目标与原 Memory 返回目标')
  ok(
    appSrc.includes("goView('chatprofile')") && appSrc.includes("setDetailFrom('memory')"),
    'J9 看原对话直达 ChatProfile，并记录来源为 Memory',
  )
  ok(
    profileSrc.includes("initialPage = 'home'") && profileSrc.includes('jumpTarget={chatLogTarget}') &&
      logsSrc.includes('data-log-msg-ts={m.ts}') && logsSrc.includes("el.classList.add('msg-jump-highlight')"),
    'J10 ChatProfile 直开聊天记录；当天回放按 ts 定位并高亮',
  )
  ok(
    appSrc.includes('if (pendingChatLogJump) {') && appSrc.includes('window.history.back()') &&
      /onInitialDetailConsumed=\{\(\) => \{[\s\S]{0,160}setPendingMemoryReturn\(null\)[\s\S]{0,160}setPendingChatLogJump\(null\)/.test(appSrc),
    'J11 页内返回/浏览器返回都回 Memory，恢复原 Detail 后清理两个临时目标',
  )
  ok(
    logsSrc.includes("onClick={() => (jumpTarget ? onBack() : setLogDayKey(null))}") &&
      logsSrc.includes("{jumpTarget ? '返回记忆' : '返回聊天记录'}"),
    'J12 定向回放的顶部与底部返回都指向原 Memory；普通入口仍回聊天记录',
  )
}


// ---- K：刷新后本地消息缓存为空 → 从后端补拉当前 session 后再定位 ----
{
  resetStore()
  let calls = 0
  globalThis.fetch = async (url, init = {}) => {
    calls++
    ok(String(url).includes('/api/sessions/A'), 'K1 只补拉当前 session A')
    ok((init.headers?.Authorization ?? init.headers?.authorization) === 'Bearer token-A', 'K2 携带当前登录 token')
    return new Response(JSON.stringify({
      session: { id: 1, title: 'TA', persona: '', created_at: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
      messages: [
        { id: 1, role: 'user', content: '刷新后也要找得到', createdAt: '2026-09-01T10:00:00.000Z' },
        { id: 2, role: 'assistant', content: '我记得。', createdAt: '2026-09-01T10:00:01.000Z' },
      ],
      memories: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const before = findChatRecordJumpTarget('A', '刷新后也要找得到')
  ok(before.status === 'not_found', 'K3 补拉前本地缓存为空 → not_found')
  const hydrated = await findChatRecordJumpTargetHydrated('A', '刷新后也要找得到', 'token-A')
  ok(hydrated.status === 'unique' && hydrated.target?.sessionId === 'A', 'K4 补拉后重新 exact-match → unique')
  ok(getMessagesCache('A').some((m) => m.role === 'user' && m.content === '刷新后也要找得到'), 'K5 云端消息写回当前 session 缓存')
  ok(calls === 1, 'K6 只请求一次后端')
}

// ---- K2：云端原始消息同一句出现两次 → 必须保持 ambiguous，不能被 merge 去重后误判 unique ----
{
  resetStore()
  globalThis.fetch = async () => new Response(JSON.stringify({
    session: { id: 1, title: 'TA', persona: '', created_at: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    messages: [
      { id: 1, role: 'user', content: '这句话说过两次', createdAt: '2026-09-01T10:00:00.000Z' },
      { id: 2, role: 'assistant', content: '第一次回应', createdAt: '2026-09-01T10:00:01.000Z' },
      { id: 3, role: 'user', content: '这句话说过两次', createdAt: '2026-09-02T10:00:00.000Z' },
      { id: 4, role: 'assistant', content: '第二次回应', createdAt: '2026-09-02T10:00:01.000Z' },
    ],
    memories: [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const hydrated = await findChatRecordJumpTargetHydrated('A', '这句话说过两次', 'token-A')
  ok(hydrated.status === 'ambiguous' && hydrated.target === null, 'K7 云端原始列表重复 source → ambiguous，不猜哪一次')
}

// ---- L：本地 unique 仍用云端完整记录确认唯一性 ----
{
  resetStore()
  saveMessagesCache('A', [uid('本地已经有', 1000)])
  let called = false
  globalThis.fetch = async () => {
    called = true
    return new Response(JSON.stringify({
      session: { id: 1, title: 'TA', persona: '', created_at: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
      messages: [
        { id: 1, role: 'user', content: '本地已经有', createdAt: '2026-09-01T10:00:00.000Z' },
        { id: 2, role: 'user', content: '本地已经有', createdAt: '2026-09-02T10:00:00.000Z' },
      ],
      memories: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const hydrated = await findChatRecordJumpTargetHydrated('A', '本地已经有', 'token-A')
  ok(hydrated.status === 'ambiguous', 'L1 云端完整记录发现重复 → ambiguous')
  ok(called === true, 'L2 本地 unique 仍补拉云端确认，不把不完整缓存当全量')
}

console.log(`\nchatJump: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
