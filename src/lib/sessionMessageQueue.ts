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

  const run = (index: number): Promise<T> => {
    if (index >= ids.length) return task()
    return enqueueSessionMessageCommit(ids[index], () => run(index + 1))
  }

  return run(0)
}
