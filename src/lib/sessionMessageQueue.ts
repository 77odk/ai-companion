/**
 * 同一 session 的 messages POST 必须串行。
 * 这是纯内存提交门：不新增 storage key、不改变后端 API，也不持久化任何用户数据。
 * 不同 session 仍可并行。
 */
const sessionMessageTails = new Map<string, Promise<void>>()

export async function enqueueSessionMessageCommit<T>(
  sessionId: string,
  task: () => Promise<T>,
): Promise<T> {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return task()

  const previous = sessionMessageTails.get(sid) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => undefined).then(() => gate)
  sessionMessageTails.set(sid, tail)

  await previous.catch(() => undefined)
  try {
    return await task()
  } finally {
    release()
    if (sessionMessageTails.get(sid) === tail) sessionMessageTails.delete(sid)
  }
}


/**
 * pending-op replay may contain messages from multiple sessions.
 * Acquire every affected session gate in stable order before replaying, so a recovery flush
 * cannot bypass an already queued foreground / busy / initiative commit.
 */
export async function enqueueSessionMessageCommits<T>(
  sessionIds: string[],
  task: () => Promise<T>,
): Promise<T> {
  const ids = [...new Set(
    (Array.isArray(sessionIds) ? sessionIds : [])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean),
  )].sort()
  if (ids.length === 0) return task()

  // 同步预占所有 session 的“下一席”，再等待各自前序结束。
  // 这样 recovery flush 等 A 时，B 的新提交也不能从旁边插队。
  const reservations = ids.map((sid) => {
    const previous = sessionMessageTails.get(sid) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    sessionMessageTails.set(sid, tail)
    return { sid, previous, gate, tail, release }
  })

  await Promise.all(reservations.map(({ previous }) => previous.catch(() => undefined)))
  try {
    return await task()
  } finally {
    for (const { sid, tail, release } of reservations) {
      release()
      if (sessionMessageTails.get(sid) === tail) sessionMessageTails.delete(sid)
    }
  }
}
