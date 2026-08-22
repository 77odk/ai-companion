// TA 的空间 · 动态插画配图
// 纯展示组件：按 kind 输出极简线条插画（1.5px 细描边、圆角、暖色系，无 emoji）。
// 一个 kind 有 2 个变体，生成动态时随机定好 variant，渲染保持固定。
// 颜色用 currentColor，由外层 .ai-space-art 的柔和渐变底色 + 色相控制。

import type { ReactNode } from 'react'
import type { SpaceKind } from '../lib/aiSpaceCore'

interface Props {
  kind: string
  variant?: number
}

/** 日常：咖啡杯 / 窗台小景 */
function dailyArt(v: number) {
  if (v % 2 === 1) {
    return (
      <>
        <rect x="30" y="16" width="60" height="48" rx="4" />
        <path d="M60 16v48M30 40h60" />
        <path d="M36 64v6h48" />
        <path d="M46 64c-2-9 4-13 10-11 2 7-2 11-10 11z" />
        <path d="M70 64c0-9 6-13 12-11-2 7-6 11-12 11z" />
      </>
    )
  }
  return (
    <>
      <ellipse cx="60" cy="60" rx="26" ry="5" />
      <path d="M42 34h28v12a8 8 0 0 1-8 8h-12a8 8 0 0 1-8-8z" />
      <path d="M70 40h4a5 5 0 0 1 0 10h-4" />
      <path d="M50 28c-2-2 2-4 0-6" />
      <path d="M58 28c-2-2 2-4 0-6" />
    </>
  )
}

/** 心情：云朵 / 月亮 */
function moodArt(v: number) {
  if (v % 2 === 1) {
    return (
      <>
        <path d="M76 20a24 24 0 1 0 2 40 20 20 0 0 1-2-40z" />
        <path d="M36 26l1.5 3.5 3.5 1.5-3.5 1.5L36 36l-1.5-3.5L31 31l3.5-1.5z" />
      </>
    )
  }
  return (
    <>
      <path d="M36 50a10 10 0 0 1-1-20 14 14 0 0 1 26-2 11 11 0 0 1 20 8 9 9 0 0 1-9 14z" />
      <path d="M86 30l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" />
    </>
  )
}

/** 钻研：键盘 / 翻开的书 */
function workArt(v: number) {
  if (v % 2 === 1) {
    return (
      <>
        <path d="M60 26c-8-6-20-6-27-2v36c7-4 19-4 27 2z" />
        <path d="M60 26c8-6 20-6 27-2v36c-7-4-19-4-27 2z" />
        <path d="M60 26v36" />
        <path d="M38 34h14M38 42h10" />
        <path d="M68 34h14M72 42h10" />
      </>
    )
  }
  return (
    <>
      <rect x="24" y="30" width="72" height="26" rx="6" />
      <rect x="31" y="36" width="8" height="6" rx="1.5" />
      <rect x="44" y="36" width="8" height="6" rx="1.5" />
      <rect x="57" y="36" width="8" height="6" rx="1.5" />
      <rect x="70" y="36" width="8" height="6" rx="1.5" />
      <rect x="31" y="45" width="8" height="6" rx="1.5" />
      <rect x="44" y="45" width="8" height="6" rx="1.5" />
      <rect x="57" y="45" width="8" height="6" rx="1.5" />
      <rect x="70" y="45" width="18" height="6" rx="1.5" />
    </>
  )
}

/** 天气：太阳 / 雨伞 */
function weatherArt(v: number) {
  if (v % 2 === 1) {
    return (
      <>
        <path d="M30 40a30 22 0 0 1 60 0z" />
        <path d="M60 40v16a7 7 0 0 1-14 0" />
        <path d="M34 54l-4 8M60 56l-4 8M86 54l-4 8" />
      </>
    )
  }
  return (
    <>
      <circle cx="60" cy="40" r="13" />
      <path d="M60 16v8M60 56v8M36 40h8M76 40h8M42 22l6 6M72 52l6 6M78 22l-6 6M48 52l-6 6" />
    </>
  )
}

/** 想你：星星 / 信封 */
function missArt(v: number) {
  if (v % 2 === 1) {
    return (
      <>
        <rect x="28" y="30" width="64" height="30" rx="4" />
        <path d="M28 30l32 22 32-22" />
        <path d="M60 50c-5-3-9-5-9-9a4.5 4.5 0 0 1 9-1.6 4.5 4.5 0 0 1 9 1.6c0 4-4 6-9 9z" />
      </>
    )
  }
  return (
    <>
      <path d="M60 20l6 8 10 2-8 7 2 10-10-5-10 5 2-10-8-7 10-2z" />
      <path d="M34 24l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" />
      <path d="M84 44l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" />
    </>
  )
}

/** 小确幸：小花 / 猫咪爪印 */
function joyArt(v: number) {
  if (v % 2 === 1) {
    return (
      <>
        <ellipse cx="60" cy="52" rx="14" ry="10" />
        <ellipse cx="44" cy="36" rx="6" ry="8" />
        <ellipse cx="60" cy="32" rx="6" ry="8" />
        <ellipse cx="76" cy="36" rx="6" ry="8" />
      </>
    )
  }
  return (
    <>
      <circle cx="60" cy="30" r="6" />
      <circle cx="72" cy="42" r="6" />
      <circle cx="60" cy="54" r="6" />
      <circle cx="48" cy="42" r="6" />
      <circle cx="60" cy="42" r="5.5" />
      <path d="M60 47v16" />
      <path d="M60 52c-7-1-10-4-10-7 0-2 6-2 10 2z" />
      <path d="M60 57c7-1 10-4 10-7 0-2-6-2-10 2z" />
    </>
  )
}

const ART: Record<SpaceKind, (v: number) => ReactNode> = {
  日常: dailyArt,
  心情: moodArt,
  钻研: workArt,
  天气: weatherArt,
  想你: missArt,
  小确幸: joyArt,
}

/** 按 kind 输出极简线条插画 SVG（1.5px 细描边，颜色跟随 currentColor） */
export default function SpaceArt({ kind, variant = 0 }: Props) {
  const render = (ART as Record<string, (v: number) => ReactNode>)[kind] ?? dailyArt
  return (
    <svg
      className="ai-space-art-svg"
      viewBox="0 0 120 80"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {render(variant)}
    </svg>
  )
}
