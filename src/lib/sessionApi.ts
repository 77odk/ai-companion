// 会话数据后端接口客户端（B2c-1）
// 纯 fetch 封装，不持有状态：每个函数都显式传 token，返回 {ok,data} / {ok:false,status,message}，不抛异常。
// 后端接口（B1 已就绪）：GET/POST /api/sessions、GET/PATCH/DELETE /api/sessions/:id、
//   POST /api/sessions/:id/messages、GET/POST /api/sessions/:id/memories、PATCH/DELETE /api/memories/:id。
// 鉴权全部 Bearer token；401 视为登录失效 → logout() 广播登录状态变化，App 收到后弹登录墙（B2b gateShown 接住）。

import { API_BASE } from './sync.ts'
import { logout } from './auth.ts'

/** 统一的接口结果：成功带 data，失败带 status + message（网络失败 status 为 0） */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string }

/** 会话（后端 sessions 表，id 是自增整数） */
export interface Session {
  id: number
  title: string
  persona: string
  created_at: string
  updatedAt: string
}

/** 会话消息（后端 messages 表，createdAt 是 ISO 字符串） */
export interface SessionMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

/** 会话记忆（后端 memories 表） */
export interface SessionMemory {
  id: number
  content: string
  createdAt: string
}

/** GET /api/sessions/:id 的返回结构 */
export interface SessionDetail {
  session: Session
  messages: SessionMessage[]
  memories: SessionMemory[]
}

async function errorMessage(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { error?: unknown }
    if (body != null && typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // 响应体不是 JSON，走兜底文案
  }
  return `操作失败（HTTP ${resp.status}）`
}

async function request<T>(
  path: string,
  options: { token: string; method: string; body?: unknown },
): Promise<ApiResult<T>> {
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.token}`,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    // 网络不通：静默失败，由调用方决定进 pendingSync 队列还是提示
    return { ok: false, status: 0, message: '网络不通，连不上服务器，请检查网络后重试' }
  }

  if (resp.status === 401) {
    // 登录失效：清登录态并广播，App 收到后弹登录墙（logout 幂等，多个并发 401 同时触发也安全）
    logout()
    return { ok: false, status: 401, message: await errorMessage(resp) }
  }
  if (!resp.ok) {
    return { ok: false, status: resp.status, message: await errorMessage(resp) }
  }
  const data = (await resp.json().catch(() => null)) as T
  return { ok: true, data }
}

/** 会话列表（不含消息/记忆） */
export function listSessions(token: string): Promise<ApiResult<{ sessions: Session[] }>> {
  return request<{ sessions: Session[] }>('/api/sessions', { token, method: 'GET' })
}

/** 新建会话（persona/title 均可选，后端 title 空默认「新会话」） */
export function createSession(
  token: string,
  body: { persona?: string; title?: string },
): Promise<ApiResult<Session>> {
  return request<Session>('/api/sessions', { token, method: 'POST', body })
}

/** 会话详情：session + 该会话全部消息(升序) + 全部记忆(升序) */
export function getSession(token: string, id: string | number): Promise<ApiResult<SessionDetail>> {
  return request<SessionDetail>(`/api/sessions/${id}`, { token, method: 'GET' })
}

/** 删除会话（后端级联删消息/记忆） */
export function deleteSession(token: string, id: string | number): Promise<ApiResult<{ ok: true }>> {
  return request<{ ok: true }>(`/api/sessions/${id}`, { token, method: 'DELETE' })
}

/** 只更新传入字段（persona/title） */
export function patchSession(
  token: string,
  id: string | number,
  body: { persona?: string; title?: string },
): Promise<ApiResult<Session>> {
  return request<Session>(`/api/sessions/${id}`, { token, method: 'PATCH', body })
}

/** 会话内发消息（role 只允许 user / assistant） */
export function postMessage(
  token: string,
  sessionId: string | number,
  body: { role: 'user' | 'assistant'; content: string },
): Promise<ApiResult<SessionMessage>> {
  return request<SessionMessage>(`/api/sessions/${sessionId}/messages`, { token, method: 'POST', body })
}

/** 会话记忆列表（升序） */
export function listMemories(token: string, sessionId: string | number): Promise<ApiResult<{ memories: SessionMemory[] }>> {
  return request<{ memories: SessionMemory[] }>(`/api/sessions/${sessionId}/memories`, { token, method: 'GET' })
}

/** 会话内加一条记忆 */
export function postMemory(
  token: string,
  sessionId: string | number,
  body: { content: string },
): Promise<ApiResult<SessionMemory>> {
  return request<SessionMemory>(`/api/sessions/${sessionId}/memories`, { token, method: 'POST', body })
}

/** 改记忆（后端校验归属） */
export function patchMemory(
  token: string,
  id: string | number,
  body: { content: string },
): Promise<ApiResult<SessionMemory>> {
  return request<SessionMemory>(`/api/memories/${id}`, { token, method: 'PATCH', body })
}

/** 删记忆（后端校验归属） */
export function deleteMemory(token: string, id: string | number): Promise<ApiResult<{ ok: true }>> {
  return request<{ ok: true }>(`/api/memories/${id}`, { token, method: 'DELETE' })
}
