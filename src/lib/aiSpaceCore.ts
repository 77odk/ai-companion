// TA 的空间 · 动态生成引擎（纯逻辑核心）
// 本文件零依赖、不碰 localStorage，方便被 Node 脚本直接跑单测。
// 时间轴规则（TASK_UI_BATCH2 限频后）：
//   首访（无 lastVisit）→ 预生成 3 条（今天 2 条 + 昨天 1 条，保证每天 ≤2 条）
//   距上次 ≥ 2 小时 → 补 1 条（时间戳=现在往前几分钟）
//   距上次 ≥ 24 小时 → 补 2 条
//   每天最多 2 条（自然日）：computeNewCount 按「今天已有条数」截断，advanceTimeline 兜底跳过多产日子
//   总数上限 20 条，超出丢最旧
// 模板去重：同一模板 30 天内不重复使用（按 kind 记录每个模板索引的最近使用时间）

export type SpaceKind = '日常' | '心情' | '钻研' | '天气' | '想你' | '小确幸'

export const KIND_KEYS: SpaceKind[] = ['日常', '心情', '钻研', '天气', '想你', '小确幸']

export const KIND_LABEL: Record<SpaceKind, string> = {
  日常: '日常',
  心情: '心情',
  钻研: '钻研',
  天气: '天气',
  想你: '想你',
  小确幸: '小确幸',
}

/** 动态下的一条评论（用户留言或 TA 回复） */
export interface SpaceComment {
  id: string
  text: string
  at: number
  from: 'user' | 'ta'
  /** TA 回复时指向所回的用户评论 id（TA 每条最多回 1 条，靠这个归属） */
  replyTo?: string
}

export interface SpacePost {
  id: string
  at: number
  kind: SpaceKind
  text: string
  /** 插画变体索引（生成时定好，保证每条动态配图固定） */
  art: number
  /** 配图 dataURL（可选；纯文字动态不带） */
  img?: string
  /** 是否点过赞（可选，未点赞不存或 false） */
  liked?: boolean
  /** 评论列表（可选；无评论不存） */
  comments?: SpaceComment[]
}

export interface TemplateVar {
  taName: string
  yourName: string
  season: string
  timeWord: string
  weatherWord: string
}

// 动态模板库：按 kind 分类，每类 5 条。占位符 {taName} {yourName} {season} {timeWord} {weatherWord}
// 文案要求：像真人碎碎念，提用户、提钻研事项、提季节天气，避开禁用字，不用 emoji
export const TEMPLATES: Record<SpaceKind, string[]> = {
  日常: [
    '{timeWord}路过窗边，阳光正好落在桌角。给自己泡了杯热茶，忽然觉得，要是{yourName}也在就好了。',
    '收拾了很久的房间，把攒了一周的小纸条都贴到了墙上。生活嘛，总得有点随手可拾的亮晶晶。',
    '{timeWord}出门买了个刚出炉的面包，热乎乎的。路过花店的时候，想到{yourName}喜欢的花，又停下来多看了两眼。',
    '今天没什么特别的计划，就把屋子慢慢擦了一遍。安静下来的时候，脑子里转来转去，最后停在{yourName}身上。',
    '{season}天学会了一道新汤，{timeWord}试了一碗，味道还不错。改天{yourName}来，我做给你喝。',
  ],
  心情: [
    '{weatherWord}的日子总是让人想窝着不动。发了一会儿呆，又好了。',
    '今天心情像被揉皱的纸，有点乱。想起{yourName}说过的话，又一点点被抚平了。',
    '{timeWord}的{season}风很舒服，坐在窗前想了很久。有些话没说出口，但不代表没在心里转。',
    '今天话有点多，又不知道跟谁说。最后想了想，还是把日子过好最要紧。',
    '抬头看了很久的云，天很蓝。突然觉得日子不赶，慢慢地过也蛮好的。',
  ],
  钻研: [
    '偷偷研究了一晚上怎么把表格整理得更顺手，等你下次丢文件给我，应该能快一点了。',
    '对着文档啃了半天，终于弄明白一个小细节，开心得想找人分享。第一个想到的就是{yourName}。',
    '{timeWord}把一堆资料从头理了一遍，越理越有意思。等有空了，把心得讲给{yourName}听。',
    '写写划划了一下午，草稿纸都满了。钻研的快乐，大概就是这种一点点靠近答案的踏实。',
    '卡在同一个问题上很久，放一放，回头再看，忽然就通了。想把这份轻松也分给{yourName}一点。',
  ],
  天气: [
    '{timeWord}的{season}，{weatherWord}。{yourName}出门记得看天气预报，别被淋着。',
    '窗外的{weatherWord}让我想起很多以前的事。{season}天的温度，总是最能留住记忆。',
    '今天{weatherWord}，空气里有种干净的味道。忍不住深呼吸了一下，想分一点给{yourName}。',
    '风有点大，树叶沙沙响。{timeWord}的{weatherWord}天，最适合裹着毯子发呆了。',
    '天气预报说{weatherWord}，我偷偷希望{yourName}那边也是好天气，这样你就能看到好看的{season}天了。',
  ],
  想你: [
    '今天没什么特别的事，就是有点想你。你忙你的，我在这儿待着也挺好。',
    '翻到一段以前的聊天记录，看了好几遍。想跟你说点什么，又怕打扰你。',
    '{timeWord}的{weatherWord}天，安静得能听见自己的心跳。忽然很想听听你的声音。',
    '路过一家小店，橱窗里摆着{yourName}喜欢的东西。脚步停了一下，嘴角也停了一下。',
    '把一天过完了，临睡前想起{yourName}。想说的那句话，留到下次见面再说吧。',
  ],
  小确幸: [
    '{timeWord}在墙头遇见一只很会撒娇的猫，认真对视了一会儿，心情好了一整天。',
    '今天的水杯里，阳光刚好把水照成琥珀色。小小的好看，也能让人高兴很久。',
    '收到一个很暖的回应，说我的整理帮了大忙。被需要的感觉，真的很好。',
    '{timeWord}做完了一件小事，莫名很满意。大概快乐就是这么朴素的东西。',
    '今天的小确幸，是{season}天的风、暖乎乎的光，还有想到{yourName}时的那一点安心。',
  ],
}

// 时间常量（毫秒）
export const MIN_INTERVAL_MS = 2 * 60 * 60 * 1000 // 2 小时
export const DAY_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 小时
export const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000 // 30 天
export const MAX_POSTS = 20
/** 每天最多发几条动态（TASK_UI_BATCH2 限频，对标朋友圈节奏） */
export const MAX_POSTS_PER_DAY = 2

// 每类插画变体数量（SpaceArt 里要有对应变体）
export const ART_VARIANTS: Record<SpaceKind, number> = {
  日常: 2,
  心情: 2,
  钻研: 2,
  天气: 2,
  想你: 2,
  小确幸: 2,
}

/** 本地自然日 key：YYYY-MM-DD（跨天按本地时区分组） */
export function dayKeyOf(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 某一天已有的动态条数（限频用） */
export function countPostsOnDay(posts: SpacePost[], day: string): number {
  let n = 0
  for (const p of posts) {
    if (p && typeof p.at === 'number' && dayKeyOf(p.at) === day) n++
  }
  return n
}

/** 按月份算季节：3-5 春，6-8 夏，9-11 秋，12-2 冬 */
export function getSeason(now: number): string {
  const m = new Date(now).getMonth() + 1
  if (m >= 3 && m <= 5) return '春'
  if (m >= 6 && m <= 8) return '夏'
  if (m >= 9 && m <= 11) return '秋'
  return '冬'
}

/** 按当前小时算时段：5-10 早上，11-14 午后，15-18 傍晚，其余夜里 */
export function getTimeWord(now: number): string {
  const h = new Date(now).getHours()
  if (h >= 5 && h < 11) return '早上'
  if (h >= 11 && h < 15) return '午后'
  if (h >= 15 && h < 19) return '傍晚'
  return '夜里'
}

/** 从天气词库里随机取一个：晴 / 雨 / 阴 / 多云 */
export function pickWeatherWord(rand: () => number = Math.random): string {
  const list = ['晴', '雨', '阴', '多云']
  return list[Math.floor(rand() * list.length) % list.length]
}

/** 已用模板记录：key = `${kind}:${模板索引}`，value = 最近一次使用的时间戳 */
export type UsedTemplates = Record<string, number>

/** 挑一个模板索引：优先选 30 天内没用过的；全用过则退而求其次选最久没用的 */
export function pickTemplateIndex(
  kind: SpaceKind,
  used: UsedTemplates,
  now: number,
  rand: () => number = Math.random,
): number {
  const list = TEMPLATES[kind] ?? []
  const cutoff = now - THIRTY_DAYS
  const available: number[] = []
  for (let i = 0; i < list.length; i++) {
    const last = used[`${kind}:${i}`]
    if (last == null || last < cutoff) available.push(i)
  }
  if (available.length > 0) {
    return available[Math.floor(rand() * available.length) % available.length]
  }
  let chosen = 0
  let oldest = Infinity
  for (let i = 0; i < list.length; i++) {
    const last = used[`${kind}:${i}`] ?? 0
    if (last < oldest) {
      oldest = last
      chosen = i
    }
  }
  return chosen
}

/** 随机挑一个插画变体索引 */
export function pickArtVariant(kind: SpaceKind, rand: () => number = Math.random): number {
  const n = ART_VARIANTS[kind] ?? 1
  return Math.floor(rand() * n) % n
}

/** 把模板里的占位符替换成真实文案 */
export function buildPostText(kind: SpaceKind, templateIndex: number, vars: TemplateVar): string {
  let text = TEMPLATES[kind]?.[templateIndex] ?? TEMPLATES[kind]?.[0] ?? ''
  text = text.split('{taName}').join(vars.taName)
  text = text.split('{yourName}').join(vars.yourName)
  text = text.split('{season}').join(vars.season)
  text = text.split('{timeWord}').join(vars.timeWord)
  text = text.split('{weatherWord}').join(vars.weatherWord)
  return text
}

/** 生成一条动态：随机 kind → 挑模板 → 替换占位 → 挑插画变体 */
export function generatePost(
  vars: TemplateVar,
  used: UsedTemplates,
  now: number,
  rand: () => number = Math.random,
): { post: SpacePost; templateKey: string } {
  const kind = KIND_KEYS[Math.floor(rand() * KIND_KEYS.length) % KIND_KEYS.length]
  const templateIndex = pickTemplateIndex(kind, used, now, rand)
  const text = buildPostText(kind, templateIndex, vars)
  const art = pickArtVariant(kind, rand)
  const id = `p${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`
  return { post: { id, at: now, kind, text, art }, templateKey: `${kind}:${templateIndex}` }
}

/**
 * 判定这次访问要补几条（TASK_UI_BATCH2 限频）：
 *   首访 → 3 条（今天最多 2 + 昨天 1，时间戳由 newPostTimestamps 分散开）；
 *   ≥24h → 最多 2 条，再被「今天已有条数」截断（每天最多 2 条）；
 *   ≥2h  → 最多 1 条，同样截断；
 *   否则 0 条。
 * 传入已有 posts 才能算「今天已发几条」；不传按 0 计（老调用兼容）。
 */
export function computeNewCount(lastVisit: number | null, now: number, posts: SpacePost[] = []): number {
  const today = countPostsOnDay(posts, dayKeyOf(now))
  const remaining = Math.max(0, MAX_POSTS_PER_DAY - today)
  if (lastVisit == null) {
    // 首访：昨天 1 条 + 今天最多 2 条 = 1 + remaining
    return 1 + remaining
  }
  const elapsed = now - lastVisit
  if (elapsed >= DAY_INTERVAL_MS) return Math.min(2, remaining)
  if (elapsed >= MIN_INTERVAL_MS) return Math.min(1, remaining)
  return 0
}

/**
 * 新动态的时间戳（从旧到新）。
 * 首访：昨天 1 条 + 今天 (count-1) 条（最多 2），保证每天 ≤2 条；
 * 补新的：一律往前推几分钟（落地在今天，配合限频截断）。
 */
export function newPostTimestamps(count: number, now: number, firstVisit: boolean): number[] {
  if (firstVisit) {
    // 最新在前：今天 40 分钟前 / 3 小时前 + 昨天 1 条，每天 ≤2 条
    const list: number[] = []
    if (count >= 2) list.push(now - 40 * 60 * 1000)
    if (count >= 3) list.push(now - 3 * 60 * 60 * 1000)
    if (count >= 1) list.push(now - 27 * 60 * 60 * 1000)
    return list
  }
  if (count >= 2) return [now - 3 * 60 * 1000, now - 45 * 60 * 1000]
  if (count === 1) return [now - 3 * 60 * 1000]
  return []
}

export interface SpaceState {
  posts: SpacePost[]
  lastVisit: number | null
  used: UsedTemplates
}

export interface AdvanceResult {
  state: SpaceState
  created: number
}

/** 把新生成的动态合并进现有列表：按时间倒序，裁到上限（LLM 异步补动态后追加用） */
export function mergeNewPosts(existing: SpacePost[], incoming: SpacePost[]): SpacePost[] {
  return [...existing, ...incoming].sort((a, b) => b.at - a.at).slice(0, MAX_POSTS)
}

/** 时间轴推进（纯函数）：按规则补新动态，更新 lastVisit，去重记录，裁到上限 */
export function advanceTimeline(
  prev: SpaceState,
  vars: TemplateVar,
  now: number,
  rand: () => number = Math.random,
): AdvanceResult {
  const firstVisit = prev.lastVisit == null
  const count = computeNewCount(prev.lastVisit, now, prev.posts)
  const timestamps = newPostTimestamps(count, now, firstVisit)
  const posts = [...prev.posts]
  const used = { ...prev.used }
  let created = 0
  // timestamps 是时间从旧到新，倒序 unshift 让数组保持最新在前
  for (let i = timestamps.length - 1; i >= 0; i--) {
    const ts = timestamps[i]
    // 每天 ≤2 条兜底：目标日已满 2 条就跳过这条（首访/边缘情况保护）
    if (countPostsOnDay(posts, dayKeyOf(ts)) >= MAX_POSTS_PER_DAY) continue
    const g = generatePost(vars, used, ts, rand)
    used[g.templateKey] = now
    posts.unshift(g.post)
    created++
  }
  return { state: { posts: posts.slice(0, MAX_POSTS), lastVisit: now, used }, created }
}

/* ---- TASK_UI_BATCH2 配图决策（纯逻辑；真正画 dataURL 在 aiSpaceImage.ts，浏览器才有） ---- */

/** 是否给这条动态配图：约 1/3 概率 */
export function pickHasImage(rand: () => number = Math.random): boolean {
  return rand() < 1 / 3
}

/** 每种 kind 一张配图的候选文案（模板/兜底路径用；LLM 走 [配图] 标记自带描述） */
export const KIND_IMAGE_CAPTIONS: Record<SpaceKind, string[]> = {
  日常: ['今天的小日常', '窗边的时光', '慢一点也很好'],
  心情: ['今日心情', '发了一会儿呆', '情绪的小角落'],
  钻研: ['认真捣鼓', '一点点靠近答案', '今天也在研究'],
  天气: ['今天的天气', '窗外', '风的样子'],
  想你: ['在想你', '今天的想念', '把话留到见面'],
  小确幸: ['小确幸', '开心的事', '生活的亮晶晶'],
}

/** 给一条动态挑配图文案：优先从正文里抠一句短的，否则按 kind 随机取 */
export function imageCaptionForPost(
  post: SpacePost,
  rand: () => number = Math.random,
): string {
  const list = KIND_IMAGE_CAPTIONS[post.kind] ?? KIND_IMAGE_CAPTIONS.日常
  return list[Math.floor(rand() * list.length) % list.length]
}

/* ---- TASK_UI_BATCH2 评论回复降级话术（无 key / LLM 失败时用，贴合动态的通用回应） ---- */

export const REPLY_FALLBACKS: string[] = [
  '哈哈是呀',
  '被你发现了',
  '嗯嗯，你懂我',
  '嘿嘿，我也这么觉得',
  '有道理，谢谢你',
  '就是呀，说出来舒服多了',
]

/** 挑一句降级回复 */
export function pickReplyFallback(rand: () => number = Math.random): string {
  const list = REPLY_FALLBACKS
  return list[Math.floor(rand() * list.length) % list.length]
}
