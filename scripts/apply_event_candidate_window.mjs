import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function write(path, content) {
  fs.writeFileSync(path, content)
}

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before)
  if (first < 0) throw new Error(`missing patch target: ${label}`)
  if (content.indexOf(before, first + before.length) >= 0) throw new Error(`patch target not unique: ${label}`)
  return content.slice(0, first) + after + content.slice(first + before.length)
}

// src/lib/eventDetector.ts
{
  const path = 'src/lib/eventDetector.ts'
  let s = read(path)

  s = replaceOnce(
    s,
    "// Event 识别（E2）：粗筛 → 额度 → LLM 精判 → 硬过滤 → createEvent\n// 2026-09-11。成本控制：只有「共同主体 + 已发生动作」双命中的候选才消耗额度精判；\n// 明显未来/不确定表达先于一切直接 false（不耗额度）；每 session + 设备本地日期每天最多 3 次精判；\n// 模型返回严格 JSON，一次调用记一次额度（不管 true/false）；解析失败不创建不重试；无 key 静默跳过。",
    "// Event 识别（E2 / UI2-04 Card 3）：本地候选窗口 → 额度 → LLM 精判 → 硬过滤 → createEvent\n// 成本控制：当前用户消息必须提供事件信号；最多只拼当前 + 最近 2 条用户原话做粗筛/精判。\n// TA 文本绝不进入证据窗口；明显未来/不确定表达先于一切直接 false（不耗额度）；\n// 每 session + 设备本地日期每天最多 3 次精判；模型返回严格 JSON，解析失败不创建不重试。",
    'detector header',
  )

  const coarseBlock = `/** 粗筛：必须同时命中「共同主体」和「已发生动作」 */\nexport function coarsePass(text: string): boolean {\n  const t = typeof text === 'string' ? text.trim() : ''\n  if (!t) return false\n  return SUBJECT_RE.test(t) && ACTION_RE.test(t)\n}\n`
  const coarseReplacement = `/** 粗筛：必须同时命中「共同主体」和「已发生动作」 */\nexport function coarsePass(text: string): boolean {\n  const t = typeof text === 'string' ? text.trim() : ''\n  if (!t) return false\n  return SUBJECT_RE.test(t) && ACTION_RE.test(t)\n}\n\n/** Candidate Window：只允许当前 + 最近 2 条用户原话，避免整段聊天送去精判。 */\nexport const EVENT_CANDIDATE_WINDOW_SIZE = 3\nexport const EVENT_CANDIDATE_TEXT_MAX = 240\n\nfunction compactCandidateText(text: string): string {\n  return (typeof text === 'string' ? text.trim() : '').slice(0, EVENT_CANDIDATE_TEXT_MAX)\n}\n\nexport function buildEventCandidateWindow(userText: string, recentUserTexts: string[] = []): string[] {\n  const current = compactCandidateText(userText)\n  if (!current) return []\n  const prior = (Array.isArray(recentUserTexts) ? recentUserTexts : [])\n    .map(compactCandidateText)\n    .filter(Boolean)\n    .slice(-(EVENT_CANDIDATE_WINDOW_SIZE - 1))\n  return [...prior, current]\n}\n\n/**\n * 窗口粗筛：\n * - 当前句本身命中，沿用旧行为；\n * - 当前句没完整命中时，只有它自己至少带一个事件信号，才允许借最近用户原话补齐主体/动作；\n * - 「嗯 / 哈哈」之类无信号消息不会拿旧候选反复消耗额度。\n */\nexport function coarsePassCandidateWindow(userText: string, recentUserTexts: string[] = []): boolean {\n  const current = compactCandidateText(userText)\n  if (!current || isNegativeExpression(current)) return false\n  if (coarsePass(current)) return true\n  const currentHasSignal =\n    SUBJECT_RE.test(current) || ACTION_RE.test(current) || TIME_BONUS_RE.test(current) || RELATION_BONUS_RE.test(current)\n  if (!currentHasSignal) return false\n  const window = buildEventCandidateWindow(current, recentUserTexts)\n  if (window.length < 2) return false\n  return coarsePass(window.join('\\n'))\n}\n\n/** 给精判模型的输入：明确标成「用户原话」，最后一条是当前触发消息。 */\nexport function buildEventCandidateUserPrompt(userText: string, recentUserTexts: string[] = []): string {\n  const window = buildEventCandidateWindow(userText, recentUserTexts)\n  return (\n    '【用户原话窗口】\\n' +\n    window.map((line, i) => '用户原话' + (i + 1) + '：' + line).join('\\n') +\n    '\\n【判定约束】最后一条是当前消息。只允许把这些相邻用户原话中明确属于同一件事的信息合起来判断；不同事情不能拼接。'\n  )\n}\n`
  s = replaceOnce(s, coarseBlock, coarseReplacement, 'candidate-window helpers')

  s = replaceOnce(
    s,
    "    '- 不是总结记忆、不是推测历史、不是根据上下文脑补；只看这一句话本身是否明确表达。\\n' +",
    "    '- 不是总结记忆、不是推测历史、不是根据记忆或 TA 的话脑补；只看传入的【用户原话窗口】。窗口最多三条，全部是用户原话。\\n' +\n    '- 可以合并窗口内相邻用户原话来补齐同一件事的主体/动作/时间，但只要无法确定它们说的是同一件事，就必须 isEvent=false；不同事情绝不能拼接。\\n' +",
    'judge prompt window rule',
  )

  s = replaceOnce(
    s,
    "export async function processEventCandidate(input: {\n  sessionId?: string\n  userText: string\n  now?: number\n}): Promise<void> {",
    "export async function processEventCandidate(input: {\n  sessionId?: string\n  userText: string\n  /** Chat 只传最近相邻的用户原话；TA 文本不得进入。 */\n  recentUserTexts?: string[]\n  now?: number\n}): Promise<void> {",
    'process input',
  )

  s = replaceOnce(
    s,
    "    // 2 粗筛（主体 + 已发生动作 双命中才算候选）\n    if (!coarsePass(text)) return",
    "    // 2 Candidate Window 粗筛：当前句必须提供事件信号；最多借最近 2 条用户原话补齐。\n    if (!coarsePassCandidateWindow(text, input.recentUserTexts ?? [])) return",
    'process coarse pass',
  )

  s = replaceOnce(
    s,
    "        { role: 'system', content: buildEventJudgeSystemPrompt(now) },\n        { role: 'user', content: text },",
    "        { role: 'system', content: buildEventJudgeSystemPrompt(now) },\n        { role: 'user', content: buildEventCandidateUserPrompt(text, input.recentUserTexts ?? []) },",
    'process judge payload',
  )

  write(path, s)
}

// src/components/Chat.tsx
{
  const path = 'src/components/Chat.tsx'
  let s = read(path)
  s = replaceOnce(
    s,
    "    // Event（E3 一处）：用户消息落库后异步跑识别（粗筛→额度→精判→硬过滤），不阻塞、失败静默\n    void processEventCandidate({\n      sessionId: activeSessionId || undefined,\n      userText: userMsg.content,\n      now: userMsg.ts,\n    })",
    "    // Event Candidate Window：只带最近 6 条聊天里最多 2 条历史用户原话；TA 文本永不作为 Event 证据。\n    // 本地粗筛仍先跑，只有命中才会消耗每天最多 3 次的精判额度。\n    const recentEventUserTexts = visibleMessages\n      .slice(-6)\n      .filter((m) => m.role === 'user')\n      .slice(-2)\n      .map((m) => m.content)\n    void processEventCandidate({\n      sessionId: activeSessionId || undefined,\n      userText: userMsg.content,\n      recentUserTexts: recentEventUserTexts,\n      now: userMsg.ts,\n    })",
    'chat candidate-window wiring',
  )
  write(path, s)
}

// scripts/test_event_detector.mjs
{
  const path = 'scripts/test_event_detector.mjs'
  let s = read(path)

  s = replaceOnce(
    s,
    "  coarsePass,\n  localDateKey,",
    "  coarsePass,\n  buildEventCandidateWindow,\n  coarsePassCandidateWindow,\n  buildEventCandidateUserPrompt,\n  EVENT_CANDIDATE_WINDOW_SIZE,\n  EVENT_CANDIDATE_TEXT_MAX,\n  localDateKey,",
    'test imports',
  )

  const marker = "console.log('\\n[4] 负向过滤（先于一切，不耗额度）')"
  const section = `console.log('\\n[3a] Candidate Window：最多 3 条用户原话，当前消息必须贡献信号')\n{\n  const w = buildEventCandidateWindow('昨天', ['第一条', '第二条', '我们一起吃了饭'])\n  ok(w.length === EVENT_CANDIDATE_WINDOW_SIZE, '窗口最多 3 条（最近 2 条 + 当前）')\n  ok(w[0] === '第二条' && w[2] === '昨天', '超出窗口时丢最旧，只保留相邻用户原话')\n\n  const long = '啊'.repeat(EVENT_CANDIDATE_TEXT_MAX + 20)\n  ok(buildEventCandidateWindow(long, [long]).every((x) => x.length === EVENT_CANDIDATE_TEXT_MAX), '单条候选截到固定上限，控制输入 token')\n\n  ok(coarsePassCandidateWindow('昨天', ['我们一起吃了饭']) === true, '跨两条：前句有主体+动作，当前补时间 → 候选')\n  ok(coarsePassCandidateWindow('去了海边', ['昨天我们']) === true, '跨两条：前句主体，当前补已发生动作 → 候选')\n  ok(coarsePassCandidateWindow('哈哈', ['我们昨天一起看了电影']) === false, '当前无事件信号 → 不拿旧候选重复触发')\n  ok(coarsePassCandidateWindow('以后我们一起去巴黎', ['我们昨天一起看了电影']) === false, '当前明显未来表达 → 窗口也直接拦截')\n\n  const p = buildEventCandidateUserPrompt('昨天', ['我们一起吃了饭'])\n  ok(p.includes('用户原话1：我们一起吃了饭') && p.includes('用户原话2：昨天'), '精判输入只标记用户原话窗口')\n  ok(p.includes('不同事情不能拼接'), '精判输入明确禁止跨事件拼接')\n}\n\n${marker}`
  s = replaceOnce(s, marker, section, 'candidate-window tests')

  s = replaceOnce(
    s,
    "  ok(p.includes('不是总结记忆') && p.includes('绝不根据记忆或计划推断事件'), 'Prompt 含不总结/不推断硬规则')",
    "  ok(p.includes('不是总结记忆') && p.includes('绝不根据记忆或计划推断事件'), 'Prompt 含不总结/不推断硬规则')\n  ok(p.includes('用户原话窗口') && p.includes('不同事情绝不能拼接'), 'Prompt 限定 Candidate Window 且禁止拼接不同事件')",
    'prompt test extension',
  )

  write(path, s)
}

console.log('event Candidate Window Card 3 patch applied')
