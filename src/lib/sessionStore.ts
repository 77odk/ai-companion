// 会话状态 + 乐观缓存（B2c-1）
// localStorage 只做页面缓存，后端是权威数据源。聊天「发送即显示」：本地缓存先写 → 异步上传后端，
// 上传失败进 pendingOps 队列，联网自动补传。消息缓存按会话分 key，切换会话互不干扰。
// 纯逻辑都抽成可被 Node 单测的导出函数；localStorage 读写只在函数内，导入不触发。

import { notifyDataChanged } from './dataChange.ts'
import { postMessage, postMemory, type Session } from './sessionApi.ts'
import type { StoredMessage } from './storage.ts'
import { isSimilarMemory, loadMemory, newMemoryItemId, recallRelevantMemories, type MemoryItem, type RecallOptions } from './memory.ts'
import type { BusyState } from './aiBusy.ts'

const ACTIVE_SESSION_KEY = 'ai_companion_active_session_id'
const SESSIONS_CACHE_KEY = 'ai_companion_sessions_cache'
const PENDING_OPS_KEY = 'ai_companion_pending_ops'
const msgsKey = (sessionId: string) => `ai_companion_msgs_${sessionId}`
const memsKey = (sessionId: string) => `ai_companion_mem_${sessionId}`

/** 待补传操作：上传失败先落队列，联网后按序重试 */
export interface PendingOp {
  id: string
  type: 'message' | 'memory'
  sessionId: string
  /** 上传用的载荷：message = {role, content}，memory = {content} */
  payload: Record<string, unknown>
  /** 本地写入时的时间戳（消息按这个 ts 跟缓存里的乐观条目对上号） */
  ts: number
}

// ---- 当前会话 ----

/** 当前会话 id（localStorage 存字符串；没选过返回空串） */
export function getActiveSessionId(): string {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 设置当前会话 id（空串 = 清掉） */
export function setActiveSessionId(id: string): void {
  try {
    if (id) localStorage.setItem(ACTIVE_SESSION_KEY, String(id))
    else localStorage.removeItem(ACTIVE_SESSION_KEY)
  } catch {
    // 存不下不影响功能
  }
}

// ---- 会话列表缓存 ----

export function getSessionsCache(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_CACHE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as Session[]) : []
  } catch {
    return []
  }
}

/** 会话列表拉取后落缓存（列表不含消息/记忆） */
export function setSessionsCache(list: Session[]): void {
  try {
    localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify(Array.isArray(list) ? list : []))
  } catch {
    // 存不下不影响功能
  }
}

/** 默认角色（第一个会话）id：老全局数据迁移的目标角色；无会话返回空串 */
export function getDefaultSessionId(): string {
  const list = getSessionsCache()
  return list.length > 0 ? String(list[0].id) : ''
}

// ---- 消息乐观缓存（key 带 sessionId，各会话独立） ----

export function getMessagesCache(sessionId: string): StoredMessage[] {
  try {
    const raw = localStorage.getItem(msgsKey(sessionId))
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    const valid = arr.filter(
      (m): m is StoredMessage =>
        m != null &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        typeof m.ts === 'number',
    )
    // 自愈去重（2026-08-25）：历史脏数据里可能已有同一条消息的重复条目（本地 ts + 云端 ts 各一份），按 role+内容去重
    // 2026-09-05 修复：不能只按 ts 去重——同一轮 splitAssistantReplies 拆出的多条 assistant 消息用同一个 assistantTs，按 ts 去重会把后面的消息全删掉（吞消息根因）
    const seenContent = new Set<string>()
    const deduped: StoredMessage[] = []
    for (const m of valid) {
      const ck = `${m.role}|${m.content}`
      if (seenContent.has(ck)) continue
      seenContent.add(ck)
      deduped.push(m)
    }
    return deduped
  } catch {
    return []
  }
}

/**
 * 写入某会话的消息缓存，写后广播 dataChange（账号同步监听到会防抖上传，网络失败静默）。
 * broadcast=false 用于「对账」类写入（confirmMessageInCache 只改 ts，内容没变）——
 * 不广播避免同一条消息触发两次同步/UI 刷新（review3 新-1 双同步）。
 */
export function saveMessagesCache(sessionId: string, msgs: StoredMessage[], broadcast = true): void {
  try {
    localStorage.setItem(msgsKey(sessionId), JSON.stringify(Array.isArray(msgs) ? msgs : []))
  } catch {
    // 存不下（localStorage 满）不弹窗不打断，聊天照常
  }
  if (broadcast) notifyDataChanged()
}

/** 删除会话时同步清该会话的消息缓存 */
export function clearMessagesCache(sessionId: string): void {
  try {
    localStorage.removeItem(msgsKey(sessionId))
  } catch {
    // ignore
  }
}

// ---- 记忆乐观缓存（key 带 sessionId，各会话独立，B2c-3） ----
// 与消息缓存同一模式：localStorage 只做页面缓存，后端是权威数据源。
// 记忆量小，不走 pendingOps 队列：直接乐观缓存 + 调用方异步 postMemory 上传，失败提示重试即可。
// 注意 saveMemoriesCache 不广播 dataChange——记忆写入不进 legacy 账号同步（/api/sync 全量上传），
// 避免同一批记忆被 postMemory 和账号同步重复上传。

/** 某会话的记忆缓存（后端记忆 + 本地乐观新增条目；会话间按 key 隔离） */
export function getMemoriesCache(sessionId: string): MemoryItem[] {
  try {
    const raw = localStorage.getItem(memsKey(sessionId))
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (m): m is MemoryItem => m != null && typeof m.id === 'string' && typeof m.text === 'string',
    )
  } catch {
    return []
  }
}

/** 写入某会话的记忆缓存 */
export function saveMemoriesCache(sessionId: string, items: MemoryItem[]): void {
  try {
    localStorage.setItem(memsKey(sessionId), JSON.stringify(Array.isArray(items) ? items : []))
  } catch {
    // 存不下（localStorage 满）不弹窗不打断
  }
}

/** 删除会话时同步清该会话的记忆缓存 */
export function clearMemoriesCache(sessionId: string): void {
  try {
    localStorage.removeItem(memsKey(sessionId))
  } catch {
    // ignore
  }
}

// ---- AI 忙碌状态（TASK-BUSY，按会话隔离） ----
// TA 说"去洗碗了"进入忙碌，4-5分钟后自动回来。状态存 localStorage，
// 用户关了页面下次打开发现 busyUntil 已过且没发过回来消息 → 补发（防重复）。

const BUSY_KEY_PREFIX = 'ai_companion_busy_'
const busyKey = (sessionId: string) => `${BUSY_KEY_PREFIX}${sessionId}`

/** idle 状态常量（避免每次新建对象） */
const IDLE_BUSY: BusyState = { status: 'idle', busyUntil: 0, busyReason: '', busyContext: '', returnSent: false }

/** 某会话的忙碌状态（无会话或没存过返回 idle） */
export function getBusyState(sessionId: string): BusyState {
  try {
    const raw = localStorage.getItem(busyKey(sessionId))
    if (!raw) return { ...IDLE_BUSY }
    const obj = JSON.parse(raw)
    return {
      status: obj.status === 'busy' ? 'busy' : 'idle',
      busyUntil: typeof obj.busyUntil === 'number' ? obj.busyUntil : 0,
      busyReason: typeof obj.busyReason === 'string' ? obj.busyReason : '',
      busyContext: typeof obj.busyContext === 'string' ? obj.busyContext : '',
      returnSent: obj.returnSent === true,
    }
  } catch {
    return { ...IDLE_BUSY }
  }
}

/** 写入某会话的忙碌状态 */
export function saveBusyState(sessionId: string, state: BusyState): void {
  try {
    localStorage.setItem(busyKey(sessionId), JSON.stringify(state))
  } catch {
    // 存不下不影响功能
  }
}

/** 清除某会话的忙碌状态（回到 idle） */
export function clearBusyState(sessionId: string): void {
  try {
    localStorage.removeItem(busyKey(sessionId))
  } catch {
    // ignore
  }
}

// ---- 会话语言（TASK-ENGLISH-MODE） ----
// 按会话隔离存储 lang（zh/en），每次 send 时算一次存下来。
// MessageBubble 读会话 lang 显示内心戏标签，Chat 读 lang 切换提示词语言。
import type { Lang } from './langDetect.ts'

const LANG_KEY_PREFIX = 'ai_companion_lang_'
const langKey = (sessionId: string) => `${LANG_KEY_PREFIX}${sessionId}`

/** 某会话的语言（无会话或没存过返回 'zh'，默认中文） */
export function getSessionLang(sessionId?: string): Lang {
  if (!sessionId) return 'zh'
  try {
    const raw = localStorage.getItem(langKey(sessionId))
    return raw === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

/** 写入某会话的语言 */
export function saveSessionLang(sessionId: string | undefined, lang: Lang): void {
  if (!sessionId) return
  try {
    localStorage.setItem(langKey(sessionId), lang)
  } catch {
    // 存不下不影响功能
  }
}

// ---- 未读红点（S1，为「TA 主动发消息」预留） ----
// lastRead 存 localStorage（ai_companion_read_<sid>，时间戳）。未读数 = 会话里 ts 晚于 lastRead 的消息条数。
// 进入会话（切换/打开）时 markRead → 红点消失；当前会话里自己发完消息也在会话内 = 已读（persistMessages 时 markRead）。
// 后续 TA 主动发消息更新某会话消息缓存后，未读自然出现——本批只通机制，不做主动消息。

const READ_KEY_PREFIX = 'ai_companion_read_'
const readKey = (sessionId: string) => `${READ_KEY_PREFIX}${sessionId}`

/** 某会话最后已读时间戳（localStorage；从没读过返回 0） */
export function getLastRead(sessionId: string): number {
  try {
    const v = Number(localStorage.getItem(readKey(sessionId)))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

/** 标记某会话已读：写当前时间戳（进入会话 / 在该会话内收到消息时调用） */
export function markRead(sessionId: string): void {
  try {
    localStorage.setItem(readKey(sessionId), String(Date.now()))
  } catch {
    // 存不下不影响功能
  }
}

/**
 * 未读数：会话里 ts 晚于 lastRead 的消息条数；无消息 → 0；超过 99 截断为 99（UI 显示 99+）。
 * messages 缺省读该会话消息缓存；纯函数可单测（显式传 messages 时不碰缓存）。
 */
export function getUnreadCount(
  session: { id: number | string },
  messages: StoredMessage[] = getMessagesCache(String(session.id)),
): number {
  const msgs = Array.isArray(messages) ? messages : []
  if (msgs.length === 0) return 0
  const lastRead = getLastRead(String(session.id))
  let count = 0
  for (const m of msgs) {
    if (m != null && typeof m.ts === 'number' && Number.isFinite(m.ts) && m.ts > lastRead) count++
  }
  return count > 99 ? 99 : count
}

// ---- 后端记忆 ↔ 缓存对账（后端权威，缓存保留增强字段） ----

/** 后端记忆 → 缓存条目：id 用后端数字 id 的字符串形式，text=content，createdAt 解析 ISO */
export function sessionMemoryToItem(mem: { id: number; content: string; createdAt: string }): MemoryItem {
  const ts = Date.parse(mem.createdAt)
  return {
    id: String(mem.id),
    text: mem.content,
    createdAt: Number.isFinite(ts) ? ts : 0,
  }
}

/**
 * 后端记忆列表与本地缓存合并（挂载拉回后端后填充缓存）：
 * - 同 id（后端 id 转字符串）以后端内容为准（权威），但保留本地缓存的增强字段（topic/source/pinned/explicit/lastMentionedAt）
 * - 缓存里后端还没有的乐观条目（刚新增、上传未成功）保留在列表最前，不丢
 */
export function mergeSessionMemories(cache: MemoryItem[], cloud: MemoryItem[]): MemoryItem[] {
  const cacheList = Array.isArray(cache) ? cache : []
  const out: MemoryItem[] = []
  const cloudIds = new Set<string>()
  for (const cm of cloud ?? []) {
    if (cm == null || typeof cm.id !== 'string' || !cm.id) continue
    cloudIds.add(cm.id)
    const local = cacheList.find((m) => m?.id === cm.id)
    out.push(
      local
        ? {
            ...cm,
            topic: local.topic,
            source: local.source,
            pinned: local.pinned,
            explicit: local.explicit,
            lastMentionedAt: local.lastMentionedAt,
          }
        : cm,
    )
  }
  const optimistic = cacheList.filter((m) => m != null && m.id && !cloudIds.has(m.id))
  return [...optimistic, ...out]
}

/** 上传成功对账：把缓存里乐观条目的本地 id 换成后端 id，下次「缓存+后端」合并不重复 */
export function reconcileMemoryCacheId(sessionId: string, localId: string, backendId: number | string): void {
  const list = getMemoriesCache(sessionId)
  const idx = list.findIndex((m) => m.id === localId)
  if (idx < 0) return
  list[idx] = { ...list[idx], id: String(backendId) }
  saveMemoriesCache(sessionId, list)
}

// ---- 会话缓存记忆写入（乐观；异步上传由调用方做） ----

/** 手动添加一条记忆到某会话缓存（与本地 addMemoryItem 对齐：不判重，用户明说 explicit=true） */
export function addMemoryCacheItem(
  sessionId: string,
  text: string,
  topic?: string,
  explicit?: boolean,
): MemoryItem | null {
  const t = text.trim()
  if (!t) return null
  const item: MemoryItem = {
    id: newMemoryItemId(),
    text: t,
    createdAt: Date.now(),
    topic: topic?.trim() || '其他',
    ...(explicit === true ? { explicit: true } : {}),
  }
  saveMemoriesCache(sessionId, [item, ...getMemoriesCache(sessionId)])
  return item
}

/** TA 自主记住一条到某会话缓存：与本地 upsertMemoryItem 一致先判重，新增条目带来源和主题；explicit=true 标用户明说（TASK-LM1） */
export function upsertMemoryCache(
  sessionId: string,
  text: string,
  source?: string,
  topic?: string,
  explicit?: boolean,
): MemoryItem | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (isSimilarMemory(getMemoriesCache(sessionId), trimmed)) return null
  const item: MemoryItem = {
    id: newMemoryItemId(),
    text: trimmed,
    createdAt: Date.now(),
    source,
    ...(topic?.trim() ? { topic: topic.trim() } : {}),
    ...(explicit === true ? { explicit: true } : {}),
  }
  saveMemoriesCache(sessionId, [item, ...getMemoriesCache(sessionId)])
  return item
}

/** 刷新某会话缓存里一条记忆的「最近提起」活跃度（对话注入时调用，只更新缓存，不上传） */
export function touchMemoryCache(sessionId: string, id: string, now: number = Date.now()): void {
  const list = getMemoriesCache(sessionId)
  const idx = list.findIndex((m) => m.id === id)
  if (idx < 0) return
  list[idx] = { ...list[idx], lastMentionedAt: now }
  saveMemoriesCache(sessionId, list)
}

/**
 * 对话注入的记忆来源 + 召回（B2c-3 + TASK-UI2 组合读取）：
 * 组合 = 我的忆录（全局 ai_companion_memory，所有角色共享）+ 当前角色 TA所忆（会话记忆缓存，有会话时）。
 * - 有会话 → 全局记忆 + 当前会话记忆缓存合并召回（角色私有整套按会话切换，全局记忆所有角色保留）
 * - 无会话（游客/过渡态）→ 只读全局记忆（老逻辑）
 * 严禁串读：只读全局 + 当前会话，绝不读别的会话缓存。
 * 召回逻辑（recallRelevantMemories：pinned 恒带 / 主题命中 / 关键词命中 / 活跃兜底）不变，只换数据来源组合。
 */
export function recallSessionMemories(
  activeSessionId: string,
  contextText: string,
  opts: RecallOptions = {},
): MemoryItem[] {
  // 组合 = 关于我（全局库，仅用户主动填的 explicit 档案，所有角色共享）+ 当前角色会话记忆（TA所忆，专属）。
  // 过滤依据（2026-08-26 七七拍板）：聊天中记住的内容只属于那个角色，绝不进别的角色的召回——
  // 全局库里的聊天记忆（explicit=false 旧存档，如"喜欢红烧肉"）是历史双写遗留，不再注入任何角色。
  const global = loadMemory().filter((m) => m.explicit === true)
  const items = activeSessionId ? [...global, ...getMemoriesCache(activeSessionId)] : global
  return recallRelevantMemories(items, contextText, opts)
}

// ---- pendingSync 队列（上传失败的本地暂存，联网重试） ----

export function getPendingOps(): PendingOp[] {
  try {
    const raw = localStorage.getItem(PENDING_OPS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (op): op is PendingOp =>
        op != null &&
        typeof op.id === 'string' &&
        (op.type === 'message' || op.type === 'memory') &&
        typeof op.sessionId === 'string' &&
        op.payload != null &&
        typeof op.payload === 'object' &&
        typeof op.ts === 'number',
    )
  } catch {
    return []
  }
}

export function addPendingOp(op: PendingOp): void {
  try {
    localStorage.setItem(PENDING_OPS_KEY, JSON.stringify([...getPendingOps(), op]))
  } catch {
    // 队列存不下：这条会丢，但聊天记录本身在缓存里还在
  }
}

export function removePendingOp(id: string): void {
  try {
    localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(getPendingOps().filter((op) => op.id !== id)))
  } catch {
    // ignore
  }
}

/** 生成队列条目 id（浏览器用 crypto.randomUUID，Node 测试环境走兜底） */
export function newPendingOpId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // 走兜底
  }
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

// ---- 消息合并（纯函数，可单测） ----

/**
 * 本地缓存与后端消息合并：按 ts 去重，同一 ts 以云端（后端权威）为准；合并后按 ts 升序。
 * 与 sync.ts 的 mergeMessages 思路一致（输入顺序不影响结果），但这里后端优先（权威数据源）。
 */
export function mergeSessionMessages(local: StoredMessage[], cloud: StoredMessage[]): StoredMessage[] {
  // 去重：同 ts（云端优先）或同 role+内容（本地乐观 ts 与云端 createdAt 毫秒差）都算同一条。
  // 根因（2026-08-25 七七实测）：本地乐观写入 ts=Date.now()，云端=后端 createdAt，毫秒差导致同一条消息被当两条显示。
  // cloud 在前 = 同 ts 时云端版本优先（后端权威）。
  const seenTs = new Set<number>()
  const seenContent = new Set<string>()
  const out: StoredMessage[] = []
  for (const m of [...(cloud ?? []), ...(local ?? [])]) {
    if (m == null || typeof m.ts !== 'number' || Number.isNaN(m.ts)) continue
    const ck = `${m.role}|${m.content}`
    if (seenTs.has(m.ts) || seenContent.has(ck)) continue
    seenTs.add(m.ts)
    seenContent.add(ck)
    out.push(m)
  }
  return out.sort((a, b) => a.ts - b.ts)
}

// ---- 上传成功后的本地对账 ----

/**
 * 某条消息上传后端成功后，把缓存里对应的乐观条目（本地 ts）替换成服务端版本（ts = createdAt）。
 * 避免下次「本地缓存 + 后端消息」合并时同一条消息因为 ts 不同出现两条。
 */
export function confirmMessageInCache(
  sessionId: string,
  op: PendingOp,
  serverMsg: { role: 'user' | 'assistant'; content: string; createdAt: string },
): void {
  const list = getMessagesCache(sessionId)
  // 同批拆分消息 ts 相同（同 assistantTs）——必须带 content 精确定位，否则 findIndex 永远命中批内第一条，对账错乱（2026-09-03 排查乱序时发现）
  const idx = list.findIndex(
    (m) => m.ts === op.ts && m.role === op.payload.role && m.content === op.payload.content,
  )
  if (idx < 0) return
  const ts = Date.parse(serverMsg.createdAt)
  if (!Number.isFinite(ts)) return
  list[idx] = { role: serverMsg.role, content: serverMsg.content, ts }
  // 对账只把本地 ts 换成服务端 ts，内容不变：不广播（避免双同步），RolesPage 列表摘要已是最新
  saveMessagesCache(sessionId, list, false)
}

// ---- 补传 pending 队列（联网自动补传，Chat 挂载 / window online 时调用） ----

/** 依次重试队列里的上传；成功移除，网络失败留在队列下次再试，401 则停（已登出） */
export async function flushPendingOps(token: string): Promise<void> {
  for (const op of getPendingOps()) {
    if (op.type === 'message') {
      const res = await postMessage(token, op.sessionId, {
        role: op.payload.role as 'user' | 'assistant',
        content: String(op.payload.content ?? ''),
      })
      if (res.ok) {
        removePendingOp(op.id)
        confirmMessageInCache(op.sessionId, op, res.data)
      } else if (res.status === 401) {
        return // 登录已失效，sessionApi 已广播，剩下的等重新登录后再补
      }
    } else if (op.type === 'memory') {
      const res = await postMemory(token, op.sessionId, { content: String(op.payload.content ?? '') })
      if (res.ok) {
        removePendingOp(op.id)
      } else if (res.status === 401) {
        return
      }
    }
  }
}

// ---- 回复拆分（2026-08-25 七七拍板：微信式多条短气泡） ----

/**
 * 第二批⑨：超长文本折行不丢弃——把超过 maxLen 的文本拆成多条，每条不超过 maxLen 字。
 * 优先在标点/空格处断（保句子完整），无标点硬折；最后残余哪怕几个字也保留；不加省略号。
 * 中文按标点断，英文按空格/标点断。
 */
function chunkText(text: string, maxLen: number = 60): string[] {
  const t = String(text ?? '').trim()
  if (!t) return []
  if (t.length <= maxLen) return [t]
  const chunks: string[] = []
  let remaining = t
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }
    // 在 maxLen 范围内找最后一个标点/空格作为断点
    const window = remaining.slice(0, maxLen)
    // 中文标点：。！？；，、 英文标点：.!?;, 空格
    const breakMatch = window.match(/[。！？；，、.!?;,，][^。！？；，、.!?;,，\s]*$|\s[^\s]*$/)
    let breakPos = maxLen
    if (breakMatch && breakMatch.index !== undefined) {
      // 断点在标点/空格之后，保留标点在当前 chunk
      breakPos = breakMatch.index + breakMatch[0].length
      if (breakPos > maxLen) breakPos = maxLen
    }
    chunks.push(remaining.slice(0, breakPos).trim())
    remaining = remaining.slice(breakPos).trim()
  }
  return chunks.filter(Boolean)
}

/**
 * 把 AI 回复拆成多条短消息（同一 ts 批次，渲染时各自独立气泡）：
 * - 按换行/空行拆：AI 在提示词约束下会像发微信一样分行发（一条一行）
 * - 单条 ≤ 1 行 → 原样；没换行就整条返回（一句话能说完就一句话）
 * - 连续多行合成一条最长 60 字内；空白行是分段符
 * - 第二批⑨：超长内容折行不丢弃，不再 slice+省略号
 */
export function splitAssistantReplies(content: string, ts: number): StoredMessage[] {
  const text = String(content ?? '').trim()
  if (!text) return []
  // 1) 优先按换行/空行拆：AI 在提示词约束下会像发微信一样分行发（一条一行）
  const lines = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (lines.length > 1) {
    // 每行一条；过长的行折行不丢弃（第二批⑨）
    const result: StoredMessage[] = []
    for (const l of lines) {
      for (const chunk of chunkText(l, 60)) {
        result.push({ role: 'assistant' as const, content: chunk, ts })
      }
    }
    return result
  }
  // 2) 没换行（一整段）：按句子拆——句号/问号/感叹号/省略号断句，一条一句，
  //    不让一大段直接甩脸上；单句超 60 字折行不丢弃（第二批⑨）
  const sentences = text
    .split(/(?<=[。！？!?…])/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (sentences.length <= 1) {
    // 单句超长也折行
    return chunkText(text, 60).map((c) => ({ role: 'assistant' as const, content: c, ts }))
  }
  const result: StoredMessage[] = []
  for (const s of sentences) {
    for (const chunk of chunkText(s, 60)) {
      result.push({ role: 'assistant' as const, content: chunk, ts })
    }
  }
  return result
}
