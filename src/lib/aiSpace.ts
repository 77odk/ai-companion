// TA 的空间 · 动态引擎（localStorage 读写 + 对外入口）
// 纯逻辑都在 aiSpaceCore.ts / aiSpaceLlm.ts（可被 Node 单测），本文件只负责存取与组装。
// 生成路径分三态：
//   llm      有人设 + 有 key：先推进 lastVisit 占位，新动态由 LLM 异步生成（失败降级模板）
//   template 有人设但没 key：直接用现有模板同步生成
//   no-persona 没人设：不调 LLM，模板兜底生成 1 条保证空间不空，其余交给引导

import {
  advanceTimeline,
  computeNewCount,
  newPostTimestamps,
  getSeason,
  getTimeWord,
  pickWeatherWord,
  generatePost,
  mergeNewPosts,
  KIND_KEYS,
  MAX_POSTS,
  type SpacePost,
  type SpaceState,
  type TemplateVar,
  type UsedTemplates,
} from './aiSpaceCore'
import {
  canUseLlm,
  cleanLlmText,
  guessKind,
  buildLlmMessages,
  buildLlmPost,
} from './aiSpaceLlm'
import { chatCompletion } from './api'
import { loadPersona, loadSettings } from './storage'

const POSTS_KEY = 'ai_space_posts'
const LAST_VISIT_KEY = 'ai_space_last_visit'
const USED_KEY = 'ai_space_used_templates'

function isSpacePost(p: unknown): p is SpacePost {
  if (p == null || typeof p !== 'object') return false
  const o = p as Partial<SpacePost>
  return (
    typeof o.id === 'string' &&
    typeof o.at === 'number' &&
    typeof o.kind === 'string' &&
    (KIND_KEYS as string[]).includes(o.kind) &&
    typeof o.text === 'string' &&
    typeof o.art === 'number'
  )
}

function loadState(): SpaceState {
  try {
    const rawPosts = localStorage.getItem(POSTS_KEY)
    const posts = rawPosts ? (JSON.parse(rawPosts) as unknown[]) : []
    const lastRaw = localStorage.getItem(LAST_VISIT_KEY)
    const lastVisit = lastRaw ? Number(lastRaw) : null
    const rawUsed = localStorage.getItem(USED_KEY)
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

function saveState(state: SpaceState): void {
  localStorage.setItem(POSTS_KEY, JSON.stringify(state.posts))
  localStorage.setItem(LAST_VISIT_KEY, String(state.lastVisit ?? ''))
  localStorage.setItem(USED_KEY, JSON.stringify(state.used))
}

/** 只读地拿当前已落盘的动态列表（进空间先显示，不阻塞） */
export function loadCurrentPosts(): SpacePost[] {
  return loadState().posts
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

/** 每次进入 / 手动刷新 TA 的空间时调用：推进时间轴、返回最新列表与生成计划 */
export function refreshSpace(taName: string, yourName: string, now: number = Date.now()): RefreshPlan {
  const prev = loadState()
  const vars = buildVars(taName, yourName, now)
  const persona = loadPersona()
  const settings = loadSettings()
  const count = computeNewCount(prev.lastVisit, now)
  const timestamps = newPostTimestamps(count, now, prev.lastVisit == null)

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
    saveState(state)
    return { posts: state.posts, mode: 'no-persona', created, pending: [], used: state.used }
  }

  // 有人设 + 有 key：LLM 路径。先推进 lastVisit 占位防重复，新动态异步补
  if (canUseLlm(persona, settings)) {
    const state: SpaceState = { ...prev, lastVisit: now }
    saveState(state)
    return { posts: state.posts, mode: 'llm', created: count, pending: timestamps, used: state.used }
  }

  // 有人设但没 key：降级模板，同步生成
  const { state, created } = advanceTimeline(prev, vars, now)
  saveState(state)
  return { posts: state.posts, mode: 'template', created, pending: [], used: state.used }
}

export interface GenerateResult {
  /** 合并落盘后的完整最新列表 */
  posts: SpacePost[]
  created: number
  /** 是否发生过模板降级（LLM 失败或中途没 key），供前端低调提示 */
  usedFallback: boolean
}

/** 异步生成 llm 模式待补的动态：LLM 优先，失败/空内容降级模板；完成后合并落盘 */
export async function generatePendingPosts(
  plan: RefreshPlan,
  taName: string,
  yourName: string,
  now: number = Date.now(),
  rand: () => number = Math.random,
): Promise<GenerateResult> {
  const persona = loadPersona()
  const settings = loadSettings()
  const vars = buildVars(taName, yourName, now)
  const recent = plan.posts.slice(0, 3).map((p) => p.text)
  const used = { ...plan.used }
  const newPosts: SpacePost[] = []
  let usedFallback = false

  for (const at of plan.pending) {
    let made: { post: SpacePost; templateKey?: string } | null = null

    if (canUseLlm(persona, settings)) {
      const messages = buildLlmMessages({
        taName,
        yourName,
        persona,
        season: vars.season,
        timeWord: vars.timeWord,
        weatherWord: vars.weatherWord,
        recent,
      })
      try {
        const raw = await chatCompletion(settings, messages, { timeoutMs: 30000 })
        const text = cleanLlmText(raw)
        if (text) {
          made = { post: buildLlmPost(text, at, guessKind(text), rand) }
        }
      } catch {
        made = null // 超时/报错/返回不可用 → 降级模板
      }
    }

    if (!made) {
      const g = generatePost(vars, used, at, rand)
      used[g.templateKey] = now
      made = { post: g.post, templateKey: g.templateKey }
      usedFallback = true
    }

    newPosts.push(made.post)
    // 把刚生成的动态纳入「最近 3 条」，避免下一条雷同
    recent.unshift(made.post.text)
    if (recent.length > 3) recent.pop()
  }

  // 合并落盘：重新读一次当前状态，避免覆盖别处写入
  const current = loadState()
  const posts = mergeNewPosts(current.posts, newPosts)
  const state: SpaceState = { posts, lastVisit: current.lastVisit ?? now, used }
  saveState(state)
  return { posts: state.posts, created: newPosts.length, usedFallback }
}
