import { useRef, useState, type ChangeEvent } from 'react'
import { downloadResult, runWorkTask, type WorkFile, type WorkOptions, type WorkResult, type WorkTask } from '../lib/work'
import { isUnlocked, saveUnlock } from '../lib/license'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const XLS_ONLY_RE = /\.xls$/i

// ★锁展示模式（2026-08-21 七七拍板）：内测期已有用户（疑似程序员），干活功能只展示不开放，
// 防止绕过前端校验白嫖 + 被人研究破解。引擎代码保留在 lib/work.ts + workers/workWorker.ts，
// 正式卖码时把此开关翻成 false 即恢复完整功能。
const SHOWCASE_MODE = true

export default function Work() {
  const [unlocked, setUnlocked] = useState<boolean>(() => isUnlocked())
  // 任一任务处理中，所有任务按钮统一禁用，避免并发占用同一个 Worker
  const [busy, setBusy] = useState(false)

  if (SHOWCASE_MODE) {
    return <Showcase />
  }

  return (
    <div className="page work-page">
      <h2 className="work-title">AI 工作台</h2>
      <p className="page-desc">
        上传文件，让 TA 帮你跑 Python：合并 Excel、清洗文本、批量打包，文件全程不出你的浏览器。
      </p>

      {!unlocked ? (
        <LockCard onUnlock={() => setUnlocked(true)} />
      ) : (
        <>
          <MergeCard disabled={busy} onBusyChange={setBusy} />
          <CleanCard disabled={busy} onBusyChange={setBusy} />
          <TextCard disabled={busy} onBusyChange={setBusy} />
          <RenameCard disabled={busy} onBusyChange={setBusy} />
        </>
      )}
    </div>
  )
}

/* ---------------- 展示模式（仅展示，不开放） ---------------- */

const SHOWCASE_TASKS: { icon: string; title: string; desc: string }[] = [
  { icon: '📊', title: 'Excel 合并', desc: '多个表格合成一个，表头自动对齐，行数据全保留' },
  { icon: '🧹', title: 'Excel 清洗去重', desc: '去重、去空行、去空列，脏数据一次理干净' },
  { icon: '📝', title: '文本批量处理', desc: '批量替换、正则提取、行首行尾加内容' },
  { icon: '📦', title: '批量重命名打包', desc: '批量改文件名，自动压成 zip 打包下载' },
]

function Showcase() {
  return (
    <div className="page work-page">
      <h2 className="work-title">AI 工作台</h2>
      <p className="page-desc">
        不只是聊天——上传文件，让 TA 帮你跑 Python 处理。文件全程不出你的浏览器，即将开放。
      </p>

      {SHOWCASE_TASKS.map((t) => (
        <div key={t.title} className="settings-card showcase-card">
          <div className="showcase-head">
            <span className="showcase-icon">{t.icon}</span>
            <h3 className="settings-card-title">{t.title}</h3>
            <span className="showcase-badge">即将开放</span>
          </div>
          <p className="hint">{t.desc}</p>
        </div>
      ))}
    </div>
  )
}

/* ---------------- 解锁 ---------------- */

function LockCard({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const handleUnlock = () => {
    if (saveUnlock(code)) {
      onUnlock()
    } else {
      setError('激活码不正确，请检查后重试')
    }
  }

  return (
    <div className="settings-card work-lock">
      <h3 className="settings-card-title">干活中心 · 未解锁</h3>
      <p className="page-desc work-lock-desc">
        干活能力需要激活码解锁。解锁后，你可以上传文件，让 AI 在浏览器里帮你跑 Python 处理
        ——合并 Excel、清洗去重、批量处理文本、打包文件，数据全程不出你的浏览器。
      </p>
      <div className="field">
        <label htmlFor="work-code">激活码</label>
        <input
          id="work-code"
          className="input"
          type="text"
          placeholder="XXXX-XXXX-XXXX"
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            setError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleUnlock()
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="hint">格式：XXXX-XXXX-XXXX（不含 0/O/1/I）</p>
      </div>
      {error && <p className="test-result error">{error}</p>}
      <div className="work-actions">
        <button className="btn btn-primary" onClick={handleUnlock}>
          解锁
        </button>
      </div>
    </div>
  )
}

/* ---------------- 通用：文件选择 / 进度 / 结果 ---------------- */

interface FilePickerProps {
  accept: string
  multiple: boolean
  selected: string
  onFiles: (files: WorkFile[]) => void
}

function FilePicker({ accept, multiple, selected, onFiles }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? [])
    const tooBig = list.find((f) => f.size > MAX_FILE_BYTES)
    if (tooBig) {
      alert(`「${tooBig.name}」超过 20MB，请换一个小一点的文件`)
      e.target.value = ''
      return
    }
    if (list.length === 0) {
      e.target.value = ''
      return
    }
    Promise.all(
      list.map(async (f) => ({
        name: f.name,
        data: new Uint8Array(await f.arrayBuffer()),
      })),
    ).then((fs) => {
      onFiles(fs)
      e.target.value = ''
    })
  }

  return (
    <div className="work-file-pick">
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} onChange={handleChange} hidden />
      <button type="button" className="btn btn-ghost work-file-btn" onClick={() => inputRef.current?.click()}>
        选择文件
      </button>
      {selected && <p className="hint work-files">{selected}</p>}
    </div>
  )
}

function ResultArea({
  busy,
  progress,
  result,
  error,
  statsText,
}: {
  busy: boolean
  progress: string
  result: WorkResult | null
  error: string
  statsText: string
}) {
  return (
    <div className="work-result-area">
      {busy && progress && <p className="hint work-progress">{progress}</p>}
      {!busy && error && <p className="test-result error">{error}</p>}
      {!busy && result && (
        <div className="work-done">
          <p className="test-result success">{statsText}</p>
          <button className="btn btn-primary" onClick={() => downloadResult(result)}>
            下载 {result.fileName}
          </button>
        </div>
      )}
    </div>
  )
}

/** 任务卡片公共逻辑：跑任务、收进度、存结果与错误 */
function useTask(onBusyChange: (b: boolean) => void) {
  const [busy, setBusyLocal] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<WorkResult | null>(null)
  const [error, setError] = useState('')
  const [statsText, setStatsText] = useState('')

  const run = async (
    task: WorkTask,
    files: WorkFile[],
    options: WorkOptions,
    formatStats: (s: Record<string, number>) => string,
  ) => {
    setBusyLocal(true)
    onBusyChange(true)
    setProgress('正在准备…')
    setResult(null)
    setError('')
    try {
      const res = await runWorkTask(task, files, options, (t) => setProgress(t))
      setResult(res)
      setStatsText(formatStats(res.stats))
    } catch (e) {
      setError(e instanceof Error ? e.message : '处理失败，请重试')
    } finally {
      setBusyLocal(false)
      onBusyChange(false)
    }
  }

  return { busy, progress, result, error, statsText, run }
}

/* ---------------- 任务 1：Excel 合并 ---------------- */

function MergeCard({ disabled, onBusyChange }: { disabled: boolean; onBusyChange: (b: boolean) => void }) {
  const { busy, progress, result, error, statsText, run } = useTask(onBusyChange)
  const [files, setFiles] = useState<WorkFile[]>([])

  const handleFiles = (fs: WorkFile[]) => {
    if (fs.some((f) => XLS_ONLY_RE.test(f.name))) {
      alert('暂不支持 .xls 老格式，请用 Excel 另存为 .xlsx 后再试')
      setFiles([])
      return
    }
    if (fs.length < 2) {
      alert('请至少选择 2 个 Excel 文件')
      setFiles([])
      return
    }
    if (fs.length > 10) {
      alert('一次最多合并 10 个文件')
      setFiles([])
      return
    }
    setFiles(fs)
  }

  return (
    <div className="settings-card work-card">
      <h3 className="settings-card-title">Excel 合并</h3>
      <p className="hint">合并 2-10 个 xlsx 文件，以第一个文件的表头为准，所有行并入一个文件。</p>
      <FilePicker
        accept=".xlsx,.xls"
        multiple
        selected={files.map((f) => f.name).join('、')}
        onFiles={handleFiles}
      />
      <div className="work-actions">
        <button
          className="btn btn-primary"
          disabled={disabled || busy || files.length === 0}
          onClick={() => run('merge_excel', files, {}, (s) => `合并 ${s.merged_files} 个文件，共 ${s.total_rows} 行`)}
        >
          {busy ? '处理中…' : '开始处理'}
        </button>
      </div>
      <ResultArea busy={busy} progress={progress} result={result} error={error} statsText={statsText} />
    </div>
  )
}

/* ---------------- 任务 2：Excel 清洗去重 ---------------- */

function CleanCard({ disabled, onBusyChange }: { disabled: boolean; onBusyChange: (b: boolean) => void }) {
  const { busy, progress, result, error, statsText, run } = useTask(onBusyChange)
  const [files, setFiles] = useState<WorkFile[]>([])
  const [removeEmptyRows, setRemoveEmptyRows] = useState(true)
  const [removeEmptyCols, setRemoveEmptyCols] = useState(false)
  const [dedupeByRow, setDedupeByRow] = useState(false)
  const [dedupeByFirstCol, setDedupeByFirstCol] = useState(false)

  const handleFiles = (fs: WorkFile[]) => {
    if (fs.some((f) => XLS_ONLY_RE.test(f.name))) {
      alert('暂不支持 .xls 老格式，请用 Excel 另存为 .xlsx 后再试')
      setFiles([])
      return
    }
    if (fs.length !== 1) {
      alert('请选择 1 个 Excel 文件')
      setFiles([])
      return
    }
    setFiles(fs)
  }

  const handleProcess = () => {
    if (!removeEmptyRows && !removeEmptyCols && !dedupeByRow && !dedupeByFirstCol) {
      alert('请至少勾选一项处理方式')
      return
    }
    run(
      'clean_excel',
      files,
      { removeEmptyRows, removeEmptyCols, dedupeByRow, dedupeByFirstCol },
      (s) => {
        const parts = [`删除 ${s.removed_rows} 行`, `保留 ${s.kept_rows} 行`]
        if (s.removed_cols) parts.push(`删除 ${s.removed_cols} 列`)
        return parts.join('，')
      },
    )
  }

  return (
    <div className="settings-card work-card">
      <h3 className="settings-card-title">Excel 清洗去重</h3>
      <p className="hint">对一个 xlsx 文件去空行、去空列、按整行或按首列去重。</p>
      <FilePicker accept=".xlsx,.xls" multiple={false} selected={files.map((f) => f.name).join('、')} onFiles={handleFiles} />
      <div className="work-checks">
        <label className="work-check">
          <input type="checkbox" checked={removeEmptyRows} onChange={(e) => setRemoveEmptyRows(e.target.checked)} />
          去空行
        </label>
        <label className="work-check">
          <input type="checkbox" checked={removeEmptyCols} onChange={(e) => setRemoveEmptyCols(e.target.checked)} />
          去空列
        </label>
        <label className="work-check">
          <input type="checkbox" checked={dedupeByRow} onChange={(e) => setDedupeByRow(e.target.checked)} />
          按整行去重
        </label>
        <label className="work-check">
          <input type="checkbox" checked={dedupeByFirstCol} onChange={(e) => setDedupeByFirstCol(e.target.checked)} />
          按首列去重
        </label>
      </div>
      <div className="work-actions">
        <button className="btn btn-primary" disabled={disabled || busy || files.length === 0} onClick={handleProcess}>
          {busy ? '处理中…' : '开始处理'}
        </button>
      </div>
      <ResultArea busy={busy} progress={progress} result={result} error={error} statsText={statsText} />
    </div>
  )
}

/* ---------------- 任务 3：文本批量处理 ---------------- */

function TextCard({ disabled, onBusyChange }: { disabled: boolean; onBusyChange: (b: boolean) => void }) {
  const { busy, progress, result, error, statsText, run } = useTask(onBusyChange)
  const [files, setFiles] = useState<WorkFile[]>([])
  const [replaceFind, setReplaceFind] = useState('')
  const [replaceWith, setReplaceWith] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')

  const handleFiles = (fs: WorkFile[]) => {
    if (fs.length !== 1) {
      alert('请选择 1 个文本文件')
      setFiles([])
      return
    }
    if (!/\.txt$/i.test(fs[0].name)) {
      alert('请选择 .txt 文本文件')
      setFiles([])
      return
    }
    setFiles(fs)
  }

  const handleProcess = () => {
    if (!replaceFind && !prefix && !suffix) {
      alert('请至少填写一项处理内容（查找替换，或行首行尾加内容）')
      return
    }
    run(
      'text_process',
      files,
      { replaceFind, replaceWith, useRegex, prefix, suffix },
      (s) => `替换 ${s.replace_count} 处，共 ${s.line_count} 行`,
    )
  }

  return (
    <div className="settings-card work-card">
      <h3 className="settings-card-title">文本批量处理</h3>
      <p className="hint">对一个多行 .txt 做批量替换（支持正则）、给每行加前缀或后缀。</p>
      <FilePicker accept=".txt" multiple={false} selected={files.map((f) => f.name).join('、')} onFiles={handleFiles} />
      <div className="work-row">
        <div className="field">
          <label htmlFor="text-find">查找</label>
          <input
            id="text-find"
            className="input"
            type="text"
            value={replaceFind}
            onChange={(e) => setReplaceFind(e.target.value)}
            placeholder="要查找的内容"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="text-replace">替换为</label>
          <input
            id="text-replace"
            className="input"
            type="text"
            value={replaceWith}
            onChange={(e) => setReplaceWith(e.target.value)}
            placeholder="替换成的内容"
            autoComplete="off"
          />
        </div>
      </div>
      <label className="work-check work-regex">
        <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />
        按正则表达式匹配
      </label>
      <div className="work-row">
        <div className="field">
          <label htmlFor="text-prefix">行首前缀</label>
          <input
            id="text-prefix"
            className="input"
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="每行开头加的内容"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="text-suffix">行尾后缀</label>
          <input
            id="text-suffix"
            className="input"
            type="text"
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
            placeholder="每行末尾加的内容"
            autoComplete="off"
          />
        </div>
      </div>
      <div className="work-actions">
        <button className="btn btn-primary" disabled={disabled || busy || files.length === 0} onClick={handleProcess}>
          {busy ? '处理中…' : '开始处理'}
        </button>
      </div>
      <ResultArea busy={busy} progress={progress} result={result} error={error} statsText={statsText} />
    </div>
  )
}

/* ---------------- 任务 4：批量重命名 + zip 打包 ---------------- */

type RenameMode = 'prefix' | 'suffix' | 'number'

function RenameCard({ disabled, onBusyChange }: { disabled: boolean; onBusyChange: (b: boolean) => void }) {
  const { busy, progress, result, error, statsText, run } = useTask(onBusyChange)
  const [files, setFiles] = useState<WorkFile[]>([])
  const [mode, setMode] = useState<RenameMode>('number')
  const [text, setText] = useState('')

  const handleFiles = (fs: WorkFile[]) => {
    if (fs.length === 0) {
      alert('请至少选择 1 个文件')
      return
    }
    setFiles(fs)
  }

  const handleProcess = () => {
    if ((mode === 'prefix' || mode === 'suffix') && !text.trim()) {
      alert('请填写要加的前缀或后缀')
      return
    }
    run('batch_rename', files, { renameMode: mode, renameText: text }, (s) => `已打包 ${s.file_count} 个文件`)
  }

  return (
    <div className="settings-card work-card">
      <h3 className="settings-card-title">批量重命名 + zip 打包</h3>
      <p className="hint">给多个文件加前缀、加后缀或序号命名，然后打包成一个 zip 下载。</p>
      <FilePicker
        accept=""
        multiple
        selected={files.map((f) => f.name).join('、')}
        onFiles={handleFiles}
      />
      <div className="field">
        <label htmlFor="rename-mode">命名方式</label>
        <select
          id="rename-mode"
          className="input"
          value={mode}
          onChange={(e) => setMode(e.target.value as RenameMode)}
        >
          <option value="number">序号命名（01_原名.xxx）</option>
          <option value="prefix">加前缀</option>
          <option value="suffix">加后缀</option>
        </select>
      </div>
      {(mode === 'prefix' || mode === 'suffix') && (
        <div className="field">
          <label htmlFor="rename-text">{mode === 'prefix' ? '前缀内容' : '后缀内容'}</label>
          <input
            id="rename-text"
            className="input"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'prefix' ? '如：旅行_' : '如：_已处理'}
            autoComplete="off"
          />
        </div>
      )}
      <div className="work-actions">
        <button className="btn btn-primary" disabled={disabled || busy || files.length === 0} onClick={handleProcess}>
          {busy ? '处理中…' : '开始处理'}
        </button>
      </div>
      <ResultArea busy={busy} progress={progress} result={result} error={error} statsText={statsText} />
    </div>
  )
}
