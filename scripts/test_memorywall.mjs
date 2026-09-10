// 记忆墙四组映射 · 纯逻辑自测（TASK-UI-BATCH6）
// 2026-09-10：现有记忆按内容主题存，记忆墙四组（习惯/喜欢/约定/印象）是展示层只读映射。
// 跑法：node scripts/test_memorywall.mjs
import {
  classifyMemoryToWall,
  groupMemoriesByWall,
  groupSummary,
  MEMORY_WALL_GROUPS,
} from '../src/lib/memoryWall.ts'

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

function mem(text, createdAt = 1000) {
  return { id: String(Math.random()), text, createdAt }
}

// 约定优先
ok(classifyMemoryToWall(mem('答应你周五一起看电影')) === 'promises', '「答应你周五一起看电影」→ 约定（带喜欢词也归约定）')
ok(classifyMemoryToWall(mem('我们说好了周末去爬山')) === 'promises', '「说好了周末去爬山」→ 约定')
ok(classifyMemoryToWall(mem('约好下周一起吃饭')) === 'promises', '「约好下周一起吃饭」→ 约定')

// 喜欢
ok(classifyMemoryToWall(mem('她喜欢粉色')) === 'likes', '「喜欢粉色」→ 喜欢')
ok(classifyMemoryToWall(mem('最爱吃米粉')) === 'likes', '「最爱吃米粉」→ 喜欢')
ok(classifyMemoryToWall(mem('想要一只小猫')) === 'likes', '「想要一只小猫」→ 喜欢')

// 习惯
ok(classifyMemoryToWall(mem('她上晚班，作息颠倒')) === 'habit', '「上晚班作息颠倒」→ 习惯')
ok(classifyMemoryToWall(mem('睡前要喝水')) === 'habit', '「睡前要喝水」→ 习惯')
ok(classifyMemoryToWall(mem('经常熬夜到两点')) === 'habit', '「经常熬夜」→ 习惯')

// 映射不上归印象
ok(classifyMemoryToWall(mem('她养了一只叫包子的狗')) === 'impressions', '「养狗」→ 印象（内容主题不是四组视角）')
ok(classifyMemoryToWall(mem('对香菜过敏')) === 'impressions', '「对香菜过敏」→ 印象（无四组关键词）')
ok(classifyMemoryToWall(mem('')) === 'impressions', '空文本 → 印象兜底')

// 分组与倒序
{
  const groups = groupMemoriesByWall([
    mem('她喜欢粉色', 300),
    mem('说好周五看电影', 100),
    mem('上晚班', 200),
    mem('养了狗', 400),
  ])
  ok(groups.likes.length === 1 && groups.likes[0].text === '她喜欢粉色', '喜欢组收 1 条')
  ok(groups.promises.length === 1 && groups.promises[0].text === '说好周五看电影', '约定组收 1 条')
  ok(groups.habit.length === 1 && groups.habit[0].text === '上晚班', '习惯组收 1 条')
  ok(groups.impressions.length === 1 && groups.impressions[0].text === '养了狗', '印象组收兜底 1 条')
  ok(groups.habit[0].createdAt === 200 && groups.likes[0].createdAt === 300, '组内按时间倒序')

  const mixed = groupMemoriesByWall([mem('喜欢旧的', 1), mem('喜欢新的', 2)])
  ok(mixed.likes[0].createdAt === 2 && mixed.likes[1].createdAt === 1, '组内倒序（多条）')
}

// 摘要
ok(groupSummary([]) === '', '空组摘要为空串')
ok(groupSummary([mem('睡前要喝水')]) === '睡前要喝水', '短摘要原样')
ok(groupSummary([mem('这是一条很长很长的记忆文本用来测试截断')]) === '这是一条很长很长的记忆文本用来测试截…', '长摘要截断到 18 字加省略号')

// 四组元数据齐全且顺序固定
ok(MEMORY_WALL_GROUPS.length === 4, '四组元数据')
ok(MEMORY_WALL_GROUPS.map((g) => g.title).join('/') === '关于你的习惯/你喜欢的东西/我们之间的约定/TA 对你的印象', '组名与顺序固定')
ok(MEMORY_WALL_GROUPS.every((g) => typeof g.empty === 'string' && g.empty.length > 0), '每组有空态文案')

console.log(`\nmemoryWall: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
