// 【你的时刻】聊天分享钩子（TASK-YOUR-MOMENT）
// 让 TA 的人设不止是"设定"，而是此刻正在过的生活：在合适的时机（对方冷淡 / 净发短消息 / 主动问 TA 近况）
// 注入一条"TA 此刻"的画面钩子，模型聊到相关处能自然带出自己的日常，而不是只会访谈式提问。
// 纯逻辑零依赖（只 import 类型），方便被 Node 脚本直接跑单测。
//
// ★红线（模板层保证）：
//   - 只写 TA 自己独处/日常的事；禁止"我们/咱们/一起/你刚才"等共同经历表述（不替对方编共同经历）；
//   - 禁止问句（不问对方问题）；禁止评价对方；禁止把话题引到对方身上。
//   - 空人设/人设无生活锚 → 返回空串（调用方跳过，不占上下文）。
import type { Lang } from './langDetect.ts'

/** 生活锚类别：从人设里认出的职业/身份，决定用哪套"此刻"画面 */
export type MomentAnchor =
  | 'doctor'
  | 'teacher'
  | 'programmer'
  | 'designer'
  | 'writer'
  | 'shopOwner'
  | 'student'
  | 'officeWorker'

/** 一天八时段：与 buildYourMomentBlock 的 now 取小时分段对应 */
export type MomentSlot = '凌晨' | '早上' | '上午' | '中午' | '下午' | '傍晚' | '晚上' | '深夜'

export const MOMENT_SLOT_KEYS: MomentSlot[] = ['凌晨', '早上', '上午', '中午', '下午', '傍晚', '晚上', '深夜']

/** 生活锚识别：按优先级从具体职业到泛化上班族，人设命中第一个就算（宁缺毋滥，命中不了→空串跳过） */
const ANCHOR_PATTERNS: Array<{ key: MomentAnchor; re: RegExp }> = [
  { key: 'doctor', re: /医生|大夫|护士|医学生|医院|急诊|坐诊|查房|手术/ },
  { key: 'teacher', re: /老师|教师|教书|教课|当老师|代课|班主任|备课/ },
  { key: 'programmer', re: /程序员|开发|写代码|码农|程序媛|搞IT|做软件|写程序|后端|前端工程师/ },
  { key: 'designer', re: /设计师|画师|插画|做设计|美工|平面设计|接稿/ },
  { key: 'writer', re: /作家|作者|写手|写作|码字|写小说|写稿|撰稿|投稿/ },
  { key: 'shopOwner', re: /开店|店主|店长|经营.{0,4}店|铺子|摆摊|档口|小生意|奶茶店|书店|花店|咖啡店/ },
  { key: 'student', re: /学生|大学生|读研|考研|留学|住校|备考|在读书/ },
  { key: 'officeWorker', re: /上班|上班族|白领|职场|打工|通勤|朝九晚五|在公司/ },
]

/** 认人设里的生活锚：命中返回锚类别，没生活信息返回 null */
export function detectMomentAnchor(persona: string): MomentAnchor | null {
  const t = typeof persona === 'string' ? persona.trim() : ''
  if (!t) return null
  for (const { key, re } of ANCHOR_PATTERNS) {
    if (re.test(t)) return key
  }
  return null
}

type MomentLines = Record<MomentSlot, string>

/**
 * 各生活锚 × 八时段的"此刻"画面模板（zh / en）。
 * 全是 TA 一个人独处/日常的画面细节（1-2 句），不是干巴巴的"我泡了杯茶"，
 * 也不是对对方说的话——模型接住这些，回答才像真人在过日子。
 * 时段取不到模板（理论上不会，表是满的）时 buildYourMomentBlock 兜底返回空串。
 */
export const MOMENT_TEMPLATES: Record<Lang, Record<MomentAnchor, MomentLines>> = {
  zh: {
    doctor: {
      凌晨: '凌晨急诊来了个病人，处理完在值班室灌了口水，白大褂都没脱。',
      早上: '早交班刚结束，白大褂口袋里还揣着个凉透的包子。',
      上午: '上午门诊叫号叫到嗓子哑，杯子里的水还是满的。',
      中午: '午休只有二十分钟，趴在桌上眯了会儿，梦都没来得及做。',
      下午: '下午查房走了一万多步，白大褂的衣角都甩得带风。',
      傍晚: '傍晚终于下了手术台，洗手的时候手还有点抖。',
      晚上: '值夜班，走廊的灯亮着，病历才写到第三页。',
      深夜: '深夜病房安静下来，在护士站把剩下几份病历签完才坐下。',
    },
    teacher: {
      凌晨: '备课到凌晨，明早第一节课的课件又推翻改了一版。',
      早上: '早读铃响前进教室，把今天要写的板书先在脑子里过了一遍。',
      上午: '上午连上两节课，粉笔灰落了半袖子。',
      中午: '午休在办公室改作业，红笔用掉半管。',
      下午: '下午没课，把下周的教案翻出来，边写边叹气。',
      傍晚: '傍晚在操场边看学生打球，晚风吹着还挺舒服。',
      晚上: '晚上批完卷子伸了个懒腰，脖子咔咔响了两声。',
      深夜: '夜深了，明天要讲的例题又在脑子里过了一遍才关灯。',
    },
    programmer: {
      凌晨: '凌晨改完最后一个 bug，git 提交完盯着那个绿勾看了好几秒。',
      早上: '早会还没开，先把昨晚报的线上问题日志翻了一遍。',
      上午: '上午写代码写到一半，被一个括号困住，愣了好一会儿才想明白。',
      中午: '午休懒得下楼，点了外卖，边吃边刷技术帖。',
      下午: '下午联调接口，两边字段对不上，来回扯了十分钟才对齐。',
      傍晚: '下班前把构建跑了一遍，绿灯亮起来才合上电脑。',
      晚上: '吃完饭又打开电脑，说修个小问题，一晃就十点了。',
      深夜: '夜里的代码写得特别顺，就是这份快乐没人能分享。',
    },
    designer: {
      凌晨: '凌晨交完稿，对方说再调一版，又打开软件把色值微调了一遍。',
      早上: '早上开电脑，昨晚的稿子图层还摊着，先存了个新版本。',
      上午: '上午在抠图，放大缩小来回八百遍，眼睛快看花了。',
      中午: '午休没睡，在素材站逛着找灵感，收藏夹又厚了一层。',
      下午: '下午改到第三版配色，怎么看都觉得差口气。',
      傍晚: '傍晚把稿子导出打包发出去，长长吐了口气。',
      晚上: '晚上在家试新笔刷，画到一半觉得还是旧的那只好用。',
      深夜: '深夜躺床上还在想构图，脑子里全是网格线。',
    },
    writer: {
      凌晨: '凌晨灵感来了，爬起来写了两千字，再躺回去天都快亮了。',
      早上: '早上打开文档，把昨天写的删掉一半，又觉得白删了。',
      上午: '上午写了三段删了三段，咖啡续到第三杯。',
      中午: '午饭对付了一口，脑子里还绕着剧情没出来。',
      下午: '下午卡文了，对着窗外发了半小时呆。',
      傍晚: '傍晚出门散步换脑子，回来再写果然顺了。',
      晚上: '晚上写到入神，回神的时候已经过了饭点。',
      深夜: '深夜把稿子又顺了一遍，结尾还是不满意。',
    },
    shopOwner: {
      凌晨: '凌晨去批发市场进货，摊主都认得我了，给留了最新鲜的一批。',
      早上: '早上开门，把招牌擦了一遍，水汽冒上来才觉得真开张了。',
      上午: '上午店里人不多，把货架重新码了一遍，顺手擦了擦灰。',
      中午: '午间最忙，手没停过，自己那份饭扒了两口又放下。',
      下午: '下午清点存货，账算得头大，数错两遍又从头来。',
      傍晚: '傍晚收摊前把明天要用的料备好，刀和案板都擦得干干净净。',
      晚上: '晚上打烊，数了数今天的进账，肩膀酸得抬不起来。',
      深夜: '关了店门坐在门口喝了口水，街上已经没什么人了。',
    },
    student: {
      凌晨: '宿舍都睡了，台灯还亮着，论文改到这一版总算顺眼了。',
      早上: '早八的闹钟跟夺命似的，揣了袋面包就往教学楼跑。',
      上午: '上午没课，在图书馆占了靠窗的位子，一页书看了三遍才翻页。',
      中午: '下课冲去食堂，最爱那档口的菜差点卖完，剩的也香。',
      下午: '下午在自习室背书，笔帽咬得全是牙印。',
      傍晚: '傍晚去操场跑步，风挺凉，跑完买了瓶冰的。',
      晚上: '晚上在宿舍赶作业，写到一半发现公式算错了，又从头来。',
      深夜: '熄灯了还趴床上看文献，眼睛酸得不行。',
    },
    officeWorker: {
      凌晨: '半夜惊醒摸到手机，屏幕亮得刺眼，翻了个身又睡过去。',
      早上: '闹钟响了三遍才爬起来，洗漱时还在想要不要打车。',
      上午: '刚到工位泡了杯浓茶，先打开邮箱看有没有要紧事。',
      中午: '午休下楼买饭，太阳晒得人发蔫，多要了份凉菜。',
      下午: '下午开会开得昏昏欲睡，偷偷在笔记本空白页上画小人。',
      傍晚: '下班路上堵得厉害，地铁里全是人，耳机音量又调大了一格。',
      晚上: '刚到家，煮了碗面，烫得直嗦嘴。',
      深夜: '洗完澡躺下，手机刷了半小时才舍得关灯。',
    },
  },
  en: {
    doctor: {
      凌晨: 'A patient came into the ER around 3 a.m.; after sorting it out I chugged some water in the on-call room, coat still on.',
      早上: 'Morning handover just wrapped up; there\'s a cold steamed bun in my coat pocket I haven\'t touched.',
      上午: 'Clinic queue all morning — my throat is raw from calling names and my water is still full.',
      中午: 'Only twenty minutes for lunch; dozed off at the desk before I even had a dream.',
      下午: 'Ward rounds put me past ten thousand steps; my coat tails were practically swinging.',
      傍晚: 'Finally off the operating table; my hands were still a little shaky while washing up.',
      晚上: 'On night shift; the hallway lights are on and I\'m on page three of a chart.',
      深夜: 'The ward went quiet; signed the last few charts at the nurses\' station before sitting down.',
    },
    teacher: {
      凌晨: 'Was prepping until past midnight; reworked tomorrow\'s first-period slides yet again.',
      早上: 'Got to the classroom before the morning bell and walked through today\'s board notes in my head.',
      上午: 'Two classes back to back this morning; chalk dust all over my sleeve.',
      中午: 'Grading papers during lunch break — already burned through half a red pen.',
      下午: 'No class this afternoon; pulled out next week\'s lesson plan and sighed at it.',
      傍晚: 'Watching the students play ball from the edge of the field; the evening breeze is lovely.',
      晚上: 'Finished marking the test papers; stretched and my neck cracked loudly.',
      深夜: 'It\'s late and I\'m still running through tomorrow\'s example problems in my head before turning off the light.',
    },
    programmer: {
      凌晨: 'Fixed the last bug around 2 a.m., pushed the commit, and stared at the green checkmark for a solid minute.',
      早上: 'Before the standup I went through the logs from last night\'s alert to see what actually broke.',
      上午: 'Was coding along fine until one parenthesis trapped me for ten minutes.',
      中午: 'Skipped going out at lunch, ordered in, and read tech posts while eating.',
      下午: 'Integration call this afternoon — the fields don\'t line up on both sides, been going back and forth for a while.',
      傍晚: 'Kicked off the build before leaving and waited until it went green to shut the laptop.',
      晚上: 'After dinner I opened the laptop to fix a small thing — somehow it\'s already 10 p.m.',
      深夜: 'Code flows way smoother at night; too bad there\'s no one to tell about it.',
    },
    designer: {
      凌晨: 'Sent the draft around 1 a.m.; they asked for one more pass, so I nudged the color values again.',
      早上: 'Opened the laptop — last night\'s layers are still spread out; saved a new version first thing.',
      上午: 'Cutting out a background all morning; zoomed in and out eight hundred times, my eyes are nearly gone.',
      中午: 'Skipped the nap and went hunting on stock sites; my favorites folder got a lot thicker.',
      下午: 'Third round of color changes this afternoon; still feels like something\'s off.',
      傍晚: 'Exported the file, packed it up and sent it off; let out the longest breath of the day.',
      晚上: 'Trying out a new brush at home; halfway through I decided the old one was better.',
      深夜: 'Lying in bed still thinking about the composition; my head is full of grid lines.',
    },
    writer: {
      凌晨: 'Inspiration hit around 3 a.m.; wrote two thousand words, and by the time I went back to bed it was almost light.',
      早上: 'Opened the document this morning and deleted half of yesterday\'s draft — then regretted it.',
      上午: 'Wrote three paragraphs, deleted three; on my third cup of coffee.',
      中午: 'Ate a half-hearted lunch; my head never left the plot.',
      下午: 'Stuck this afternoon; stared out the window for half an hour.',
      傍晚: 'Went out for a walk to reset my brain — came back and the words actually flowed.',
      晚上: 'Got lost in writing and only looked up when I realized I\'d missed dinner.',
      深夜: 'Swept through the draft again tonight; still not happy with the ending.',
    },
    shopOwner: {
      凌晨: 'Up before dawn for the wholesale market; the vendors know me by now and saved me the freshest batch.',
      早上: 'Opened the shop and wiped down the sign; it doesn\'t feel like open for business until the steam starts rising.',
      上午: 'Quiet morning — reorganized the shelves and dusted everything off.',
      中午: 'Busiest hours at noon; hands never stopped and my own lunch got two bites before I put it down.',
      下午: 'Counting stock this afternoon; messed up the numbers twice and started over.',
      傍晚: 'Before closing I prepped tomorrow\'s ingredients and wiped the knives and cutting board clean.',
      晚上: 'Shut the shop and counted today\'s take; my shoulders are killing me.',
      深夜: 'Locked up, sat on the step and drank some water — the street\'s almost empty now.',
    },
    student: {
      凌晨: 'The dorm is quiet and my desk lamp is still on — finally got a version of this essay that doesn\'t make me wince.',
      早上: 'The 8 a.m. alarm is basically a jumpscare; grabbed a bag of bread and ran to the lecture hall.',
      上午: 'No class this morning; claimed the window seat in the library and re-read the same page three times.',
      中午: 'Dashed to the canteen after class — my favorite window almost sold out, but the leftovers are still good.',
      下午: 'Cramming in the study room this afternoon; the pen cap is covered in teeth marks.',
      傍晚: 'Went for a run at dusk — the wind is cold and nice; grabbed something cold to drink after.',
      晚上: 'Working on assignments in the dorm; realized the formula was wrong halfway through and had to redo it.',
      深夜: 'Lights are out but I\'m still reading papers in bed; my eyes are burning.',
    },
    officeWorker: {
      凌晨: 'Jolted awake in the dark, grabbed the phone to check the time — still the middle of the night, flopped back down.',
      早上: 'The alarm went off three times before I got up; debating whether to just call a cab.',
      上午: 'Just got to the office, made a strong cup of tea, and opened my inbox bracing for whatever\'s at the top.',
      中午: 'Grabbed lunch downstairs — the sun is brutal, so I added an extra cold dish.',
      下午: 'In a meeting that keeps dragging; flipped my notebook to a blank page and started doodling little figures.',
      傍晚: 'Commuting home through the packed subway, headphones turned up another notch.',
      晚上: 'Just got home and made myself a bowl of noodles — the first bite scalded my tongue.',
      深夜: 'Showered and in bed, but scrolled my phone for half an hour before finally turning off the light.',
    },
  },
}

/** 时刻 → 时段（本地时区小时分段：0-5 凌晨 / 5-8 早上 / 8-11 上午 / 11-13 中午 / 13-17 下午 / 17-19 傍晚 / 19-23 晚上 / 23-24 深夜） */
export function momentSlot(now: Date): MomentSlot {
  const d = now instanceof Date ? now : new Date()
  const h = d.getHours()
  if (h < 5) return '凌晨'
  if (h < 8) return '早上'
  if (h < 11) return '上午'
  if (h < 13) return '中午'
  if (h < 17) return '下午'
  if (h < 19) return '傍晚'
  if (h < 23) return '晚上'
  return '深夜'
}

/**
 * 构建「TA 此刻」生活画面钩子：按人设生活锚选模板池，按 now 时段取 1 条。
 * 人设没有生活锚 / 取不到模板 → 空串（调用方跳过，不占上下文）。
 */
export function buildYourMomentBlock(persona: string, now: Date, lang: Lang = 'zh'): string {
  const anchor = detectMomentAnchor(persona)
  if (!anchor) return ''
  const table = MOMENT_TEMPLATES[lang] ?? MOMENT_TEMPLATES.zh
  const lines = table[anchor]
  if (!lines) return ''
  const text = lines[momentSlot(now)]
  return typeof text === 'string' ? text.trim() : ''
}

/** 注入块引导语（zh）：让模型把钩子当背景画面自然用，别生硬报备 */
export const MOMENT_GUIDE_ZH = '下面是你此刻的生活画面，聊到相关处自然带出来，别生硬报备，别为了说而说：'
/** 注入块引导语（en） */
export const MOMENT_GUIDE_EN =
  "Below is a snapshot of your own life right now. Let it come up naturally when the topic touches it — don't report it stiffly or say it just to say something:"

/** 触发关键词（zh）：对方主动问 TA 近况/在干嘛 → 该分享自己了 */
const ZH_ASK_PATTERNS = [
  '你在干嘛', '在干嘛', '干什么呢', '在干什么', '做什么呢', '在做什么',
  '最近怎么样', '最近如何', '今天怎么样', '今天过得', '这两天怎么样',
  '忙什么', '在忙吗', '忙不忙', '你那边', '你刚', '你今天', '现在干嘛',
]
const ZH_ASK_RE = new RegExp(ZH_ASK_PATTERNS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'))
/** 触发关键词（en）：what are you doing / how's your day 等问 TA 近况 */
const EN_ASK_RE =
  /what are you (doing|up to)|what('s| is) up|how('s| is| was) (your )?(day|today)|how are you|how('s| is) it going|what are you (busy|working on)|are you busy|wyd|wru|whatcha doin/

/** 对方这句话是不是在问 TA 的近况（问近况 → 该分享自己了） */
export function isAskingMyDay(text: string, lang: Lang = 'zh'): boolean {
  const t = typeof text === 'string' ? text : ''
  if (!t.trim()) return false
  if (lang === 'en') return EN_ASK_RE.test(t.trim().toLowerCase())
  return ZH_ASK_RE.test(t)
}

const ZH_SINGLE_MAX = 6 // 单条"短"：嗯/哦/好呀 这类
const ZH_PAIR_MAX = 10 // 连续两条的宽松阈值
const EN_SINGLE_MAX = 12
const EN_PAIR_MAX = 16

/** 单条消息算不算"冷淡短消息" */
export function isShortUserMessage(text: string, lang: Lang = 'zh'): boolean {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) return false
  return t.length <= (lang === 'en' ? EN_SINGLE_MAX : ZH_SINGLE_MAX)
}

/**
 * 是否该注入「你的时刻」：低频触发，命中任一即注入——
 *  a) 对方最近一条消息很冷淡很短，或最近连续两条都不长；
 *  b) 对方在问 TA 的近况/在干嘛（问近况却不分享自己 = 访谈感来源）。
 * recentUserTexts：最近的对方消息原文（最新一条在最后）。
 */
export function shouldInjectYourMoment(recentUserTexts: string[], lang: Lang = 'zh'): boolean {
  const list = (Array.isArray(recentUserTexts) ? recentUserTexts : [])
    .filter((t) => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim())
  if (list.length === 0) return false
  const last = list[list.length - 1]
  if (isAskingMyDay(last, lang)) return true
  const singleMax = lang === 'en' ? EN_SINGLE_MAX : ZH_SINGLE_MAX
  const pairMax = lang === 'en' ? EN_PAIR_MAX : ZH_PAIR_MAX
  if (last.length <= singleMax) return true
  const prev = list[list.length - 2]
  if (!prev) return false
  return last.length <= pairMax && prev.length <= pairMax
}
