// TA 的空间 · 动态引擎（localStorage 读写 + 对外入口）
// 纯逻辑都在 aiSpaceCore.ts（可被 Node 单测），本文件只负责存取与组装

import {
  advanceTimeline,
  getSeason,
  getTimeWord,
  pickWeatherWord,
  KIND_KEYS,
  type SpacePost,
  type SpaceState,
  type TemplateVar,
} from './aiSpaceCore'

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

export interface RefreshResult {
  posts: SpacePost[]
  created: number
}

/** 每次进入 / 手动刷新 TA 的空间时调用：推进时间轴、补新动态、返回最新列表 */
export function refreshSpace(taName: string, yourName: string, now: number = Date.now()): RefreshResult {
  const prev = loadState()
  const vars: TemplateVar = {
    taName: taName || 'TA',
    yourName: yourName || '你',
    season: getSeason(now),
    timeWord: getTimeWord(now),
    weatherWord: pickWeatherWord(),
  }
  const { state, created } = advanceTimeline(prev, vars, now)
  saveState(state)
  return { posts: state.posts, created }
}
