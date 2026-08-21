// 记忆（记住的事实）读写，localStorage 存储
// 既有字段保持兼容：id / text / createdAt / source；新加的 topic / updatedAt 都是可选字段

export interface MemoryItem {
  id: string
  text: string
  /** 首次记录的时间戳，永远不变（去重命中也不会刷新） */
  createdAt: number
  /** 主题词：TA 记录时带的（如 饮食/宠物/家人…），手动添加可填；旧数据可能没有 */
  topic?: string
  /** 来源：哪次对话的摘要（TA 记住时记下，手动添加的没有此项） */
  source?: string
  /** 兼容旧数据：旧版本去重更新时刷新过的时间，现在不再使用 */
  updatedAt?: number
}

const MEMORY_KEY = 'ai_companion_memory'

/** 记忆数据变更事件名：保存后广播，记忆页等监听到就重新读取 */
export const MEMORY_UPDATED_EVENT = 'memory-updated'

/** 广播"记忆有变化"：同页签内跨组件通知（storage 事件同页签不触发，所以用自定义事件） */
export function notifyMemoryUpdated(): void {
  window.dispatchEvent(new Event(MEMORY_UPDATED_EVENT))
}

export function loadMemory(): MemoryItem[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (m): m is MemoryItem =>
        m != null && typeof m.id === 'string' && typeof m.text === 'string',
    )
  } catch {
    return []
  }
}

export function saveMemory(items: MemoryItem[]): void {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(items))
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 手动添加一条记忆：可填主题，留空默认「其他」 */
export function addMemoryItem(text: string, topic?: string): MemoryItem[] {
  const t = text.trim()
  if (!t) return loadMemory()
  const item: MemoryItem = {
    id: newId(),
    text: t,
    createdAt: Date.now(),
    topic: topic?.trim() || '其他',
  }
  const next = [item, ...loadMemory()]
  saveMemory(next)
  return next
}

export function removeMemoryItem(id: string): MemoryItem[] {
  const next = loadMemory().filter((m) => m.id !== id)
  saveMemory(next)
  return next
}

// ---- TA 自主记住：去重写入 ----

/** 归一化：去空白和常见标点，统一小写，用来比"像不像" */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s　，。！？、,.!?;；：:""''（）()~～—\-·]/g, '')
}

/** 取字符二元组集合，用来算中文短句的相似度 */
function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/** 两条记忆是否高度相似：完全相同、互相包含，或字符重合度很高 */
function isSimilar(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true
  const A = bigrams(a)
  const B = bigrams(b)
  let same = 0
  for (const g of A) if (B.has(g)) same++
  const union = A.size + B.size - same
  if (union === 0) return false
  return same / union > 0.6
}

/**
 * TA 记住一条内容：先去重——和已有记忆高度相似的，只保留原条目，
 * 不新增、不改 createdAt、不刷日期、不累计次数（首次记住的时间永远不变）。
 * 真没有相同内容才新增一条。返回更新后的全部记忆。
 */
export function upsertMemoryItem(text: string, source?: string, topic?: string): MemoryItem[] {
  const trimmed = text.trim()
  if (!trimmed) return loadMemory()
  const items = loadMemory()
  const norm = normalize(trimmed)
  const idx = items.findIndex((m) => isSimilar(normalize(m.text), norm))
  if (idx >= 0) return items

  const item: MemoryItem = {
    id: newId(),
    text: trimmed,
    createdAt: Date.now(),
    source,
    ...(topic?.trim() ? { topic: topic.trim() } : {}),
  }
  const next = [item, ...items]
  saveMemory(next)
  return next
}

// ---- 记忆主题推断（旧数据没有 topic 时展示用） ----

const TOPIC_RULES: Array<[RegExp, string]> = [
  [/吃|喝|辣|甜|口味|饭|菜|食|饿|饱|早餐|午餐|晚餐|奶茶|咖啡|零食/, '饮食'],
  [/猫|狗|宠物|猫咪|小狗|铲屎|毛孩子|遛/, '宠物'],
  [/爸|妈|父母|爸爸|妈妈|爷爷|奶奶|外公|外婆|哥哥|姐姐|弟弟|妹妹|女儿|儿子|家人|孩子|结婚/, '家人'],
  [/睡|病|血压|健康|身体|疼|痛|药|感冒|发烧|失眠|体检|医生|医院|熬夜|胃|头疼/, '健康'],
  [/工作|上班|公司|同事|加班|老板|出差|开会|项目|辞职|离职|入职|绩效|裁员/, '工作'],
  [/生日|纪念日|周年|节日|过节|日期|纪念|周末|长假/, '日子'],
]

/** 旧记忆没有主题时，按关键词猜一个主题；猜不出就是「其他」 */
export function inferTopic(text: string): string {
  for (const [re, topic] of TOPIC_RULES) {
    if (re.test(text)) return topic
  }
  return '其他'
}

// ---- 聊天消息里的记忆标记 ----

/** TA 自主记住时用的输出标记：一整行「【记忆】内容」或「【记忆·主题】内容」 */
export const MEMORY_MARKER = '【记忆】'

export interface ExtractedMemory {
  /** 主题词，可能没有（旧格式只写了【记忆】内容） */
  topic?: string
  text: string
}

/** 从一条回复里提取记忆（每个「【记忆】xxx」或「【记忆·主题】xxx」一行算一条） */
export function extractMemories(text: string): ExtractedMemory[] {
  const out: ExtractedMemory[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*【记忆(?:[·・]\s*([^】]+))?】\s*(.+?)\s*$/.exec(line)
    if (m && m[2]) out.push({ ...(m[1]?.trim() ? { topic: m[1].trim() } : {}), text: m[2].trim() })
  }
  return out
}

/** 去掉回复里的记忆标记行（仅展示用；存储里保留原文） */
export function stripMemoryMarkers(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*【记忆/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
