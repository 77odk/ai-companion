// TA 的空间 · 动态引擎（localStorage 读写 + 对外入口）
// 纯逻辑都在 aiSpaceCore.ts / aiSpaceLlm.ts（可被 Node 单测），本文件只负责存取与组装。
// 生成路径分三态：
//   llm      有人设 + 有 key：先推进 lastVisit 占位，新动态由 LLM 异步生成（失败降级模板）
//   template 有人设但没 key：直接用现有模板同步生成
//   no-persona 没人设：不调 LLM，模板兜底生成 1 条保证空间不空，其余交给引导

import {
  advanceTimeline,
  planBackfillTimestamps,
  dayKeyOf,
  getSeason,
  getTimeWord,
  pickWeatherWord,
  generatePost,
  mergeNewPosts,
  MAX_POSTS,
  MAX_POSTS_PER_DAY,
  pickReplyFallback,
  KIND_KEYS,
  type SpacePost,
  type SpaceState,
  type SpaceComment,
  type TemplateVar,
  type UsedTemplates,
} from './aiSpaceCore.ts'
import {
  canUseLlm,
  cleanLlmText,
  guessKind,
  buildLlmMessages,
  buildLlmPost,
  buildReplyMessages,
  extractImageCaption,
} from './aiSpaceLlm.ts'
import { loadChatTopics } from './chatTopics.ts'
import { chatCompletion } from './api.ts'
import { notifyDataChanged } from './dataChange.ts'
import { loadPersona, loadSettings } from './storage.ts'
import { getDefaultSessionId, getSessionsCache } from './sessionStore.ts'
import { migrateGlobalToDefaultSession } from './roleData.ts'

const POSTS_KEY = 'ai_space_posts'
const LAST_VISIT_KEY = 'ai_space_last_visit'
const USED_KEY = 'ai_space_used_templates'
// TASK-UI2 角色隔离：按会话分 key（ai_space_posts_<sid> 等），无会话回落全局 key（兼容老逻辑）。
const postsKey = (sessionId?: string) => (sessionId ? `${POSTS_KEY}_${sessionId}` : POSTS_KEY)
const lastVisitKey = (sessionId?: string) => (sessionId ? `${LAST_VISIT_KEY}_${sessionId}` : LAST_VISIT_KEY)
const usedKey = (sessionId?: string) => (sessionId ? `${USED_KEY}_${sessionId}` : USED_KEY)
/** 老全局动态已迁移到默认角色 key 的标记（防重复迁移） */
const SPACE_MIGRATED_KEY = 'ai_space_migrated'

/** 首次按会话读取时，把老全局动态迁到「默认角色」名下（TASK-UI2）；lastVisit/used 跟着挪（挪完即空，天然幂等） */
function ensureSessionSpaceData(sessionId?: string): void {
  if (!sessionId) return
  migrateGlobalToDefaultSession(POSTS_KEY, postsKey, SPACE_MIGRATED_KEY)
  try {
    const defSid = getDefaultSessionId()
    if (!defSid) return
    for (const pair of [
      [LAST_VISIT_KEY, lastVisitKey],
      [USED_KEY, usedKey],
    ] as const) {
      const raw = localStorage.getItem(pair[0])
      if (raw != null && localStorage.getItem(pair[1](defSid)) == null) {
        localStorage.setItem(pair[1](defSid), raw)
        localStorage.removeItem(pair[0])
      }
    }
  } catch {
    // 迁移失败不阻塞：数据留在全局 key，遗留模式仍可读，下次再试
  }
}

function isSpaceComment(c: unknown): c is SpaceComment {
  if (c == null || typeof c !== 'object') return false
  const o = c as Partial<SpaceComment>
  return (
    typeof o.id === 'string' &&
    typeof o.text === 'string' &&
    typeof o.at === 'number' &&
    (o.from === 'user' || o.from === 'ta')
  )
}

function isSpacePost(p: unknown): p is SpacePost {
  if (p == null || typeof p !== 'object') return false
  const o = p as Partial<SpacePost>
  return (
    typeof o.id === 'string' &&
    typeof o.at === 'number' &&
    typeof o.kind === 'string' &&
    (KIND_KEYS as string[]).includes(o.kind) &&
    typeof o.text === 'string' &&
    typeof o.art === 'number' &&
    (o.liked == null || typeof o.liked === 'boolean') &&
    (o.comments == null || (Array.isArray(o.comments) && o.comments.every(isSpaceComment)))
  )
}

function loadState(sessionId?: string): SpaceState {
  if (sessionId) ensureSessionSpaceData(sessionId)
  try {
    const rawPosts = localStorage.getItem(postsKey(sessionId))
    const posts = rawPosts ? (JSON.parse(rawPosts) as unknown[]) : []
    const lastRaw = localStorage.getItem(lastVisitKey(sessionId))
    const lastVisit = lastRaw ? Number(lastRaw) : null
    const rawUsed = localStorage.getItem(usedKey(sessionId))
    const used = rawUsed ? (JSON.parse(rawUsed) as Record<string, number>) : {}
    return {
      posts: Array.isArray(posts) ? posts.filter(isSpacePost) : [],
      lastVisit: lastVisit != null && Number.isFinite(lastVisit) ? lastVisit : null,
      used: used != null && typeof used === 'object' ? used : {},
    }
  } catch {
    return { posts: [], lastVisit: null, used: {} }
  }
}

function saveState(state: SpaceState, sessionId?: string): void {
  localStorage.setItem(postsKey(sessionId), JSON.stringify(state.posts))
  localStorage.setItem(lastVisitKey(sessionId), String(state.lastVisit ?? ''))
  localStorage.setItem(usedKey(sessionId), JSON.stringify(state.used))
  notifyDataChanged()
}

/** 只读地拿当前已落盘的动态列表（进空间先显示，不阻塞）；会话感知 */
export function loadCurrentPosts(sessionId?: string): SpacePost[] {
  return loadState(sessionId).posts
}

/** 云端同步用：汇总全部角色的动态（全局 + 各会话），防角色隔离后云端丢数据 */
export function collectAllSpacePosts(): SpacePost[] {
  const out: SpacePost[] = []
  const global = loadState(undefined).posts
  if (global.length > 0) out.push(...global)
  for (const s of getSessionsCache()) {
    const sid = String(s.id)
    if (sid) {
      const posts = loadState(sid).posts
      if (posts.length > 0) out.push(...posts)
    }
  }
  return out
}

export type SpaceMode = 'llm' | 'template' | 'no-persona'

export interface RefreshPlan {
  /** 本次要展示的动态（模板/兜底路径已含新生成；llm 路径为已有动态，新动态待异步补） */
  posts: SpacePost[]
  /** 本次走的生成路径 */
  mode: SpaceMode
  /** 本次新生成/待生成的数量（llm 模式为 pending 长度） */
  created: number
  /** llm 模式下待异步生成的时间戳（从旧到新） */
  pending: number[]
  /** used 快照，供 llm 降级模板时去重 */
  used: UsedTemplates
  /** 内部标记：该计划是否已启动异步生成（防 StrictMode 重复触发） */
  started?: boolean
}

function buildVars(taName: string, yourName: string, now: number): TemplateVar {
  return {
    taName: taName || 'TA',
    yourName: yourName || '你',
    season: getSeason(now),
    timeWord: getTimeWord(now),
    weatherWord: pickWeatherWord(),
  }
}

/** 每次进入 / 手动刷新 TA 的空间时调用：推进时间轴、返回最新列表与生成计划（会话感知，按角色隔离） */
export function refreshSpace(
  taName: string,
  yourName: string,
  now: number = Date.now(),
  sessionId?: string,
): RefreshPlan {
  const prev = loadState(sessionId)
  const vars = buildVars(taName, yourName, now)
  const persona = loadPersona()
  const settings = loadSettings()
  // 事件日 = 有聊天话题的自然日（loadChatTopics 带 ts；兼容 ts=0 的旧数据归到今天）
  const topics = loadChatTopics(sessionId)
  const activeDays = new Set<string>()
  for (const t of topics) {
    const ts = t.ts && Number.isFinite(t.ts) && t.ts > 0 ? t.ts : now
    activeDays.add(dayKeyOf(ts))
  }
  const timestamps = planBackfillTimestamps(prev.lastVisit, now, prev.posts, activeDays)

  // 没人设：不调 LLM。空间为空时用模板兜底生成 1 条保证空间不空，其余交给「先写人设」引导
  if (!persona.trim()) {
    const posts = [...prev.posts]
    const used = { ...prev.used }
    let created = 0
    if (prev.posts.length === 0) {
      const g = generatePost(vars, used, now - 3 * 60 * 1000)
      used[g.templateKey] = now
      posts.unshift(g.post)
      created = 1
    }
    const state: SpaceState = { posts: posts.slice(0, MAX_POSTS), lastVisit: now, used }
    saveState(state, sessionId)
    return { posts: state.posts, mode: 'no-persona', created, pending: [], used: state.used }
  }

  // 有人设 + 有 key：LLM 路径。先推进 lastVisit 占位防重复，新动态异步补
  if (canUseLlm(persona, settings)) {
    const state: SpaceState = { ...prev, lastVisit: now }
    saveState(state, sessionId)
    return { posts: state.posts, mode: 'llm', created: timestamps.length, pending: timestamps, used: state.used }
  }

  // 有人设但没 key：降级模板，同步生成（纯文字动态，不配图）
  const { state, created } = advanceTimeline(prev, vars, now, activeDays)
  const posts = state.posts
  saveState({ ...state, posts }, sessionId)
  return { posts, mode: 'template', created, pending: [], used: state.used }
}

export interface GenerateResult {
  /** 合并落盘后的完整最新列表 */
  posts: SpacePost[]
  created: number
  /** 是否发生过模板降级（LLM 失败或中途没 key），供前端低调提示 */
  usedFallback: boolean
}

/** 异步生成 llm 模式待补的动态（会话感知）：LLM 优先，失败/空内容降级模板；完成后合并落盘到该角色 key */
export async function generatePendingPosts(
  plan: RefreshPlan,
  taName: string,
  yourName: string,
  sessionId?: string,
  now: number = Date.now(),
  rand: () => number = Math.random,
): Promise<GenerateResult> {
  const persona = loadPersona()
  const settings = loadSettings()
  const vars = buildVars(taName, yourName, now)
  const recent = plan.posts.slice(0, 3).map((p) => p.text)
  // 事件触发：最近聊天话题（带日期）注入 LLM，让 TA 只在「当天相关」时呼应（2026-08-26 七七拍板）
  const rawTopics = loadChatTopics(sessionId)
  const used = { ...plan.used }
  const newPosts: SpacePost[] = []
  let usedFallback = false

  // 每天 ≤2 条兜底：按现有动态统计每天条数，跳过已满的日子（首访/边缘情况保护）
  const dayCounts = new Map<string, number>()
  for (const p of plan.posts) {
    const k = dayKeyOf(p.at)
    dayCounts.set(k, (dayCounts.get(k) ?? 0) + 1)
  }

  for (const at of plan.pending) {
    const dk = dayKeyOf(at)
    if ((dayCounts.get(dk) ?? 0) >= MAX_POSTS_PER_DAY) continue
    let made: { post: SpacePost; templateKey?: string } | null = null

    if (canUseLlm(persona, settings)) {
      // ★每条动态按它自己的时间戳(at)构建上下文——回填昨天就按昨天的日期/时段写，
      //   话题标签也以 at 那天为基准（at 当天聊的标「今天」，其余标日期），凌晨回填不穿帮
      const atBase = new Date(at)
      const sameDay = (ts: number): boolean => {
        if (!ts) return false
        const d = new Date(ts)
        return (
          d.getFullYear() === atBase.getFullYear() &&
          d.getMonth() === atBase.getMonth() &&
          d.getDate() === atBase.getDate()
        )
      }
      const chatTopics = rawTopics.map((x) => {
        if (sameDay(x.ts)) return `今天 ${x.t}`
        const d = new Date(x.ts)
        if (Number.isFinite(x.ts) && x.ts > 0) return `${d.getMonth() + 1}-${d.getDate()} ${x.t}`
        return x.t
      })
      const atDateStr = `${atBase.getMonth() + 1}月${atBase.getDate()}日`
      const atVars: TemplateVar = {
        ...vars,
        season: getSeason(at),
        timeWord: getTimeWord(at),
      }
      const messages = buildLlmMessages({
        taName,
        yourName,
        persona,
        season: atVars.season,
        timeWord: atVars.timeWord,
        weatherWord: atVars.weatherWord,
        recent,
        chatTopics,
        atDateStr,
      })
      try {
        const raw = await chatCompletion(settings, messages, { timeoutMs: 30000 })
        const cleaned = cleanLlmText(raw)
        if (cleaned) {
          // 纯文字动态（2026-09-03 七七拍板删色卡配图）：模型如残留 [配图] 标记只剥掉，不再生成图片
          const { text } = extractImageCaption(cleaned)
          if (text) {
            const post = buildLlmPost(text, at, guessKind(text), rand)
            made = { post }
          }
        }
      } catch {
        made = null // 超时/报错/返回不可用 → 降级模板
      }
    }

    if (!made) {
      // 模板降级也按 at 的时段/季节生成（回填昨天就用昨天的时段词，不穿帮）
      const dayVars: TemplateVar = { ...vars, timeWord: getTimeWord(at), season: getSeason(at) }
      const g = generatePost(dayVars, used, at, rand)
      used[g.templateKey] = now
      made = { post: g.post, templateKey: g.templateKey }
      usedFallback = true
    }

    newPosts.push(made.post)
    dayCounts.set(dk, (dayCounts.get(dk) ?? 0) + 1)
    // 把刚生成的动态纳入「最近 3 条」，避免下一条雷同
    recent.unshift(made.post.text)
    if (recent.length > 3) recent.pop()
  }

  // 合并落盘：重新读一次当前状态，避免覆盖别处写入
  const current = loadState(sessionId)
  const posts = mergeNewPosts(current.posts, newPosts)
  const state: SpaceState = { posts, lastVisit: current.lastVisit ?? now, used }
  saveState(state, sessionId)
  return { posts: state.posts, created: newPosts.length, usedFallback }
}

/* ---- TASK_UI_BATCH2 点赞 + 评论（随 posts 一起存 localStorage，云端同步沿用 collectAllSpacePosts） ---- */

/** 更新某条动态并落盘（点赞/评论通用）；返回更新后的完整列表 */
export function updatePost(
  postId: string,
  updater: (p: SpacePost) => SpacePost,
  sessionId?: string,
): SpacePost[] {
  const state = loadState(sessionId)
  const posts = state.posts.map((p) => (p.id === postId ? updater(p) : p))
  saveState({ ...state, posts }, sessionId)
  return posts
}

/** 点赞开关：点一下变已赞，再点取消 */
export function togglePostLike(postId: string, sessionId?: string): SpacePost[] {
  return updatePost(postId, (p) => ({ ...p, liked: !p.liked }), sessionId)
}

/** 用户发一条评论；返回更新后的列表和刚加的评论（供 TA 回复用） */
export function addUserComment(
  postId: string,
  text: string,
  sessionId?: string,
): { posts: SpacePost[]; comment: SpaceComment } {
  const clean = String(text ?? '').trim().slice(0, 100)
  const comment: SpaceComment = {
    id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    text: clean,
    at: Date.now(),
    from: 'user',
  }
  const posts = updatePost(postId, (p) => ({ ...p, comments: [...(p.comments ?? []), comment] }), sessionId)
  return { posts, comment }
}

/**
 * TA 回复一条用户评论（每条评论最多回 1 条）：按「人设 + 那条动态」调 LLM 回；
 * 没 key / 失败 / 空内容 → 降级模板话术。返回更新后的完整列表。
 */
export async function generateTaReply(
  postId: string,
  commentId: string,
  taName: string,
  yourName: string,
  sessionId?: string,
  now: number = Date.now(),
  rand: () => number = Math.random,
): Promise<SpacePost[]> {
  const persona = loadPersona()
  const settings = loadSettings()
  const state = loadState(sessionId)
  const post = state.posts.find((p) => p.id === postId)
  if (!post) return state.posts
  const comment = post.comments?.find((c) => c.id === commentId && c.from === 'user')
  if (!comment) return state.posts
  // 已回过这条评论就不再回（每条评论 TA 最多回 1 条，不形成聊天）
  if ((post.comments ?? []).some((c) => c.replyTo === commentId)) return state.posts

  let replyText: string | null = null
  if (canUseLlm(persona, settings)) {
    const messages = buildReplyMessages({
      taName: taName || 'TA',
      yourName: yourName || '你',
      persona,
      postText: post.text,
      commentText: comment.text,
    })
    try {
      const raw = await chatCompletion(settings, messages, { timeoutMs: 30000 })
      replyText = cleanLlmText(raw)
    } catch {
      replyText = null // 超时/报错 → 降级模板
    }
  }
  if (!replyText) replyText = pickReplyFallback(rand)

  const reply: SpaceComment = {
    id: `r${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`,
    text: replyText.slice(0, 100),
    at: now,
    from: 'ta',
    replyTo: commentId,
  }
  return updatePost(postId, (p) => ({ ...p, comments: [...(p.comments ?? []), reply] }), sessionId)
}
