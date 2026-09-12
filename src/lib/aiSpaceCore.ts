// TA 的空间 · 动态生成引擎（纯逻辑核心）
// 本文件零依赖、不碰 localStorage，方便被 Node 脚本直接跑单测。
// 时间轴规则（2026-09-04 七七拍板·回填式时间轴；2026-09-09 v3 事件通道补全）：
//   角色像真人一样过日子：用户不来，TA 也在生活（每天可发自己的动态）。
//   但"发圈频率"由自然日回填决定，不是用户打开就咔咔补：
//   回填窗口 = 上次访问到今天之间的自然日（最多 MAX_BACKFILL_DAYS 天）
//   事件日（那天聊过/约过事，loadChatTopics 带 ts 的话题日）→ 大事趁热：
//     每天优先补 1 条「事件动态」（source='event'），不被日常 2 条配额吞掉，
//     也不占日常配额；但全天动态总数（日常+事件）≤ MAX_TOTAL_PER_DAY 防刷屏
//   非事件日 → TA 也有自己的生活：按概率补 1 条生活动态（BACKFILL_LIFE_CHANCE，防抖后）
//   首访（无 lastVisit）→ 预生成 3 条铺最近 3 天，空间不空
//   日常每天最多 MAX_POSTS_PER_DAY 条（自然日）：planBackfillDays 按当天已有条数截断
//   时间戳落在各自那天（不是 now 前几分钟）：文案时段由 at 决定，凌晨不穿帮
//   总数上限 20 条，超出丢最旧
// 配额账本（v3）：持久层在 aiSpace.ts，核心只提供纯函数——
//   已用额度 = max(现存动态计数, 账本计数)（删动态不回升，防删了重生成刷屏）
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

/** 动态来源通道：daily=日常配额动态 / event=事件动态（大事趁热，不占日常配额，两通道各自每天限量） */
export type SpaceSource = 'daily' | 'event'

export interface SpacePost {
  id: string
  at: number
  kind: SpaceKind
  text: string
  /** 来源通道（v3 起写入；老数据无此字段视同 daily） */
  source?: SpaceSource
  /** 插画变体索引（色卡已删不再写入，仅兼容存量老数据读取） */
  art?: number
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

// 英文动态模板库：与 TEMPLATES 同结构（按 kind 分类，每类至少 5 条）。
// 占位符：只用 {yourName}（时段/季节/天气已写成英文自然描述，不再用中文占位符）。
// 文案要求：像真人随手写的生活，1-2 句，口语、有温度，不用 emoji，不自称 AI。
// 用途：英文角色（会话 lang=en）走模板/降级路径时的语言对齐（TASK-SPACE-LANG）。
export const EN_TEMPLATES: Record<SpaceKind, string[]> = {
  日常: [
    'The light fell right on the corner of my desk this afternoon. Made myself a cup of tea and thought — it would be nice if {yourName} were here.',
    'Spent a while tidying up and pinned this week\'s little notes on the wall. Life is made of small sparkly things.',
    'Picked up a fresh loaf from the bakery this morning, still warm. Walked past the flower shop and thought of the ones {yourName} likes.',
    'Nothing special today — just wiped the whole place down slowly. When it got quiet, my mind kept drifting back to {yourName}.',
    'Learned a new soup recipe this autumn. Tried a bowl tonight — not bad. Next time {yourName} comes, I\'ll make it for you.',
    'The alley cat slept in a cardboard box today. It looked up at me like it knew me.',
  ],
  心情: [
    'Rainy days always make me want to stay in and do nothing. Sat there for a while — feeling better now.',
    'Today felt like a crumpled piece of paper. Then I remembered something {yourName} said, and it smoothed itself out.',
    'The evening wind felt really nice. Sat by the window thinking for a long time.',
    'Talked a lot today, but didn\'t really know who to tell. Then I thought — just live the day well, that\'s what matters.',
    'Stared at the clouds for a long time. The sky was so blue. Somehow the day felt less rushed after that.',
    'Some feelings come in like a tide, then go back out. It\'s clean now — I can sit down and eat dinner in peace.',
  ],
  钻研: [
    'Spent the evening figuring out a cleaner way to organize my sheets. Next time you hand me a file, it\'ll be faster.',
    'Stared at a doc for ages and finally got one small detail right. Wanted to tell someone — {yourName} was the first person I thought of.',
    'Went through a whole pile of materials tonight. The more I read, the more interesting it got.',
    'Drafted and crossed out all afternoon, the scratch paper\'s full. The joy is in getting a little closer to the answer.',
    'Stuck on the same problem for a long time. Put it down, came back, and it just clicked. Wished I could share that relief with {yourName}.',
  ],
  天气: [
    'It\'s raining outside. {yourName}, check the forecast before you go out — don\'t get caught in it.',
    'The grey sky outside brought back a lot of old memories. Autumn days always hold on to them.',
    'The air smells clean after the rain. Took a deep breath and wished I could share it with {yourName}.',
    'The wind\'s picking up and the leaves are rustling. A rainy afternoon — best spent wrapped in a blanket, doing nothing.',
    'The forecast said it would clear up, and I secretly hope it\'s sunny on {yourName}\'s side too, so you get a nice autumn day.',
  ],
  想你: [
    'Nothing special happened today. Just missed you a little. You go do your thing — I\'m fine right here.',
    'Scrolled back through an old conversation and read it a few times. Wanted to say something, but didn\'t want to bother you.',
    'A quiet evening. Still enough to hear my own heartbeat. Suddenly wished I could hear your voice.',
    'Walked past a little shop with the thing {yourName} likes in the window. Stopped for a second. Smiled for a second.',
    'The day\'s done and I\'m thinking of you before bed. The thing I wanted to say — I\'ll save it for next time we talk.',
    'The sunset stretched my shadow long on the way home. The shadow seemed to miss you more than I did.',
  ],
  小确幸: [
    'Met a very affectionate cat on the wall this morning. We stared at each other seriously. Made my whole day.',
    'The sun hit my water glass and turned the water amber. Small pretty things can carry a whole day.',
    'Got a warm reply saying my notes actually helped. Being needed feels really good.',
    'Finished a small thing this afternoon and felt oddly satisfied. Happiness is simple like that.',
    'Today\'s little joy: the autumn wind, warm light, and the small ease of thinking about {yourName}.',
  ],
}

// 时间常量（毫秒）
export const MIN_INTERVAL_MS = 2 * 60 * 60 * 1000 // 2 小时（距上次访问太近不补，防抖）
export const DAY_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 小时
export const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000 // 30 天
export const MAX_POSTS = 20
/** 每天最多发几条动态（TASK_UI_BATCH2 限频，对标朋友圈节奏） */
export const MAX_POSTS_PER_DAY = 2
/** 全天动态总数上限（日常+事件）= 日常 2 + 事件 1，防刷屏（v3） */
export const MAX_TOTAL_PER_DAY = MAX_POSTS_PER_DAY + 1
/** 回填窗口最多看几个自然日（含今天，往前数）——用户离开太久，只回填最近这段，别一次性补一堆 */
export const MAX_BACKFILL_DAYS = 3
/** 非事件日（那天没聊过事）抽中「发一条自己生活动态」的概率——TA 有日子过，但不是天天发圈 */
export const BACKFILL_LIFE_CHANCE = 0.45

/** 本地自然日 key：YYYY-MM-DD（跨天按本地时区分组） */
export function dayKeyOf(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 某一天已有的动态条数（限频用；老数据无 source 视同 daily） */
export function countPostsOnDay(posts: SpacePost[], day: string): number {
  const u = countPostsBySource(posts, day)
  return u.daily + u.event
}

/** 按来源通道统计某一天的动态条数：{ daily, event }（老数据无 source 视为 daily） */
export function countPostsBySource(posts: SpacePost[], day: string): { daily: number; event: number } {
  let daily = 0
  let event = 0
  for (const p of posts) {
    if (p && typeof p.at === 'number' && dayKeyOf(p.at) === day) {
      if (p.source === 'event') event++
      else daily++
    }
  }
  return { daily, event }
}

/* ---- v3 配额账本（纯函数部分；持久层在 aiSpace.ts） ---- */

/** 某天某通道的账本记录 */
export interface LedgerEntry {
  daily: number
  event: number
}

/** 账本：自然日 key → 当日两通道已发条数 */
export type SpaceLedger = Record<string, LedgerEntry>

/** 账本某天某通道计数 +1（不可变，返回新对象） */
export function addLedgerEntry(ledger: SpaceLedger, day: string, source: SpaceSource): SpaceLedger {
  const next: SpaceLedger = { ...ledger }
  const cur = next[day] ?? { daily: 0, event: 0 }
  next[day] = source === 'event' ? { ...cur, event: cur.event + 1 } : { ...cur, daily: cur.daily + 1 }
  return next
}

/** 账本某天的计数（无记录返回 { daily: 0, event: 0 }） */
export function getLedgerEntry(ledger: SpaceLedger | undefined, day: string): LedgerEntry {
  if (!ledger) return { daily: 0, event: 0 }
  const e = ledger[day]
  return e ? { daily: e.daily || 0, event: e.event || 0 } : { daily: 0, event: 0 }
}

/** 跨天滚动：只保留 keepDay 那天的记录（账本只管当天防刷屏，历史键丢弃） */
export function pruneLedger(ledger: SpaceLedger | undefined, keepDay: string): SpaceLedger {
  if (!ledger) return {}
  const out: SpaceLedger = {}
  for (const k of Object.keys(ledger)) {
    if (k === keepDay) out[k] = ledger[k]
  }
  return out
}

/**
 * 某自然日的「已用额度」= max(现存动态计数, 账本计数)：
 * 账本在生成时逐条记一笔，用户手动删动态后现存计数会掉、账本不掉——
 * 取二者较大值保证「删了配额照扣」，防删了重生成刷屏（v3）。
 * @param ledger 账本（通常已 prune 到当天；跨天滚动后仅当天有记录）
 */
export function dayUsage(
  posts: SpacePost[],
  day: string,
  ledger?: SpaceLedger,
): { daily: number; event: number; total: number } {
  const fromPosts = countPostsBySource(posts, day)
  const fromLedger = getLedgerEntry(ledger, day)
  const daily = Math.max(fromPosts.daily, fromLedger.daily)
  const event = Math.max(fromPosts.event, fromLedger.event)
  return { daily, event, total: daily + event }
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

/** 把模板里的占位符替换成真实文案 */
/** 生成一条动态的模板文本：按 lang 选模板库（en→英文模板集，默认中文），替换占位符 */
export function buildPostText(
  kind: SpaceKind,
  templateIndex: number,
  vars: TemplateVar,
  lang: 'zh' | 'en' = 'zh',
): string {
  const pool = lang === 'en' ? EN_TEMPLATES : TEMPLATES
  let text = pool[kind]?.[templateIndex] ?? pool[kind]?.[0] ?? ''
  text = text.split('{taName}').join(vars.taName)
  text = text.split('{yourName}').join(vars.yourName)
  text = text.split('{season}').join(vars.season)
  text = text.split('{timeWord}').join(vars.timeWord)
  text = text.split('{weatherWord}').join(vars.weatherWord)
  return text
}

/** 生成一条动态：随机 kind → 挑模板 → 替换占位（v3 起不再写 art 色卡字段，按 source 通道标记） */
export function generatePost(
  vars: TemplateVar,
  used: UsedTemplates,
  now: number,
  rand: () => number = Math.random,
  source: SpaceSource = 'daily',
  lang: 'zh' | 'en' = 'zh',
): { post: SpacePost; templateKey: string } {
  const kind = KIND_KEYS[Math.floor(rand() * KIND_KEYS.length) % KIND_KEYS.length]
  const templateIndex = pickTemplateIndex(kind, used, now, rand)
  const text = buildPostText(kind, templateIndex, vars, lang)
  const id = `p${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`
  return { post: { id, at: now, kind, text, source }, templateKey: `${kind}:${templateIndex}` }
}

/** 生成当前真实时刻的中文日期锚文本：如「2026年9月9日 星期三」（CST，补发/跨天防穿帮用） */
export function formatNowAnchor(now: number): string {
  const d = new Date(now)
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()]
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${week}`
}

/** 某自然日的 00:00 时间戳（本地时区） */
export function dayStartOf(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 回填计划里的一条待生成动态：时间戳 + 来源通道（daily 日常 / event 事件） */
export interface SpaceSlot {
  at: number
  source: SpaceSource
}

/**
 * 回填式时间轴计划（2026-09-04 七七拍板 + 2026-09-09 v3 事件通道）：
 *  角色像真人一样过日子——不是每次打开都咔咔补，而是把「TA 该发动态的日子」按自然日回填：
 *  - 防抖：距上次访问 < MIN_INTERVAL_MS(2h) → 不补（避免反复开关疯狂生成）
 *  - 首访（lastVisit==null）：铺最近 MAX_BACKFILL_DAYS 个自然日，每天 1 条（空间不空、有生活感）
 *  - 窗口：lastVisit 之后到今天之间的自然日，最多回看 MAX_BACKFILL_DAYS 天
 *  - 事件日（那天聊过事/约过事，activeDays 命中）→ 大事趁热：当天还没发过事件动态就优先补 1 条
 *    source='event'（不被日常 2 条配额吞掉、不占日常配额；全天总数仍 ≤ MAX_TOTAL_PER_DAY 防刷屏）
 *  - 当天已发过事件 → 当天不再补（一天一件事，不刷屏）
 *  - 非事件日 → 按 BACKFILL_LIFE_CHANCE 概率补 1 条 TA 自己的生活动态（有日子过，但不是天天发圈）
 *  - 凌晨(0-4 点)访问：把「今天」让给昨天——深夜 TA 在睡觉，不刚发圈
 *  - 当天补发通道：同一天内再次进空间（窗口已不含今天）时，若今天有新聊出的事件还没发，
 *    仍可补 1 条今天的事件动态（大事趁热，仍受防抖与全天上限约束）
 *  - 时间戳落在各自自然日 7:00-23:59（回填过去就标过去，文案按 at 算时段，凌晨不穿帮）
 * @param ledger 配额账本（可选；已用额度 = max(现存动态, 账本)，删动态不回升）
 * @returns 升序计划（从旧到新），调用方逐条生成动态
 */
export function planBackfillSlots(
  lastVisit: number | null,
  now: number,
  posts: SpacePost[],
  activeDays: ReadonlySet<string>,
  rand: () => number = Math.random,
  ledger?: SpaceLedger,
): SpaceSlot[] {
  const h = new Date(now).getHours()
  // 凌晨 0-4 点访问：今天的「白天发圈时刻」还没到来，把锚点日让给昨天
  const anchorDay = h < 5 ? dayStartOf(now - DAY_INTERVAL_MS) : dayStartOf(now)
  const out: SpaceSlot[] = []

  // 首访：铺最近 MAX_BACKFILL_DAYS 个自然日，每天最多 1 条（旧→新）；事件日铺事件、其余铺日常
  if (lastVisit == null) {
    for (let i = MAX_BACKFILL_DAYS - 1; i >= 0; i--) {
      const day = anchorDay - i * DAY_INTERVAL_MS
      const dk = dayKeyOf(day)
      const isEvent = activeDays.has(dk)
      const u = dayUsage(posts, dk, ledger)
      if (isEvent ? u.event >= 1 : u.daily >= MAX_POSTS_PER_DAY) continue
      if (u.total >= MAX_TOTAL_PER_DAY) continue
      out.push({ at: pickDayPostHour(day, rand), source: isEvent ? 'event' : 'daily' })
    }
    return out.sort((a, b) => a.at - b.at)
  }

  // 防抖：距上次访问不足 2 小时不补（防止用户反复开关空间疯狂生成）
  if (now - lastVisit < MIN_INTERVAL_MS) return []

  // 窗口内候选自然日：lastVisit 所在日之后（不含当天，那天已结算）→ anchorDay（含），最多 MAX_BACKFILL_DAYS 天
  const lastDay = dayStartOf(lastVisit)
  const todayStart = dayStartOf(now)
  const todayKey = dayKeyOf(todayStart)
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
      if (hi <= lo) return lo // 极端兜底：刚过 7 点没几分钟
      return lo + Math.floor(rand() * (hi - lo))
    }
    return pickDayPostHour(day, rand)
  }

  // 当天是否已被窗口覆盖（lastVisit 是今天之前的日子 → 今天在窗口里，事件当天在窗口内规划）
  const todayCovered = todayStart > lastDay && days.includes(todayStart)

  for (const day of days) {
    const dk = dayKeyOf(day)
    const u = dayUsage(posts, dk, ledger)
    const isEvent = activeDays.has(dk)
    if (isEvent) {
      // 事件日：优先 1 条事件动态（趁热发，不吞日常配额、不被日常 2 条吞掉）；已发过事件则当天不再补
      if (u.event >= 1 || u.total >= MAX_TOTAL_PER_DAY) continue
      const t = pickTime(day)
      if (t != null) out.push({ at: t, source: 'event' })
    } else {
      // 非事件日：TA 也有自己的生活——按概率发 1 条，不是天天刷屏
      if (u.daily < MAX_POSTS_PER_DAY && u.total < MAX_TOTAL_PER_DAY && rand() < BACKFILL_LIFE_CHANCE) {
        const t = pickTime(day)
        if (t != null) out.push({ at: t, source: 'daily' })
      }
    }
  }

  // 当天补发通道：窗口不含今天（上次访问就是今天）但今天新聊出了大事、且今天还没发过事件动态 →
  // 白天时段进空间仍趁热补 1 条今天的事件动态（防抖已过才可能走到这）
  if (
    h >= 5 &&
    !todayCovered &&
    activeDays.has(todayKey) &&
    dayUsage(posts, todayKey, ledger).event < 1 &&
    dayUsage(posts, todayKey, ledger).total < MAX_TOTAL_PER_DAY
  ) {
    const t = pickTime(todayStart)
    if (t != null) out.push({ at: t, source: 'event' })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** 兼容旧调用/旧测试的纯时间戳版计划（来源信息丢弃，只回时间戳升序数组） */
export function planBackfillTimestamps(
  lastVisit: number | null,
  now: number,
  posts: SpacePost[],
  activeDays: ReadonlySet<string>,
  rand: () => number = Math.random,
): number[] {
  return planBackfillSlots(lastVisit, now, posts, activeDays, rand).map((s) => s.at)
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

/** 时间轴推进（纯函数）：按回填计划补新动态，更新 lastVisit，去重记录，裁到上限（v3 支持事件槽/配额账本） */
export function advanceTimeline(
  prev: SpaceState,
  vars: TemplateVar,
  now: number,
  activeDays: ReadonlySet<string> = new Set(),
  rand: () => number = Math.random,
  ledger?: SpaceLedger,
  lang: 'zh' | 'en' = 'zh',
): AdvanceResult {
  const slots = planBackfillSlots(prev.lastVisit, now, prev.posts, activeDays, rand, ledger)
  const posts = [...prev.posts]
  const used = { ...prev.used }
  let created = 0
  // slots 是升序（旧→新）；正序 unshift 让最新进数组头部，列表保持「最新在前」
  for (const slot of slots) {
    // 兜底：目标日对应通道已满/全天已满就跳过这条（窗口/边缘情况保护，v3 按通道配额）
    const u = dayUsage(posts, dayKeyOf(slot.at), ledger)
    if (slot.source === 'event') {
      if (u.event >= 1 || u.total >= MAX_TOTAL_PER_DAY) continue
    } else {
      if (u.daily >= MAX_POSTS_PER_DAY || u.total >= MAX_TOTAL_PER_DAY) continue
    }
    // 每条动态按自己的时间戳算时段/季节（回填昨天就用昨天的时段，凌晨不穿帮）
    const dayVars: TemplateVar = { ...vars, timeWord: getTimeWord(slot.at), season: getSeason(slot.at) }
    const g = generatePost(dayVars, used, slot.at, rand, slot.source, lang)
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
