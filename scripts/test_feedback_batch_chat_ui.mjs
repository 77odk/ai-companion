import assert from 'node:assert/strict'
import fs from 'node:fs'

const settings = fs.readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8')
const bubble = fs.readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/styles/ui2.css', import.meta.url), 'utf8')

assert.match(settings, /page === 'privacy' \|\| page === 'reply'/, '聊天设置与隐私共用全屏二级页导航隐藏信号')
assert.match(bubble, /className="message-actions" ref=\{actionsRef\}/, '消息操作位于气泡行之后的独立区域')
assert.match(css, /\.row-assistant \.message-actions \{[\s\S]*align-self: flex-start/, 'TA 操作入口贴气泡左下')
assert.match(css, /\.row-user \.message-actions \{[\s\S]*align-self: flex-end/, '用户操作入口贴气泡右下')
assert.match(css, /\.message-actions-menu \{[\s\S]*display: flex[\s\S]*max-width: calc\(100vw - 24px\)/, '操作菜单横排且受视口宽度约束')
assert.match(css, /animation: message-actions-in/, '操作菜单有轻量开启动效')

console.log('feedback batch chat UI: PASS')
