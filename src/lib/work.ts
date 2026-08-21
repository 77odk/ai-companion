// 干活中心 · Pyodide 引擎封装（主线程侧）
// 加载与执行全部在 Web Worker 里进行（见 src/workers/workWorker.ts）：
// 主线程只负责把文件字节传给 Worker、收进度与结果、触发浏览器下载。
// 文件全程在浏览器内（MEMFS 虚拟盘），不会上传到任何服务器。

export type WorkTask = 'merge_excel' | 'clean_excel' | 'text_process' | 'batch_rename'

export interface WorkFile {
  name: string
  data: Uint8Array
}

export interface WorkOptions {
  // Excel 清洗去重
  removeEmptyRows?: boolean
  removeEmptyCols?: boolean
  dedupeByRow?: boolean
  dedupeByFirstCol?: boolean
  // 文本批量处理
  replaceFind?: string
  replaceWith?: string
  useRegex?: boolean
  prefix?: string
  suffix?: string
  // 批量重命名
  renameMode?: 'prefix' | 'suffix' | 'number'
  renameText?: string
}

export interface WorkResult {
  fileName: string
  mimeType: string
  data: Uint8Array
  stats: Record<string, number>
}

export interface WorkRequest {
  task: WorkTask
  files: WorkFile[]
  options: WorkOptions
}

export type WorkMessage =
  | { type: 'progress'; text: string }
  | { type: 'result'; fileName: string; mimeType: string; data: Uint8Array; stats: Record<string, number> }
  | { type: 'error'; message: string }

// 模块级单例 Worker：重复进入干活中心、反复跑任务都复用同一个实例，
// Pyodide 在 Worker 内缓存，首次加载约 10 秒，之后秒开。
let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/workWorker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

/** 终止并释放 Worker（下次调用会重新创建） */
export function terminateWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
}

/**
 * 跑一个任务。文件字节用 transferable 传给 Worker，避免拷贝。
 * onProgress 接收 Worker 回传的进度文案。
 */
export function runWorkTask(
  task: WorkTask,
  files: WorkFile[],
  options: WorkOptions,
  onProgress: (text: string) => void,
): Promise<WorkResult> {
  return new Promise((resolve, reject) => {
    const w = getWorker()

    const onMessage = (e: MessageEvent<WorkMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        onProgress(msg.text)
      } else if (msg.type === 'result') {
        cleanup()
        resolve({ fileName: msg.fileName, mimeType: msg.mimeType, data: msg.data, stats: msg.stats })
      } else if (msg.type === 'error') {
        cleanup()
        reject(new Error(msg.message))
      }
    }

    const onError = () => {
      cleanup()
      terminateWorker()
      reject(new Error('处理进程异常退出，请重试'))
    }

    const cleanup = () => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
    }

    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)

    const req: WorkRequest = { task, files, options }
    // 输入文件用结构化克隆传输（不 transfer），这样 UI 里已选中的文件可重复使用；
    // 结果字节用 transferable 从 Worker 传回，避免大文件拷贝。
    w.postMessage(req)
  })
}

/** 把结果字节触发浏览器下载 */
export function downloadResult(result: WorkResult): void {
  const blob = new Blob([result.data as Uint8Array<ArrayBuffer>], { type: result.mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = result.fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
