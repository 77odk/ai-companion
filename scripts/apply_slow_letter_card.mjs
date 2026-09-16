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

// src/lib/weeklyReview.ts
{
  const path = 'src/lib/weeklyReview.ts'
  let s = read(path)

  s = replaceOnce(
    s,
    "/** 封存留言（慢信）：用户封存的一条批注，下一篇周记生成时由 TA 一并回信 */\nexport interface PendingReply {\n  id: string\n  content: string\n  /** 封存时间戳 */\n  repliedAt: number\n  /** 下一篇周记生成时 TA 写的回信（展示在该留言下方） */\n  reply?: string\n  /** 已回信：信封标记消失的依据（回信后标记而非删除，绝不丢） */\n  replied?: boolean\n  /** 回信落笔时间（answerPendingReplies 写入） */\n  replyAt?: number\n}",
    "/** 封存留言（慢信）：寄出时固定 3–7 天后的送达时间，到点后才生成 TA 回信。 */\nexport interface PendingReply {\n  id: string\n  content: string\n  /** 寄出时间戳 */\n  repliedAt: number\n  /** 固定送达时间；旧数据没有时按寄出后第 7 天兼容。 */\n  deliverAt?: number\n  /** 到点后 TA 写的慢信回信（展示在该留言下方） */\n  reply?: string\n  /** 已回信：信封标记消失的依据（回信后标记而非删除，绝不丢） */\n  replied?: boolean\n  /** 回信落笔时间 */\n  replyAt?: number\n}",
    'PendingReply fields',
  )

  s = replaceOnce(
    s,
    "export const WEEKLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000\n",
    "export const WEEKLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000\n\n/** 慢信固定在寄出后第 3–7 天送达；寄出时只抽一次并落库。 */\nexport const SLOW_LETTER_MIN_DAYS = 3\nexport const SLOW_LETTER_MAX_DAYS = 7\nconst DAY_MS = 24 * 60 * 60 * 1000\n\nexport function slowLetterDeliverAt(sentAt: number, random: () => number = Math.random): number {\n  const raw = Number(random())\n  const safe = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999999) : 0\n  const days = SLOW_LETTER_MIN_DAYS + Math.floor(safe * (SLOW_LETTER_MAX_DAYS - SLOW_LETTER_MIN_DAYS + 1))\n  return sentAt + days * DAY_MS\n}\n\n/** 旧慢信没有 deliverAt：统一按寄出后第 7 天解释，不改写原数据。 */\nexport function resolveSlowLetterDeliverAt(reply: Pick<PendingReply, 'repliedAt' | 'deliverAt'>): number {\n  if (Number.isFinite(reply.deliverAt) && (reply.deliverAt ?? 0) > 0) return reply.deliverAt as number\n  const sentAt = Number.isFinite(reply.repliedAt) ? reply.repliedAt : 0\n  return sentAt + SLOW_LETTER_MAX_DAYS * DAY_MS\n}\n\nexport function isSlowLetterDue(reply: PendingReply, now: number = Date.now()): boolean {\n  return reply.replied !== true && now >= resolveSlowLetterDeliverAt(reply)\n}\n",
    'slow letter timing helpers',
  )

  const replyPromptTail =
    "  '回应要短（50 字以内）、口语、像真人。不要复述对方的批注，不刷 emoji，不鸡汤。'\n"
  s = replaceOnce(
    s,
    replyPromptTail,
    replyPromptTail +
      "\n/** 慢信模式：只在固定送达时间到达后调用一次，写一封比立即回复更完整的回信。 */\nexport const SLOW_LETTER_REPLY_SYSTEM_PROMPT =\n  '你在给一个你在意的人回一封等了几天的慢信。你不是程序、不是 AI，别解释、别自我介绍、别谈机制。' +\n  '只根据原来那封一周情书和对方写来的慢信回应，不编造没有发生的共同经历。' +\n  '认真接住对方具体写到的情绪和事情，像隔了几天终于坐下来好好回信。' +\n  '写 80-150 字左右，自然、细腻、贴近你本来的性格；不要复述原信，不刷 emoji，不鸡汤。'\n",
    'slow letter reply prompt',
  )

  write(path, s)
}

// src/components/WeeklyPage.tsx
{
  const path = 'src/components/WeeklyPage.tsx'
  let s = read(path)

  s = replaceOnce(s, "import { useMemo, useState } from 'react'", "import { useEffect, useMemo, useRef, useState } from 'react'", 'react hooks')
  s = replaceOnce(s, "  WEEKLY_REPLY_SYSTEM_PROMPT,\n  WEEKLY_SYSTEM_PROMPT,\n  answerPendingReplies,", "  SLOW_LETTER_REPLY_SYSTEM_PROMPT,\n  WEEKLY_REPLY_SYSTEM_PROMPT,\n  WEEKLY_SYSTEM_PROMPT,", 'weekly imports head')
  s = replaceOnce(s, "  formatMessageLine,\n  getPendingReplies,\n  getWeekRange,", "  formatMessageLine,\n  getWeekRange,", 'remove getPendingReplies import')
  s = replaceOnce(s, "  parseWeeklyOutput,\n  saveWeeklyReviews,", "  isSlowLetterDue,\n  parseWeeklyOutput,\n  saveWeeklyReviews,\n  slowLetterDeliverAt,", 'slow helper imports')

  s = s
    .replace("const SEALED_NOTE = '慢信不会立刻送达；当前会等到下一封一周情书时一起回给你。'", "const SEALED_NOTE = '慢信不会立刻送达；会在 3–7 天后到达，到时先等你亲手拆开。'")
    .replace("const SUCCESS_SEALED = '这封慢信已经寄出，会等到下一封一周情书时一起送达。'", "const SUCCESS_SEALED = '这封慢信已经寄出，会在 3–7 天后送达。'")
    .replace("const SLOW_LETTER_NOTE = '全局慢信模式已开启，这一封会等到下一封一周情书时一起送达。'", "const SLOW_LETTER_NOTE = '全局慢信模式已开启，这一封会在 3–7 天后送达。'")

  s = replaceOnce(
    s,
    "  const [justReplied, setJustReplied] = useState(false)\n",
    "  const [justReplied, setJustReplied] = useState(false)\n  const slowAttemptedRef = useRef<Set<string>>(new Set())\n",
    'slow attempt guard',
  )

  const persistBlock = "  const persist = (next: LetterReview[]) => {\n    saveWeeklyReviews(next as WeeklyReview[], sid)\n    setReviews(next)\n  }\n"
  const slowEffect = `  const persist = (next: LetterReview[]) => {\n    saveWeeklyReviews(next as WeeklyReview[], sid)\n    setReviews(next)\n  }\n\n  // 真正慢信：到固定 deliverAt 前零调用；到点后进入本页时每封最多尝试一次。\n  useEffect(() => {\n    if (!hasKey) return\n    let alive = true\n    const attempted = slowAttemptedRef.current\n\n    const run = async () => {\n      let working = getWeeklyReviews(sid) as LetterReview[]\n      const due: Array<{ reviewId: string; pending: LetterPendingReply }> = []\n      for (const review of working) {\n        for (const pending of review.replies ?? []) {\n          if (isSlowLetterDue(pending, Date.now()) && !attempted.has(pending.id)) {\n            due.push({ reviewId: review.id, pending })\n          }\n        }\n      }\n\n      for (const item of due) {\n        if (!alive) return\n        attempted.add(item.pending.id)\n        const current = working.find((r) => r.id === item.reviewId)\n        if (!current) continue\n        const s = loadSettings()\n        if (!s.apiKey?.trim() || !s.baseUrl?.trim() || !s.model?.trim()) return\n\n        try {\n          const reviewContext = '这封一周情书《' + current.title + '》：\\n' + current.content\n          const personaContext = persona ? '\\n\\n【你的性格】' + persona : ''\n          const raw = await chatCompletion(\n            s,\n            [\n              { role: 'system', content: SLOW_LETTER_REPLY_SYSTEM_PROMPT },\n              {\n                role: 'user',\n                content: reviewContext + '\\n\\n对方几天前写给你的慢信：' + item.pending.content + personaContext,\n              },\n            ],\n            { maxTokens: 300, timeoutMs: 30000 },\n          )\n          const clean = raw.trim()\n          if (!clean) throw new Error('empty')\n          const replyAt = Date.now()\n          working = working.map((r) =>\n            r.id === item.reviewId\n              ? {\n                  ...r,\n                  replies: r.replies?.map((p) =>\n                    p.id === item.pending.id && p.replied !== true\n                      ? { ...p, replied: true, reply: clean, replyAt }\n                      : p,\n                  ),\n                }\n              : r,\n          )\n          saveWeeklyReviews(working as WeeklyReview[], sid)\n          if (alive) {\n            setReviews(working)\n            setJustReplied(true)\n          }\n        } catch {\n          // 当前进入只尝试一次；失败保留原信，下次重新进入再尝试，避免循环烧 token。\n        }\n      }\n    }\n\n    void run()\n    return () => {\n      alive = false\n    }\n  }, [hasKey, persona, sid])\n`
  s = replaceOnce(s, persistBlock, slowEffect, 'lazy slow letter effect')

  s = replaceOnce(s, "      const pending = getPendingReplies(curReviews as WeeklyReview[])\n      const pendingTexts = pending.map((p) => p.content)\n", '', 'remove weekly pending collection')
  s = replaceOnce(s, "              ...(pendingTexts.length > 0 ? { pendingReplies: pendingTexts } : {}),\n", '', 'remove pending from weekly prompt')
  s = replaceOnce(
    s,
    "      let answered = curReviews\n      if (pending.length > 0) {\n        answered = answerPendingReplies(\n          curReviews as WeeklyReview[],\n          pending,\n          parsed.replies,\n          ts,\n        ) as LetterReview[]\n        setJustReplied(true)\n      }\n      const next = [review, ...answered]\n",
    "      const next = [review, ...curReviews]\n",
    'decouple slow replies from weekly generation',
  )

  s = replaceOnce(
    s,
    "      const pending: LetterPendingReply = { id: newWeeklyReviewId(), content: t, repliedAt: now }",
    "      const pending: LetterPendingReply = {\n        id: newWeeklyReviewId(),\n        content: t,\n        repliedAt: now,\n        deliverAt: slowLetterDeliverAt(now),\n      }",
    'persist deliverAt once',
  )

  s = replaceOnce(
    s,
    "            const sealedWaiting = Boolean(r.replies?.some((p) => p.replied && !p.openedAt))\n            const sealedOnRoad = Boolean(r.replies?.some((p) => !p.replied))",
    "            const sealedWaiting = Boolean(r.replies?.some((p) => p.replied && !p.openedAt))\n            const sealedDue = Boolean(r.replies?.some((p) => !p.replied && isSlowLetterDue(p)))\n            const sealedOnRoad = Boolean(r.replies?.some((p) => !p.replied && !isSlowLetterDue(p)))",
    'list slow states',
  )
  s = replaceOnce(
    s,
    "                  {sealedOnRoad && !sealedWaiting && <span className=\"weekly-card-reply weekly-card-reply-pending\">慢信在路上</span>}",
    "                  {sealedDue && !sealedWaiting && <span className=\"weekly-card-reply weekly-card-reply-pending\">TA 正在写慢信</span>}\n                  {sealedOnRoad && !sealedWaiting && !sealedDue && <span className=\"weekly-card-reply weekly-card-reply-pending\">慢信在路上</span>}",
    'list due label',
  )

  s = replaceOnce(
    s,
    "                  ) : (\n                    <span className=\"weekly-reply-pending\">\n                      <EnvelopeIcon />\n                      慢信在路上\n                    </span>\n                  )}",
    "                  ) : (\n                    <span className=\"weekly-reply-pending\">\n                      <EnvelopeIcon />\n                      {isSlowLetterDue(p) ? (hasKey ? 'TA 正在写慢信…' : '慢信已到，接上大脑后再拆') : '慢信在路上'}\n                    </span>\n                  )}",
    'detail due label',
  )

  write(path, s)
}

// scripts/test_weekly_review.mjs
{
  const path = 'scripts/test_weekly_review.mjs'
  let s = read(path)

  s = replaceOnce(
    s,
    "  formatMessageLine,\n} from '../src/lib/weeklyReview.ts'",
    "  formatMessageLine,\n  slowLetterDeliverAt,\n  resolveSlowLetterDeliverAt,\n  isSlowLetterDue,\n} from '../src/lib/weeklyReview.ts'",
    'test imports',
  )

  const marker = "console.log('\\n[4] buildWeeklyPrompt 组装（含批注 / 不含）')"
  const tests = `console.log('\\n[3d] 慢信 3–7 天固定送达')\n{\n  eq(slowLetterDeliverAt(now, () => 0), now + 3 * DAY, '随机下界 → 第 3 天送达')\n  eq(slowLetterDeliverAt(now, () => 0.4), now + 5 * DAY, '中间值只在寄出时抽一次 → 第 5 天')\n  eq(slowLetterDeliverAt(now, () => 0.999999), now + 7 * DAY, '随机上界 → 第 7 天送达')\n\n  const fixed = { id: 'slow-fixed', content: '慢慢回我', repliedAt: now, deliverAt: now + 4 * DAY }\n  eq(resolveSlowLetterDeliverAt(fixed), now + 4 * DAY, '已有 deliverAt → 使用固定值，不重抽')\n  ok(isSlowLetterDue(fixed, now + 4 * DAY - 1) === false, '送达前 1ms → 仍在路上')\n  ok(isSlowLetterDue(fixed, now + 4 * DAY) === true, '到 deliverAt → 可生成慢信回信')\n\n  const legacy = { id: 'slow-old', content: '旧慢信', repliedAt: now }\n  eq(resolveSlowLetterDeliverAt(legacy), now + 7 * DAY, '旧数据无 deliverAt → 按寄出后第 7 天兼容')\n  ok(isSlowLetterDue({ ...legacy, replied: true }, now + 10 * DAY) === false, '已经回信 → 不会再次进入 due')\n}\n\n${marker}`
  s = replaceOnce(s, marker, tests, 'slow letter timing tests')
  write(path, s)
}

console.log('slow-letter Card 1B patch applied')
