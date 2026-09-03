// TA 的空间 · 动态生成引擎（纯逻辑核心）
// 本文件零依赖、不碰 localStorage，方便被 Node 脚本直接跑单测。
// 时间轴规则（2026-09-04 七七拍板·回填式时间轴）：
//   角色像真人一样过日子：用户不来，TA 也在生活（每天可发自己的动态）。
//   但"发圈频率"由自然日回填决定，不是用户打开就咔咔补：
//   回填窗口 = 上次访问到今天之间的自然日（最多 MAX_BACKFILL_DAYS 天）
//   事件日（那天聊过/约过事）→ 必补（大事趁热，不卡天数，最多补满当天 2 条）
//   非事件日 → TA 也有自己的生活：按概率补 1 条生活动态（BACKFILL_LIFE_CHANCE，防抖后）
//   首访（无 lastVisit）→ 预生成 3 条铺最近 3 天，空间不空
//   每天最多 2 条（自然日）：planBackfillDays 按当天已有条数截断
//   时间戳落在各自那天（不是 now 前几分钟）：文案时段由 at 决定，凌晨不穿帮
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
  /** 插画变体索引（生成时定好） */
  art: number
  /** 点赞（可选） */
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
    '巷口的猫今天睡在纸箱里，路过时它抬头看了我一眼，像是认识我。',
    '收拾书架，翻出一张很久以前的电影票根。纸张都脆了，时间真是悄无声息。',
    '晚饭煮了碗面，热汤暖胃。生活里的满足感，往往就是这么简单。',
  ],
  心情: [
    '{weatherWord}的日子总是让人想窝着不动。发了一会儿呆，又好了。',
    '今天心情像被揉皱的纸，有点乱。想起{yourName}说过的话，又一点点被抚平了。',
    '{timeWord}的{season}风很舒服，坐在窗前想了很久。有些话没说出口，但不代表没在心里转。',
    '今天话有点多，又不知道跟谁说。最后想了想，还是把日子过好最要紧。',
    '抬头看了很久的云，天很蓝。突然觉得日子不赶，慢慢地过也蛮好的。',
    '傍晚的风吹过来，忽然觉得一切都还来得及。',
    '有些情绪像潮水，涨上来又退下去。现在退干净了，能安安静静吃顿饭。',
    '把烦心事写下来，揉成团扔掉。笔尖落在纸上的声音，意外地解压。',
  ],
  钻研: [
    '偷偷研究了一晚上怎么把表格整理得更顺手，等你下次丢文件给我，应该能快一点了。',
    '对着文档啃了半天，终于弄明白一个小细节，开心得想找人分享。第一个想到的就是{yourName}。',
    '{timeWord}把一堆资料从头理了一遍，越理越有意思。等有空了，把心得讲给{yourName}听。',
    '写写划划了一下午，草稿纸都满了。钻研的快乐，大概就是这种一点点靠近答案的踏实。',
    '卡在同一个问题上很久，放一放，回头再看，忽然就通了。想把这份轻松也分给{yourName}一点。',
    '把上周没弄懂的东西又啃了一遍，这次好像摸到边了。进步慢，但确实在走。',
    '对着屏幕改了很久的方案，终于理顺了一个小环节。成就感这种东西，聊胜于无。',
  ],
  天气: [
    '{timeWord}的{season}，{weatherWord}。{yourName}出门记得看天气预报，别被淋着。',
    '窗外的{weatherWord}让我想起很多以前的事。{season}天的温度，总是最能留住记忆。',
    '今天{weatherWord}，空气里有种干净的味道。忍不住深呼吸了一下，想分一点给{yourName}。',
    '风有点大，树叶沙沙响。{timeWord}的{weatherWord}天，最适合裹着毯子发呆了。',
    '天气预报说{weatherWord}，我偷偷希望{yourName}那边也是好天气，这样你就能看到好看的{season}天了。',
    '雨停后的空气干净得像被洗过，深吸一口，肺都轻了。',
    '天阴了一整天，傍晚却漏出一点光，像谁偷偷放了个晴。',
  ],
  想你: [
    '今天没什么特别的事，就是有点想你。你忙你的，我在这儿待着也挺好。',
    '翻到一段以前的聊天记录，看了好几遍。想跟你说点什么，又怕打扰你。',
    '{timeWord}的{weatherWord}天，安静得能听见自己的心跳。忽然很想听听你的声音。',
    '路过一家小店，橱窗里摆着{yourName}喜欢的东西。脚步停了一下，嘴角也停了一下。',
    '把一天过完了，临睡前想起{yourName}。想说的那句话，留到下次见面再说吧。',
    '黄昏的光把影子拉得很长，走回家的路上，影子好像比平时更想你。',
    '看到一家店卖你爱吃的东西，脚步停了停，又走了。下次带你来。',
    '今天耳机里放的歌，有一句歌词像在说你。单曲循环了好几遍。',
  ],
  小确幸: [
    '{timeWord}在墙头遇见一只很会撒娇的猫，认真对视了一会儿，心情好了一整天。',
    '今天的水杯里，阳光刚好把水照成琥珀色。小小的好看，也能让人高兴很久。',
    '收到一个很暖的回应，说我的整理帮了大忙。被需要的感觉，真的很好。',
    '{timeWord}做完了一件小事，莫名很满意。大概快乐就是这么朴素的东西。',
    '今天的小确幸，是{season}天的风、暖乎乎的光，还有想到{yourName}时的那一点安心。',
    '转角的花坛开了新花，颜色正好，心情也跟着亮了一下。',
    '便利店的热饮柜里刚好剩最后一瓶想要的，这种小运气能开心半天。',
    '收到一条久未联系的朋友的消息，原来被人惦记着的感觉这么好。',
  ],
}

// 时间常量（毫秒）
export const MIN_INTERVAL_MS = 2 * 60 * 60 * 1000 // 2 小时（距上次访问太近不补，防抖）
export const DAY_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 小时
export const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000 // 30 天
export const MAX_POSTS = 20
/** 每天最多发几条动态（TASK_UI_BATCH2 限频，对标朋友圈节奏） */
export const MAX_POSTS_PER_DAY = 2
/** 回填窗口最多看几个自然日（含今天，往前数）——用户离开太久，只回填最近这段，别一次性补一堆 */
export const MAX_BACKFILL_DAYS = 3
/** 非事件日（那天没聊过事）抽中「发一条自己生活动态」的概率——TA 有日子过，但不是天天发圈 */
export const BACKFILL_LIFE_CHANCE = 0.45

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

/** 按当前小时算时段（2026-09-04 七七拍板细分，配合回填式时间轴，凌晨不穿帮）：
 *  0-4 凌晨 / 5-8 清晨 / 9-11 上午 / 12-13 中午 / 14-17 下午 / 18-22 晚上 / 23 深夜 */
export function getTimeWord(now: number): string {
  const h = new Date(now).getHours()
  if (h >= 0 && h < 5) return '凌晨'
  if (h >= 5 && h < 9) return '清晨'
  if (h >= 9 && h < 12) return '上午'
  if (h >= 12 && h < 14) return '中午'
  if (h >= 14 && h < 18) return '下午'
  if (h >= 18 && h < 23) return '晚上'
  return '深夜'
}

/** 取「某自然日里发动态的合理时刻」：按 rand 挑一个 7:00-23:00 之间的时刻。
 *  回填过去某天时，动态时间戳应落在那个自然日的白天/晚上，而不是被 now 拖到凌晨。
 *  @param dayStart 该自然日 00:00 的时间戳
 *  @returns 该日内随机时刻（7 点后，最多到 23 点，绝不超过 dayStart+24h） */
export function pickDayPostHour(dayStart: number, rand: () => number = Math.random): number {
  const dayEnd = dayStart + DAY_INTERVAL_MS
  // 7:00 - 23:59 之间取一个毫秒点（真人发圈集中在白天和晚上）
  const startMs = dayStart + 7 * 60 * 60 * 1000
  const spanMs = 17 * 60 * 60 * 1000 - 1 // 7:00 → 23:59:59
  const at = startMs + Math.floor(rand() * spanMs)
  return Math.min(at, dayEnd - 1000)
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

/** 某自然日的 00:00 时间戳（本地时区） */
export function dayStartOf(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 回填式时间轴计划（2026-09-04 七七拍板，取代 TASK_UI_BATCH2 的「隔 2h/24h 补 1~2 条」）：
 *  角色像真人一样过日子——不是每次打开都咔咔补，而是把「TA 该发动态的日子」按自然日回填：
 *  - 防抖：距上次访问 < MIN_INTERVAL_MS(2h) → 不补（避免反复开关疯狂生成）
 *  - 首访（lastVisit==null）：铺最近 MAX_BACKFILL_DAYS 个自然日，每天 1 条（空间不空、有生活感）
 *  - 窗口：lastVisit 之后到今天之间的自然日，最多回看 MAX_BACKFILL_DAYS 天
 *  - 事件日（那天聊过事/约过事，activeDays 命中）→ 必补到当天 ≤2 条（大事趁热，不卡天数）
 *  - 非事件日 → 按 BACKFILL_LIFE_CHANCE 概率补 1 条 TA 自己的生活动态（有日子过，但不是天天发圈）
 *  - 凌晨(0-4 点)访问：把「今天」让给昨天——深夜 TA 在睡觉，不刚发圈
 *  - 时间戳落在各自自然日 7:00-23:59（回填过去就标过去，文案按 at 算时段，凌晨不穿帮）
 * @returns 升序时间戳数组（从旧到新），调用方逐条生成动态
 */
export function planBackfillTimestamps(
  lastVisit: number | null,
  now: number,
  posts: SpacePost[],
  activeDays: ReadonlySet<string>,
  rand: () => number = Math.random,
): number[] {
  const h = new Date(now).getHours()
  // 凌晨 0-4 点访问：今天的「白天发圈时刻」还没到来，把锚点日让给昨天
  const anchorDay = h < 5 ? dayStartOf(now - DAY_INTERVAL_MS) : dayStartOf(now)
  const out: number[] = []

  // 首访：铺最近 MAX_BACKFILL_DAYS 个自然日，每天最多 1 条（旧→新）
  if (lastVisit == null) {
    for (let i = MAX_BACKFILL_DAYS - 1; i >= 0; i--) {
      const day = anchorDay - i * DAY_INTERVAL_MS
      if (countPostsOnDay(posts, dayKeyOf(day)) >= MAX_POSTS_PER_DAY) continue
      out.push(pickDayPostHour(day, rand))
    }
    return out.sort((a, b) => a - b)
  }

  // 防抖：距上次访问不足 2 小时不补（防止用户反复开关空间疯狂生成）
  if (now - lastVisit < MIN_INTERVAL_MS) return []

  // 窗口内候选自然日：lastVisit 所在日之后（不含当天，那天已结算）→ anchorDay（含），最多 MAX_BACKFILL_DAYS 天
  const lastDay = dayStartOf(lastVisit)
  const todayStart = dayStartOf(now)
  const days: number[] = []
  for (let i = MAX_BACKFILL_DAYS - 1; i >= 0; i--) {
    const day = anchorDay - i * DAY_INTERVAL_MS
    if (day > lastDay) days.push(day)
  }
  days.sort((a, b) => a - b)

  // 生成某天动态的时间戳：今天只在「今天已过去的时段」里挑（最晚 now-5 分钟，最早 7:00），
  // 过去的日子（昨天/前天）用 7:00-23:59 全时段随机——绝不让时间戳落在未来，也绝不被拖到凌晨。
  const pickTime = (day: number): number | null => {
    if (day === todayStart) {
      const lo = day + 7 * 60 * 60 * 1000 // 今天最早 7:00 发圈
      if (now < lo) return null // 现在还没到 7 点：今天 TA 还没发圈，正常
      const hi = now - 5 * 60 * 1000
      if (hi <= lo) return lo + Math.floor(rand() * Math.max(0, hi - lo)) // 极端兜底
      return lo + Math.floor(rand() * (hi - lo))
    }
    return pickDayPostHour(day, rand)
  }

  for (const day of days) {
    const dk = dayKeyOf(day)
    const existing = countPostsOnDay(posts, dk)
    if (existing >= MAX_POSTS_PER_DAY) continue
    const isEvent = activeDays.has(dk)
    if (isEvent) {
      // 事件日：必补，补到当天 ≤2 条（大事当天发，不拖不卡）
      const slots = MAX_POSTS_PER_DAY - existing
      const times: number[] = []
      for (let s = 0; s < slots; s++) {
        const t = pickTime(day)
        if (t == null) continue
        times.push(t)
      }
      // 同一天两条错开至少 3 小时：第二条在第一条 +3h 后重新取（不挤在一个点，也绝不超过 now）
      times.sort((a, b) => a - b)
      for (let s = 0; s < times.length; s++) {
        if (s === 0) {
          out.push(times[s])
        } else {
          const lo = times[s - 1] + 3 * 60 * 60 * 1000
          const hi = Math.min(now - 5 * 60 * 1000, day + 23 * 60 * 60 * 1000 - 1)
          if (hi <= lo) continue // 排不开第二条就不硬塞（每天 ≥1 条已达标）
          const t = lo + Math.floor(rand() * Math.max(0, hi - lo))
          out.push(Math.min(t, hi))
        }
      }
    } else {
      // 非事件日：TA 也有自己的生活——按概率发 1 条，不是天天刷屏
      if (rand() < BACKFILL_LIFE_CHANCE) {
        const t = pickTime(day)
        if (t != null) out.push(t)
      }
    }
  }
  return out.sort((a, b) => a - b)
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

/** 时间轴推进（纯函数）：按回填计划补新动态，更新 lastVisit，去重记录，裁到上限 */
export function advanceTimeline(
  prev: SpaceState,
  vars: TemplateVar,
  now: number,
  activeDays: ReadonlySet<string> = new Set(),
  rand: () => number = Math.random,
): AdvanceResult {
  const timestamps = planBackfillTimestamps(prev.lastVisit, now, prev.posts, activeDays, rand)
  const posts = [...prev.posts]
  const used = { ...prev.used }
  let created = 0
  // timestamps 是升序（旧→新）；正序 unshift 让最新进数组头部，列表保持「最新在前」
  for (const ts of timestamps) {
    // 每天 ≤2 条兜底：目标日已满 2 条就跳过这条（窗口/边缘情况保护）
    if (countPostsOnDay(posts, dayKeyOf(ts)) >= MAX_POSTS_PER_DAY) continue
    // 每条动态按自己的时间戳算时段/季节（回填昨天就用昨天的时段，凌晨不穿帮）
    const dayVars: TemplateVar = { ...vars, timeWord: getTimeWord(ts), season: getSeason(ts) }
    const g = generatePost(dayVars, used, ts, rand)
    used[g.templateKey] = now
    posts.unshift(g.post)
    created++
  }
  return { state: { posts: posts.slice(0, MAX_POSTS), lastVisit: now, used }, created }
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
