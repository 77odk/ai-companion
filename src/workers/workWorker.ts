// 干活中心 · Web Worker（module worker）
// 在自己的线程里加载 Pyodide（模块级单例），把「读文件 → 跑 Python → 产出结果」整段
// 放在这里，防止处理大文件时卡住界面。
//
// 选型说明：
//   - 用 module worker（new Worker(url, { type: 'module' })），靠动态 import 加载 Pyodide。
//   - pyodide.js 是经典 worker / <script> 标签用的 UMD 包，在 module worker 里没有可靠的
//     importScripts 可用；官方为 module worker 提供 pyodide.mjs，同一版本、同一引擎
//     （v0.28.0，iOS Safari 修复版）。实测加载 + openpyxl 安装均可用。

import type { WorkFile, WorkMessage, WorkOptions, WorkRequest, WorkTask } from '../lib/work'

// 在 worker 里取一个类型化的全局对象，避免 DOM / WebWorker 两套 lib 冲突
const ctx = self as unknown as {
  postMessage(msg: WorkMessage, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<WorkRequest>) => void) | null
}

const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/'

let pyodide: any = null
let loadingPromise: Promise<any> | null = null
let processing = false

function post(msg: WorkMessage, transfer?: Transferable[]): void {
  ctx.postMessage(msg, transfer)
}

function postProgress(text: string): void {
  post({ type: 'progress', text })
}

/** 加载 Pyodide + 依赖包（模块级单例，整个 Worker 生命周期只加载一次） */
function ensurePyodide(): Promise<any> {
  if (pyodide) return Promise.resolve(pyodide)
  if (!loadingPromise) {
    loadingPromise = (async () => {
      postProgress('正在加载 Python 引擎（首次约 10 秒，之后秒开）…')
      const mod = await import(/* @vite-ignore */ `${PYODIDE_BASE}pyodide.mjs`)
      const loadPyodide = (mod as { loadPyodide: (cfg: Record<string, unknown>) => Promise<any> }).loadPyodide
      const py = await loadPyodide({ indexURL: PYODIDE_BASE })
      postProgress('正在加载常用 Python 包…')
      await py.loadPackage(['pandas'])
      await py.loadPackage(['micropip'])
      // 注意：pyodide.micropip 属性在 Worker 里不可靠，用 pyimport 拿模块最稳
      const micropip = py.pyimport('micropip')
      await micropip.install('openpyxl')
      pyodide = py
      postProgress('Python 引擎就绪')
      return py
    })().catch((err) => {
      loadingPromise = null
      throw err
    })
  }
  return loadingPromise
}

/** 清空并重建 MEMFS 工作目录 */
function setupMemfs(py: any): void {
  try {
    py.FS.removeTree('/work')
  } catch {
    /* 首次运行还没有 /work，忽略 */
  }
  py.FS.mkdirTree('/work/input')
  py.FS.mkdirTree('/work/output')
  py.FS.mkdirTree('/work/rename')
}

function sanitizeName(name: string): string {
  let n = (name.split(/[\\/]/).pop() || 'file').trim()
  n = n.replace(/[^\w.一-龥-]/g, '_')
  if (!n) n = 'file'
  return n
}

/** 把上传文件写入 MEMFS，返回内存路径列表；重名自动加 _2/_3 后缀 */
function writeInputFiles(py: any, files: WorkFile[]): string[] {
  const used = new Set<string>()
  const paths: string[] = []
  for (const f of files) {
    let name = sanitizeName(f.name)
    let i = 1
    while (used.has(name)) {
      const dot = name.lastIndexOf('.')
      const base = dot > 0 ? name.slice(0, dot) : name
      const ext = dot > 0 ? name.slice(dot) : ''
      name = `${base}_${i}${ext}`
      i += 1
    }
    used.add(name)
    const p = `/work/input/${name}`
    py.FS.writeFile(p, f.data, { encoding: 'binary' })
    paths.push(p)
  }
  return paths
}

/** 批量重命名：JS 端算新名字（不经过 Python），再写入 MEMFS 供 zipfile 打包 */
function writeRenamedFiles(py: any, files: WorkFile[], opts: WorkOptions): Array<[string, string]> {
  const mode = opts.renameMode ?? 'number'
  const text = opts.renameText ?? ''
  const used = new Set<string>()
  const pairs: Array<[string, string]> = []
  files.forEach((f, index) => {
    const raw = sanitizeName(f.name)
    const dot = raw.lastIndexOf('.')
    const base = dot > 0 ? raw.slice(0, dot) : raw
    const ext = dot > 0 ? raw.slice(dot) : ''
    let newName: string
    if (mode === 'prefix') {
      newName = `${text}${raw}` // 前缀直接拼
    } else if (mode === 'suffix') {
      newName = `${base}${text}${ext}` // 后缀加在扩展名之前
    } else {
      const width = Math.max(2, String(files.length).length)
      newName = `${String(index + 1).padStart(width, '0')}_${raw}`
    }
    let i = 1
    while (used.has(newName)) {
      const d2 = newName.lastIndexOf('.')
      const b2 = d2 > 0 ? newName.slice(0, d2) : newName
      const e2 = d2 > 0 ? newName.slice(d2) : ''
      newName = `${b2}_${i}${e2}`
      i += 1
    }
    used.add(newName)
    const p = `/work/rename/${newName}`
    py.FS.writeFile(p, f.data, { encoding: 'binary' })
    pairs.push([newName, p])
  })
  return pairs
}

// 任务实现：每个任务一个纯 Python 函数，单文件、无第三方依赖之外的库。
// 产物写回 MEMFS 指定路径；所有函数 try/except，错误统一转成中文，不让用户看到裸堆栈。
const PY_SCRIPT = `
import os
import re
import zipfile
import openpyxl


def _cell_empty(cell):
    return cell is None or (isinstance(cell, str) and cell.strip() == "")


# Excel 合并：read_only 流式读 + write_only 流式写，防内存爆炸
def task_merge_excel(srcs, out):
    wb_out = openpyxl.Workbook(write_only=True)
    ws_out = wb_out.create_sheet(title="合并结果")
    header = None
    merged_files = 0
    total_rows = 0
    for p in srcs:
        try:
            wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
        except Exception:
            raise RuntimeError("文件格式不对：无法读取「%s」，请确认是有效的 .xlsx 文件" % os.path.basename(p))
        try:
            ws = wb.active
            it = ws.iter_rows(values_only=True)
            try:
                first = next(it)
            except StopIteration:
                continue  # 空文件，跳过
            merged_files += 1
            if header is None:
                header = first
                ws_out.append(list(first))  # 表头取第一个非空文件
            for row in it:
                ws_out.append(list(row))
                total_rows += 1
        finally:
            wb.close()
    if header is None:
        raise RuntimeError("没有读取到任何有效数据，请检查文件")
    wb_out.save(out)
    return {"merged_files": merged_files, "total_rows": total_rows}


# Excel 清洗去重：去空行 / 去空列 / 按整行去重 / 按首列去重
# 选项键名与前端 WorkOptions 保持一致（camelCase）
def task_clean_excel(src, out, opts):
    stats = {"removed_rows": 0, "kept_rows": 0, "removed_cols": 0}
    remove_empty_rows = bool(opts.get("removeEmptyRows"))
    remove_empty_cols = bool(opts.get("removeEmptyCols"))
    dedupe_row = bool(opts.get("dedupeByRow"))
    dedupe_first = bool(opts.get("dedupeByFirstCol"))

    def open_workbook():
        try:
            return openpyxl.load_workbook(src, read_only=True, data_only=True)
        except Exception:
            raise RuntimeError("文件格式不对：无法读取「%s」，请确认是有效的 .xlsx 文件" % os.path.basename(src))

    # 第一遍：拿表头；需要去空列时顺带统计每列是否有数据
    wb = open_workbook()
    ws = wb.active
    it = ws.iter_rows(values_only=True)
    try:
        header = list(next(it))
    except StopIteration:
        wb.close()
        raise RuntimeError("文件是空的，没有可处理的数据")

    keep_cols = None
    if remove_empty_cols:
        col_used = {}
        for row in it:
            for ci, cell in enumerate(row):
                if not _cell_empty(cell):
                    col_used[ci] = True
        wb.close()
        max_col = len(header)
        if col_used:
            max_col = max(max_col, max(col_used) + 1)
        keep_cols = [ci for ci in range(max_col) if col_used.get(ci)]
        stats["removed_cols"] = max_col - len(keep_cols)
    else:
        wb.close()

    def project(row):
        if keep_cols is None:
            return list(row)
        return [row[ci] if ci < len(row) else None for ci in keep_cols]

    # 第二遍：边读边过滤，流式写出
    wb = open_workbook()
    ws = wb.active
    it = ws.iter_rows(values_only=True)
    next(it)  # 跳过表头
    wb_out = openpyxl.Workbook(write_only=True)
    ws_out = wb_out.create_sheet(title="清洗结果")
    ws_out.append(project(header))
    seen_row = set()
    seen_first = set()
    for row in it:
        if remove_empty_rows and all(_cell_empty(c) for c in row):
            stats["removed_rows"] += 1
            continue
        if dedupe_row:
            key = tuple(row)
            if key in seen_row:
                stats["removed_rows"] += 1
                continue
            seen_row.add(key)
        if dedupe_first:
            key = row[0] if len(row) > 0 else None
            if key in seen_first:
                stats["removed_rows"] += 1
                continue
            seen_first.add(key)
        ws_out.append(project(row))
        stats["kept_rows"] += 1
    wb.close()
    wb_out.save(out)
    return stats


# 文本批量处理：普通替换 / 正则替换 / 行首行尾加前后缀
def task_text_process(src, out, opts):
    find = opts.get("replaceFind") or ""
    repl = opts.get("replaceWith") or ""
    use_regex = bool(opts.get("useRegex"))
    prefix = opts.get("prefix") or ""
    suffix = opts.get("suffix") or ""

    try:
        with open(src, "r", encoding="utf-8-sig") as f:
            text = f.read()
    except Exception:
        raise RuntimeError("无法读取文本文件，请确认是 UTF-8 编码的 .txt 文件")

    stats = {"replace_count": 0, "line_count": 0}

    if find:
        if use_regex:
            try:
                pattern = re.compile(find)
            except re.error as e:
                raise RuntimeError("正则表达式不合法：" + str(e))
            text, n = pattern.subn(repl, text)
            stats["replace_count"] = n
        else:
            n = text.count(find)
            if n:
                text = text.replace(find, repl)
                stats["replace_count"] = n

    if prefix or suffix:
        lines = text.splitlines()
        stats["line_count"] = len(lines)
        text = "\\n".join(prefix + ln + suffix for ln in lines)
    else:
        stats["line_count"] = text.count("\\n") + 1 if text else 0

    try:
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
    except Exception:
        raise RuntimeError("写入结果失败，请重试")
    return stats


# 批量重命名 + zip：文件名 JS 端已算好，Python 只负责打包
def task_batch_rename(files, out):
    count = 0
    try:
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            for arcname, src in files:
                if not os.path.exists(src):
                    raise RuntimeError("找不到文件「%s」" % arcname)
                zf.write(src, arcname)
                count += 1
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError("打包失败：" + str(e))
    return {"file_count": count}


def main():
    task = _task
    try:
        if task == "merge_excel":
            return task_merge_excel(_input, _output)
        elif task == "clean_excel":
            return task_clean_excel(_input[0], _output, _opts)
        elif task == "text_process":
            return task_text_process(_input[0], _output, _opts)
        elif task == "batch_rename":
            return task_batch_rename(_files, _output)
        else:
            raise RuntimeError("未知任务类型")
    except RuntimeError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": "处理失败：" + str(e)}


_result = main()
`

function outMeta(task: WorkTask): { path: string; name: string; mime: string } {
  if (task === 'merge_excel') {
    return {
      path: '/work/output/merged.xlsx',
      name: '合并结果.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }
  }
  if (task === 'clean_excel') {
    return {
      path: '/work/output/cleaned.xlsx',
      name: '清洗结果.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }
  }
  if (task === 'text_process') {
    return { path: '/work/output/result.txt', name: '处理结果.txt', mime: 'text/plain;charset=utf-8' }
  }
  return { path: '/work/output/renamed.zip', name: '重命名打包.zip', mime: 'application/zip' }
}

ctx.onmessage = async (e: MessageEvent<WorkRequest>) => {
  if (processing) {
    post({ type: 'error', message: '上一个任务还在处理中，请稍候再试' })
    return
  }
  const { task, files, options } = e.data
  processing = true
  try {
    const py = await ensurePyodide()
    setupMemfs(py)
    postProgress('正在读取文件…')
    const paths = writeInputFiles(py, files)
    const out = outMeta(task)

    py.globals.set('_task', task)
    py.globals.set('_input', py.toPy(paths))
    py.globals.set('_output', out.path)
    py.globals.set('_opts', py.toPy(options))

    if (task === 'batch_rename') {
      postProgress('正在计算新文件名并打包…')
      const pairs = writeRenamedFiles(py, files, options)
      py.globals.set('_files', py.toPy(pairs))
    } else {
      postProgress('正在处理…')
    }

    py.runPython(PY_SCRIPT)

    postProgress('正在生成结果…')
    const resultJson = py.runPython('import json; json.dumps(_result)') as string
    const result = JSON.parse(resultJson) as { error?: string } & Record<string, number>

    if (result.error) {
      post({ type: 'error', message: result.error })
      return
    }

    const data = py.FS.readFile(out.path) as Uint8Array
    post({ type: 'result', fileName: out.name, mimeType: out.mime, data, stats: result }, [data.buffer])
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : '处理失败，请重试'
    post({ type: 'error', message: `处理失败：${message}` })
  } finally {
    processing = false
  }
}
