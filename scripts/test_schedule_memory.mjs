// 作息自动记（2026-09-09 七七拍板）自测
// 跑法：node scripts/test_schedule_memory.mjs
// 覆盖：稳定作息命中（班次制/时间作息）/ 一次性语境不误记 / 主题归「工作」
import { detectScheduleFact, inferTopic } from '../src/lib/memory.ts'

let passed = 0
let failed = 0
function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, `${name}（得 ${a}，期望 ${b}）`)
}

console.log('\n[1] 稳定作息命中')
eq(detectScheduleFact('我上晚班'), '我上晚班', '我上晚班 → 记')
eq(detectScheduleFact('我是晚班'), '我是晚班', '我是晚班 → 记')
eq(detectScheduleFact('我是夜班，上到凌晨两点'), '我是夜班，上到凌晨两点', '夜班+到点 → 记')
eq(detectScheduleFact('我每天八点上班'), '我每天八点上班', '我每天八点上班 → 记')
eq(detectScheduleFact('我晚上十一点才下班'), '我晚上十一点才下班', '我晚上十一点才下班 → 记')
eq(detectScheduleFact('我一般九点半睡觉'), '我一般九点半睡觉', '我一般九点半睡觉 → 记')
eq(detectScheduleFact('我早上六点半起床'), '我早上六点半起床', '我早上六点半起床 → 记')
eq(detectScheduleFact('我平时下午两点上班'), '我平时下午两点上班', '我平时下午两点上班 → 记')
eq(detectScheduleFact('我的班是白班'), '我的班是白班', '我的班是白班 → 记（班次词）')

console.log('\n[2] 一次性语境不误记（红线：今天/明天/昨晚/待会不算稳定作息）')
eq(detectScheduleFact('我今天晚班'), null, '今天晚班（轮班排班）→ 不记')
eq(detectScheduleFact('明天早班，得早点睡'), null, '明天早班 → 不记')
eq(detectScheduleFact('我昨晚加班到十一点'), null, '昨晚加班 → 不记')
eq(detectScheduleFact('我昨天上晚班'), null, '昨天上晚班 → 不记')
eq(detectScheduleFact('待会还要去上班'), null, '待会上班 → 不记')

console.log('\n[3] 无关/情绪话不误记')
eq(detectScheduleFact('我好累想睡觉'), null, '我好累想睡觉 → 不记')
eq(detectScheduleFact('晚安'), null, '晚安 → 不记')
eq(detectScheduleFact('我上班摸鱼了'), null, '上班摸鱼（一次性行为）→ 不记')
eq(detectScheduleFact('你早点休息'), null, '对 TA 说的话 → 不记')
eq(detectScheduleFact(''), null, '空串 → 不记')
eq(detectScheduleFact('我们去看电影吧'), null, '约定话 → 不记')

console.log('\n[4] 主题归拢：作息类记忆归「工作」')
eq(inferTopic('我上晚班'), '工作', '上晚班 → 工作')
eq(inferTopic('我晚上十一点下班'), '工作', '下班时间 → 工作')
eq(inferTopic('我每天八点上班'), '工作', '上班时间 → 工作')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
