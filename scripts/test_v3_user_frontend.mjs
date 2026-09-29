// V3 用户端（批 2）：通知读真实后端 + 反馈与建议页 + 「我的」入口重排。
// 纯静态契约测试，风格与 scripts/test_notification_*.mjs 一致。
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const app = read('src/App.tsx')
const page = read('src/components/NotificationsPage.tsx')
const feedback = read('src/components/FeedbackPage.tsx')
const settings = read('src/components/Settings.tsx')

/* ---------- 1. 通知页：不再读静态 feed，改读后端 ---------- */

assert.doesNotMatch(page, /notifications\.json/, '通知页不应再以 notifications.json 为数据源')
assert.match(page, /import \{ API_BASE \} from '\.\.\/lib\/sync'/)
assert.match(page, /import \{ getToken, logout \} from '\.\.\/lib\/auth'/)

// 请求路径：读 = GET /api/notifications（页面自持）；读回执 = POST /api/notifications/read（见第 2 节）。
assert.match(page, /fetch\(`\$\{API_BASE\}\/api\/notifications`/)
assert.match(page, /getToken\(\)/)
assert.match(page, /Authorization: `Bearer \$\{token\}`/)

// 三值 kind：update / announcement / account
assert.match(page, /kind !== 'update' && item\.kind !== 'announcement' && item\.kind !== 'account'/)
assert.match(page, /return '账号提醒'/)
// publishedAt 兼容 ISO 与 YYYY-MM-DD；日期-only 直接按原年月日展示，不能被本地时区挪到前一天
assert.match(page, /T00:00:00Z/)
assert.match(page, /const dateOnly = \/\^\(\\d\{4\}\)\-\(\\d\{2\}\)\-\(\\d\{2\}\)\$\/.exec\(trimmed\)/)
// ISO 带不同时区偏移时必须按真实时间排序，不能按原始字符串字典序。
assert.match(page, /const bTime = publishedAtDate\(b\.publishedAt\)\?\.getTime\(\) \?\? 0/)
assert.match(page, /const aTime = publishedAtDate\(a\.publishedAt\)\?\.getTime\(\) \?\? 0/)
assert.match(page, /return bTime - aTime/)
assert.doesNotMatch(page, /publishedAt\.localeCompare/)
// 数字或字符串通知 id 都要能接住，统一落成 string key
assert.match(page, /typeof item\.id === 'string'/)
assert.match(page, /typeof item\.id === 'number'/)
assert.match(page, /Number\.isSafeInteger\(item\.id\)/)
assert.match(page, /id = String\(item\.id\)/)
// 拉到数据后上抛 revision（App 统一回写已读）
assert.match(page, /onRead\?\.\(revision\)/)

// 保留现有视觉与状态：信封红点相关类名不动，空态/加载/失败重试齐全
assert.match(page, /className="page settings-page notifications-page"/)
assert.match(page, /notification-status-card/)
assert.match(page, /notification-empty-card/)
assert.match(page, /notification-retry/)
assert.match(page, /className="notification-list"/)
assert.match(page, /className="notification-card"/)
assert.doesNotMatch(page, /dangerouslySetInnerHTML/)
assert.match(page, /<h2 className="detail-title">消息与通知<\/h2>/)
// 未登录不请求
assert.match(page, /if \(!token\) \{[\s\S]*setLoadState\('signedout'\)/)
assert.match(page, /response\.status === 401[\s\S]*logout\(\)/)

/* ---------- 2. App：未读判定与已读回写都走后端 ---------- */

assert.doesNotMatch(app, /notifications\.json/, 'App 不应再拉静态 feed')
assert.match(app, /const \[notificationServerUnread, setNotificationServerUnread\] = useState\(false\)/)
assert.match(app, /fetch\(`\$\{API_BASE\}\/api\/notifications`/)
assert.match(app, /const hasUnreadNotifications = loggedIn && \(notificationServerUnread \|\| notificationRevision > notificationReadRevision\)/)
assert.match(app, /fetch\(`\$\{API_BASE\}\/api\/notifications\/read`/)
assert.match(app, /response\.status === 401[\s\S]*logout\(\)/)
assert.match(app, /method: 'POST',[\s\S]*body: JSON\.stringify\(\{ revision \}\)/)
assert.match(app, /onRead=\{markNotificationsRead\}/)
assert.match(app, /hasUnreadNotifications=\{hasUnreadNotifications\}/)
// 较早发出的 GET 不能在 read 之后用 stale unread=true 把红点重新点亮；更高 revision 的新消息仍可正常点亮。
assert.match(app, /notificationReadGuardRef = useRef\(\{ epoch: 0, revision: 0 \}\)/)
assert.match(app, /const staleUnread = unread && revision <= readGuard\.revision/)
assert.match(app, /epoch: readGuard\.epoch \+ 1/)
assert.match(app, /revision: Math\.max\(readGuard\.revision, revision\)/)
// 并发 refresh 必须按请求顺序收敛：旧 GET 晚到不能覆盖新 GET。
assert.match(app, /notificationRefreshGuardRef = useRef\(\{ next: 0, applied: 0 \}\)/)
assert.match(app, /const requestId = notificationRefreshGuardRef\.current\.next \+ 1/)
assert.match(app, /if \(requestId < refreshGuard\.applied\) return/)
assert.match(app, /refreshGuard\.applied = requestId/)
// 登录态变化仍按原节奏刷新（visibilitychange / online）
assert.match(app, /document\.addEventListener\('visibilitychange', onVisible\)[\s\S]*window\.addEventListener\('online', onOnline\)/)

// 反馈页作为独立全屏 view：懒加载 + 历史栈返回（与通知页一致）
assert.match(app, /const FeedbackPage = lazy\(\(\) => import\('\.\/components\/FeedbackPage'\)\)/)
assert.match(app, /\| 'feedback' \| 'loading'/)
assert.match(app, /view === 'feedback' \? \(\s*<FeedbackPage onBack=\{\(\) => window\.history\.back\(\)\} \/>/)
assert.match(app, /onGoFeedback=\{openFeedback\}/)

assert.match(feedback, /import \{ getToken, logout \} from '\.\.\/lib\/auth'/)
/* ---------- 3. 反馈与建议页：四类型 + 截图本地校验 ---------- */

for (const type of ['bug', 'idea', 'experience', 'other']) {
  assert.ok(feedback.includes(`value: '${type}'`), `缺少反馈类型 ${type}`)
}
for (const label of ['出问题了', '想要的功能', '用起来的感觉', '其他']) {
  assert.ok(feedback.includes(label), `缺少类型文案「${label}」`)
}

assert.match(feedback, /MAX_IMAGES = 5/)
assert.match(feedback, /MAX_IMAGE_BYTES = 5 \* 1024 \* 1024/)
assert.match(feedback, /MAX_CONTENT_LENGTH = 2000/)
assert.match(feedback, /ACCEPTED_MIME = \['image\/jpeg', 'image\/png', 'image\/webp'\]/)
assert.match(feedback, /accept="image\/jpeg,image\/png,image\/webp"/)

// 选图时就校验 mime / 单张大小 / 数量，而且给人话提示（不静默失败）
assert.match(feedback, /if \(!ACCEPTED_MIME\.includes\(file\.type\)\)/)
assert.match(feedback, /if \(file\.size > MAX_IMAGE_BYTES\)/)
assert.match(feedback, /if \(loaded\.length >= remaining\)/)
// 提交前再核一遍（数量 / 单张大小 / mime），避免白跑一趟
assert.match(feedback, /if \(images\.length > MAX_IMAGES\)/)
assert.match(feedback, /images\.find\(\(image\) => image\.bytes > MAX_IMAGE_BYTES\)/)
assert.match(feedback, /images\.find\(\(image\) => !ACCEPTED_MIME\.includes\(image\.mime\)\)/)

assert.match(feedback, /fetch\(`\$\{API_BASE\}\/api\/feedback`/)
assert.match(feedback, /response\.status === 401[\s\S]*logout\(\)/)
assert.match(feedback, /method: 'POST'/)
assert.match(feedback, /body: JSON\.stringify\(\{[\s\S]*type,[\s\S]*content: trimmed,[\s\S]*images: images\.map\(\(image\) => \(\{ name: image\.name, mime: image\.mime, dataUrl: image\.dataUrl \}\)\)/)
// 成功：明确回执 + 清空；失败：保留已填内容
assert.match(feedback, /收到啦，我们会看到。回复会出现在消息与通知里。/)
assert.match(feedback, /setContent\(''\)[\s\S]*setImages\(\[\]\)[\s\S]*setDone\(true\)/)
assert.match(feedback, /没提交成功，网络可能开小差了。内容都还在/)
// 提交期间冻结所有可修改表单控件，避免慢请求成功后清掉请求期间的新编辑。
assert.match(feedback, /aria-checked=\{selected\}[\s\S]*disabled=\{submitting \|\| readingImages\}/)
assert.match(feedback, /value=\{content\}[\s\S]*disabled=\{submitting \|\| readingImages\}/)
assert.match(feedback, /multiple[\s\S]*disabled=\{submitting \|\| readingImages\}/)
assert.match(feedback, /disabled=\{submitting \|\| readingImages \|\| images\.length >= MAX_IMAGES\}/)
assert.match(feedback, /onClick=\{\(\) => removeImage\(index\)\}[\s\S]*disabled=\{submitting \|\| readingImages\}/)
// 截图读取串行化：读取完成前不能再次选图或提交，合并使用 functional update 避免 stale closure 覆盖。
assert.match(feedback, /imageReadInFlightRef = useRef\(false\)/)
assert.match(feedback, /setReadingImages\(true\)/)
assert.match(feedback, /setImages\(\(current\) => \[\.\.\.current, \.\.\.loaded\]\.slice\(0, MAX_IMAGES\)\)/)
assert.match(feedback, /if \(submitting \|\| readingImages \|\| imageReadInFlightRef\.current\) return/)
assert.match(feedback, /disabled=\{submitting \|\| readingImages\}/)
assert.match(feedback, /正在读取截图…/)
// 长文件名必须有专用 class，CSS 可做 min-width:0 + ellipsis，避免 390px 横向溢出。
assert.match(feedback, /feedback-image-row/)
assert.match(feedback, /feedback-image-name/)

// 视觉：与通知页同一套（settings-page + detail-header + 返回走历史栈）
assert.match(feedback, /className="page settings-page feedback-page"/)
assert.match(feedback, /<h2 className="detail-title">反馈与建议<\/h2>/)
assert.match(feedback, /className="detail-back detail-back-text"/)
assert.match(feedback, /detail-spacer/)

/* ---------- 4. 「我的」入口重排（只动指定分组） ---------- */

function profileGroups(source) {
  const groups = []
  const re = /<ProfileGroup title="([^"]+)">([\s\S]*?)<\/ProfileGroup>/g
  let match
  while ((match = re.exec(source)) !== null) {
    const body = match[2]
    groups.push({
      title: match[1],
      body,
      labels: [...body.matchAll(/label="([^"]+)"/g)].map((item) => item[1]),
    })
  }
  return groups
}

const groups = profileGroups(settings)
const byTitle = new Map(groups.map((group) => [group.title, group]))

assert.ok(byTitle.has('使用与支持'), '缺少「使用与支持」分组')
assert.ok(byTitle.has('账号与隐私'), '缺少「账号与隐私」分组')
assert.ok(!byTitle.has('开始使用'), '「开始使用」应改名为「使用与支持」')
assert.ok(!byTitle.has('账号与同步'), '不应把原有「账号与隐私」分组改成「账号与同步」')

const support = byTitle.get('使用与支持')
const supportWanted = ['使用指南', 'API 设置', '消息与通知', '反馈与建议']
for (const label of supportWanted) {
  assert.ok(support.labels.includes(label), `「使用与支持」组内缺少「${label}」`)
}
assert.deepEqual(
  supportWanted.map((label) => support.labels.indexOf(label)),
  [...supportWanted.map((label) => support.labels.indexOf(label))].sort((a, b) => a - b),
  '「使用与支持」组内顺序应为 使用指南 → API 设置 → 消息与通知 → 反馈与建议',
)
// 消息与通知保留未读红点挂载
assert.match(support.body, /label="消息与通知" onClick=\{onOpenNotifications\} unread=\{hasUnreadNotifications\}/)
assert.match(support.body, /label="反馈与建议" onClick=\{onOpenFeedback\}/)

const account = byTitle.get('账号与隐私')
const accountWanted = ['账号与同步', '隐私', '外观', '关于忆文', '回到欢迎页']
for (const label of accountWanted) {
  assert.ok(account.labels.includes(label), `「账号与隐私」组内缺少「${label}」`)
}
assert.deepEqual(
  accountWanted.map((label) => account.labels.indexOf(label)),
  [...accountWanted.map((label) => account.labels.indexOf(label))].sort((a, b) => a - b),
  '「账号与隐私」组内顺序应保持 账号与同步 → 隐私 → 外观 → 关于忆文 → 回到欢迎页',
)
assert.match(account.body, /<UpdateControls \/>/, '「检查更新」入口应留在「账号与隐私」组末尾')
assert.doesNotMatch(account.body, /消息与通知/, '「消息与通知」应挪到「使用与支持」组')

// 其他分组一律不动（不重排、不删除、不改名）
assert.deepEqual(byTitle.get('关于 TA').labels, ['TA 的资料', '回复长度', '角色管理'])
assert.deepEqual(byTitle.get('关于我').labels, ['重要记录 & 记忆'])
assert.deepEqual(byTitle.get('关于我们').labels, ['纪念日管理'])
assert.deepEqual(byTitle.get('即将开放').labels, ['AI 工作台'])
// 入口接线：Settings 只把反馈页回调透传给 App
assert.match(settings, /onGoFeedback\?: \(\) => void/)
assert.match(settings, /onOpenFeedback=\{\(\) => onGoFeedback\?\.\(\)\}/)
assert.match(app, /onGoFeedback=\{openFeedback\}/)

/* ---------- 5. 红线 ---------- */

// 只检查代码与文案，不含注释（注释里的「数据/它」不面向用户）
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

for (const source of [page, feedback, app, settings]) {
  assert.doesNotMatch(source, /干活/, '文案红线：不许出现「干活」')
}
// 新增/改写的两个页面：不许用「它」指代 TA，也不许出现后台味词
for (const source of [stripComments(page), stripComments(feedback)]) {
  assert.doesNotMatch(source, /它/, '不许用「它」指代 TA')
  assert.doesNotMatch(source, /总结|画像|分析|数据|标签/, '文案红线：不许出现后台味词')
}

console.log('v3 user frontend: PASS')
