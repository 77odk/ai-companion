// TA 的空间 · 配图 dataURL 生成（TASK_UI_BATCH2 配图）
// 用 canvas 画一张「柔和渐变 + 大字」的小图，不引任何外部图片资源、不新增 npm 依赖。
// 只在浏览器（有 canvas）的环境用；Node 单测环境没有 document，返回 null 不影响纯逻辑。

import type { SpaceKind } from './aiSpaceCore.ts'

/** 每种 kind 的渐变主色（跟 CSS art-tone 同族：暖橘 / 奶绿 / 浅蓝 / 淡紫 / 暖黄 / 玫粉） */
const KIND_COLORS: Record<SpaceKind, [string, string]> = {
  日常: ['#ff8a5c', '#fff0e6'],
  心情: ['#84a94a', '#f3f7e8'],
  钻研: ['#5a94c4', '#e8f1f8'],
  天气: ['#a46ac0', '#f5eaf8'],
  想你: ['#e0a854', '#fcf4e4'],
  小确幸: ['#d66a82', '#fcecf0'],
}

/**
 * 生成一张配图 dataURL（320×200 PNG）。
 * kind 决定渐变配色，caption 作为图上文字（超长截断）。
 * 无 canvas 环境（Node 单测 / 环境异常）返回 null，调用方当「没配图」处理。
 */
export function createPostImageDataUrl(kind: SpaceKind, caption: string): string | null {
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 200
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const [c1, c2] = KIND_COLORS[kind] ?? KIND_COLORS.日常
    const grad = ctx.createLinearGradient(0, 0, 320, 200)
    grad.addColorStop(0, c1)
    grad.addColorStop(1, c2)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 320, 200)

    // 柔和的大圆点缀，让画面不那么平
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.beginPath()
    ctx.arc(240, 56, 88, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.beginPath()
    ctx.arc(72, 150, 56, 0, Math.PI * 2)
    ctx.fill()

    // 图上文字
    const label = (caption || 'TA 的生活').slice(0, 14)
    ctx.fillStyle = 'rgba(70,50,40,0.72)'
    ctx.font = '26px "PingFang SC","Microsoft YaHei",sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 160, 106)

    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
