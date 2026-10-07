import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CONTINUOUS_USE_REMINDER_MS,
  DENSE_CHAT_REPLY_COUNT,
  DENSE_CHAT_WINDOW_MS,
  pruneCommittedReplyTimes,
  shouldShowContinuousUseReminder,
  shouldShowRealityBoundaryReminder,
} from '../src/lib/wellbeingPolicy.ts'
import { cleanMemoryProtocolArtifacts } from '../src/lib/memory.ts'

const app = readFileSync('src/App.tsx', 'utf8')
const guard = readFileSync('src/components/WellbeingGuard.tsx', 'utf8')
const welcome = readFileSync('src/components/Welcome.tsx', 'utf8')
const profile = readFileSync('src/components/ChatProfile.tsx', 'utf8')
const settings = readFileSync('src/components/Settings.tsx', 'utf8')
const login = readFileSync('src/components/LoginForm.tsx', 'utf8')
const consent = readFileSync('src/components/ConsentGate.tsx', 'utf8')
const sync = readFileSync('src/lib/sync.ts', 'utf8')
const aboutMe = readFileSync('src/components/AboutMe.tsx', 'utf8')
const bubble = readFileSync('src/components/MessageBubble.tsx', 'utf8')
const attribution = readFileSync('src/lib/promptAttribution.ts', 'utf8')
const star = readFileSync('src/components/StarJar.tsx', 'utf8')
const spaceCss = readFileSync('src/styles/space.css', 'utf8')
const privacy = readFileSync('public/privacy.html', 'utf8')

console.log('[S6] 连续使用 2 小时提醒只走本机规则')
assert.equal(CONTINUOUS_USE_REMINDER_MS, 2 * 60 * 60_000)
assert.equal(shouldShowContinuousUseReminder(CONTINUOUS_USE_REMINDER_MS - 1, false), false)
assert.equal(shouldShowContinuousUseReminder(CONTINUOUS_USE_REMINDER_MS, false), true)
assert.equal(shouldShowContinuousUseReminder(CONTINUOUS_USE_REMINDER_MS, true), false)
assert.match(guard, /已经连续使用约 2 小时/)
assert.match(guard, /visibilityState === 'visible'/)
assert.doesNotMatch(guard, /fetch\(|chatCompletion|localStorage|sessionStorage/)

console.log('[S6] 对话过密提醒本地判断，不读取聊天正文、不诊断用户')
const now = Date.now()
const twentyThree = Array.from({ length: DENSE_CHAT_REPLY_COUNT - 1 }, (_, i) => now - i * 1000)
const twentyFour = [...twentyThree, now - 30_000]
assert.equal(shouldShowRealityBoundaryReminder(twentyThree, now, false), false)
assert.equal(shouldShowRealityBoundaryReminder(twentyFour, now, false), true)
assert.equal(shouldShowRealityBoundaryReminder(twentyFour, now, true), false)
assert.equal(
  pruneCommittedReplyTimes([now - DENSE_CHAT_WINDOW_MS - 1, now], now).length,
  1,
)
assert.match(guard, /yiwem:ai-reply-committed/)
assert.match(guard, /TA 是 AI 陪伴，不替代现实中的家人、朋友或专业支持/)
assert.doesNotMatch(guard, /message\.content|messagesCache|getMessages/)

console.log('[S6] 退出登录在“我的”根页直接可达')
assert.match(settings, /const handleLogout = \(\) =>/)
assert.match(settings, /className="btn logout-btn" onClick=\{handleLogout\}/)
assert.match(settings, />\s*退出登录\s*</)
assert.doesNotMatch(settings, /onOpenAccount[\s\S]{0,240}退出登录/, '退出不依赖先进入账号二级页')

console.log('[S6] AI 身份在进入前 + 聊天中 + TA 资料持续可见')
assert.match(consent, /忆文是一项 AI 陪伴服务/)
assert.match(consent, /TA 不是真人/)
assert.match(welcome, /AI 陪伴服务 · 由 AI 驱动/)
assert.match(app, /chat-header-ai-badge/)
assert.match(app, /title="AI 陪伴服务"/)
assert.match(profile, /ta-profile-ai-badge/)
assert.match(profile, />AI 陪伴</)

console.log('[S6] 年龄资格由注册后端独立决定；前端只要求完整 DOB')
assert.match(login, /view === 'register' && \(!dobY \|\| !dobM \|\| !dobD\)/)
assert.match(login, /dateOfBirth: dobY && dobM && dobD/)
assert.match(sync, /extra\.date_of_birth = opts\.dateOfBirth\.trim\(\)/)
assert.match(sync, /postAuth\('\/api\/register'/)
assert.match(consent, /Consent ≠ Age Verification/)
assert.match(consent, /年龄资格验证在注册时由后端用 DOB 算/)
assert.match(privacy, /忆文面向 18 周岁及以上用户/)
assert.match(privacy, /未满 18 周岁不能使用/)

console.log('[S6] 旧入口文案与内部来源前缀不再漏到展示层')
assert.doesNotMatch(aboutMe, /TA所忆|TA 的空间\s*→/)
assert.match(aboutMe, /朝暮 → 记忆长河/)
assert.match(bubble, /cleanAttributionArtifacts/)
assert.match(attribution, /回复里绝不能输出/)
assert.match(attribution, /cleanStreamingAttributionArtifacts/)
assert.match(attribution, /hasAttributionLeak/)
assert.equal(
  cleanMemoryProtocolArtifacts('[source=USER] USER的生日是10月7日'),
  '我的生日是10月7日',
  '确认来源协议后才还原 USER 视角',
)
assert.equal(
  cleanMemoryProtocolArtifacts('I like self care and shared playlists'),
  'I like self care and shared playlists',
  '普通自然文本里的 self/shared 不得被协议清理误改',
)

console.log('[S6] Space 性能：30–45 可见星只让 6 颗动；隐藏页暂停；粗指针扩大触控区')
assert.match(star, /index < 6 \? 'is-moving' : ''/)
assert.match(spaceCss, /\.star-jar-star\.is-moving/)
assert.match(spaceCss, /html\.eluvin-page-hidden \.ai-space-page \*/)
assert.match(spaceCss, /animation-play-state: paused !important/)
assert.match(app, /classList\.toggle\('eluvin-page-hidden'/)
assert.match(spaceCss, /@media \(pointer: coarse\)/)
assert.match(spaceCss, /\.thought-turn-hit[\s\S]{0,100}width: 24%/)
assert.match(spaceCss, /@media \(prefers-reduced-motion: reduce\)/)

console.log('[Space S6] 清理 / 性能 / 本地提醒 / AI 身份 / 退出 / 年龄资格合同 全通过')
