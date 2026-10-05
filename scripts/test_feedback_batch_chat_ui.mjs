import assert from 'node:assert/strict'
import fs from 'node:fs'

const settings = fs.readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8')
const bubble = fs.readFileSync(new URL('../src/components/MessageBubble.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/styles/ui2.css', import.meta.url), 'utf8')

assert.match(settings, /onPrivacyOpenChange\?\.\(page !== 'main'\)/, '设置里的任意子页都藏底部导航（2026-10-02：原来只藏 privacy / reply，API 设置 / 纪念日 / 账号 / 外观 / 关于忆文 全漏了）')
assert.match(bubble, /className="message-actions" ref=\{actionsRef\}/, '消息操作位于气泡行之后的独立区域')
assert.match(css, /\.row-assistant \.message-actions \{[\s\S]*align-self: flex-start/, 'TA 操作入口贴气泡左下')
assert.match(css, /\.row-user \.message-actions \{[\s\S]*align-self: flex-end/, '用户操作入口贴气泡右下')
assert.match(css, /\.message-actions-menu \{[\s\S]*max-width: calc\(100vw - 24px\)[\s\S]*display: flex/, '操作菜单横排且受视口宽度约束')
assert.match(css, /animation: message-actions-in/, '操作菜单有轻量开启动效')
assert.match(settings, /getCurrentBuildVersion\(\)/, '关于页读构建版本号（2026-10-04：用户要能在手机上自查跑的是哪一版）')
assert.match(settings, /className="about-build"[\s\S]{0,120}buildVersion\.slice\(0, 8\)/, '关于页展示构建号前 8 位（完整值放 title）')
assert.match(fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8'), /\.about-build \{/, '构建号有独立样式，不挤在版本号那一行')

console.log('feedback batch chat UI: PASS')
