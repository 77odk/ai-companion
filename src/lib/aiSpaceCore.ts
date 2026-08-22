// TA 的空间 · 动态生成引擎（纯逻辑核心）
// 本文件零依赖、不碰 localStorage，方便被 Node 脚本直接跑单测。
// 时间轴规则：
//   首访（无 lastVisit）→ 预生成 3 条（往前推 40 分钟 / 3 小时 / 7 小时）
//   距上次 ≥ 2 小时 → 补 1 条（时间戳=现在往前几分钟）
//   距上次 ≥ 24 小时 → 补 2 条
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

export interface SpacePost {
  id: string
  at: number
  kind: SpaceKind
  text: string
  /** 插画变体索引（生成时定好，保证每条动态配图固定） */
  art: number
}

export interface TemplateVar {
  taName: string
  yourName: string
  season: string
  timeWord: string
  weatherWord: string
}

// 动态模板库：按 kind 分类，每类 5 条。占位符 {taName} {yourName} {season} {timeWord} {weatherWord}
// 文案要求：像真人碎碎念，提用户、提钻研干活、提季节天气，避开禁用字，不用 emoji
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
    '写写划划了一下午，草稿纸都满了。干活的快乐，大概就是这种一点点靠近答案的踏实。',
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
    '{timeWord}在墙头遇见一只很会撒娇的猫，被它认真看了一会儿，心情好了一整天。',
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

// 每类插画变体数量（SpaceArt 里要有对应变体）
export const ART_VARIANTS: Record<SpaceKind, number> = {
  日常: 2,
  心情: 2,
  钻研: 2,
  天气: 2,
  想你: 2,
  小确幸: 2,
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

/** 判定这次访问要补几条：首访 3 条，≥24h 补 2 条，≥2h 补 1 条，否则 0 条 */
export function computeNewCount(lastVisit: number | null, now: number): number {
  if (lastVisit == null) return 3
  const elapsed = now - lastVisit
  if (elapsed >= DAY_INTERVAL_MS) return 2
  if (elapsed >= MIN_INTERVAL_MS) return 1
  return 0
}

/** 新动态的时间戳：首访往前推 40 分钟/3 小时/7 小时；补新的一律往前推几分钟 */
export function newPostTimestamps(count: number, now: number, firstVisit: boolean): number[] {
  if (firstVisit) {
    return [now - 40 * 60 * 1000, now - 3 * 60 * 60 * 1000, now - 7 * 60 * 60 * 1000]
  }
  if (count >= 2) return [now - 45 * 60 * 1000, now - 3 * 60 * 1000]
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
  const count = computeNewCount(prev.lastVisit, now)
  const timestamps = newPostTimestamps(count, now, firstVisit)
  const posts = [...prev.posts]
  const used = { ...prev.used }
  let created = 0
  // timestamps 是时间从旧到新，倒序 unshift 让数组保持最新在前
  for (let i = timestamps.length - 1; i >= 0; i--) {
    const ts = timestamps[i]
    const g = generatePost(vars, used, ts, rand)
    used[g.templateKey] = now
    posts.unshift(g.post)
    created++
  }
  return { state: { posts: posts.slice(0, MAX_POSTS), lastVisit: now, used }, created }
}
