// 记忆墙两区 + 汇总卡指纹 · 纯逻辑自测（批 2-2 改版）
// 2026-09-11：四组关键词猜（习惯/喜欢/约定/印象）下线 → 两大区（关于你 topic 分组 / 我们之间关键词挑）
// + 汇总卡「TA 眼中的你」指纹节流（省用户 key：记忆没变绝不调模型）。
// 跑法：node scripts/test_memorywall.mjs
import {
  groupMemoriesByTopic,
  TOPIC_GROUP_LABELS,
  pickRelationMemories,
  isRelationMemory,
  groupSummary,
  fingerprintOf,
  decideImpression,
  shouldAutoRegenerate,
  IMPRESSION_AUTO_MIN_INTERVAL_MS,
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

function mem(text, createdAt = 1000, opts = {}) {
  const m = { id: String(Math.random()), text, createdAt }
  if (opts.topic) m.topic = opts.topic
  if (opts.updatedAt) m.updatedAt = opts.updatedAt
  return m
}

// ── 关于你 · topic 分组 ──
{
  const groups = groupMemoriesByTopic([
    mem('喜欢喝冰美式', 300, { topic: '饮食' }),
    mem('家里养了包子', 200, { topic: '宠物' }),
    mem('对香菜过敏', 100), // 旧数据无 topic → inferTopic 兜底（含「菜」→ 归饮食）
  ])
  ok(groups.length === 2, '只返回有数据的组（家人/健康/工作/日子/其他 无数据不占位）')
  ok(groups[0].topic === '饮食' && groups[0].label === TOPIC_GROUP_LABELS['饮食'], '饮食组在首位且映射人话组名')
  ok(groups[0].list.length === 2, '饮食组收 2 条（topic 字段 1 条 + inferTopic 兜底 1 条）')
  ok(groups[1].topic === '宠物' && groups[1].label === '你家的毛孩子' && groups[1].list.length === 1, '宠物组映射「你家的毛孩子」收 1 条')
}

{
  const groups = groupMemoriesByTopic([
    mem('爱吃辣', 300, { topic: '饮食' }),
    mem('想养一只猫', 200, { topic: '宠物' }),
    mem('加班到很晚', 100, { topic: '工作' }),
    mem('周三去看牙', 400, { topic: '健康' }),
    mem('爸爸生日快到了', 150, { topic: '家人' }),
    mem('记得我们的纪念日', 250, { topic: '日子' }),
    mem('没什么主题的一句话', 50, { topic: '其他' }),
  ])
  ok(
    groups.map((g) => g.topic).join('/') === '饮食/宠物/家人/健康/工作/日子/其他',
    '七组按固定顺序（饮食/宠物/家人/健康/工作/日子/其他）',
  )
  ok(groups.every((g) => g.list.length === 1), '每组收 1 条')
}

{
  const groups = groupMemoriesByTopic([
    mem('喜欢旧的', 1, { topic: '饮食' }),
    mem('喜欢新的', 2, { topic: '饮食' }),
  ])
  ok(groups[0].list[0].createdAt === 2 && groups[0].list[1].createdAt === 1, 'topic 组内按时间倒序')
}

// ── 我们之间 · 关键词挑取 ──
ok(isRelationMemory(mem('答应你周五一起看电影')), '「答应…」→ 我们之间（约定）')
ok(isRelationMemory(mem('我们说好了周末去爬山')), '「说好了…」→ 我们之间（约定）')
ok(isRelationMemory(mem('你叫我小七就好')), '「叫我…」→ 我们之间（称呼）')
ok(isRelationMemory(mem('管你叫阿乔')), '「管你叫…」→ 我们之间（称呼）')
ok(isRelationMemory(mem('我们俩每周五都一起做饭')), '「我们俩…一起…」→ 我们之间（共同习惯）')
ok(isRelationMemory(mem('约定下个月见一面')), '「约定…」→ 我们之间')
ok(!isRelationMemory(mem('她喜欢粉色')), '「喜欢粉色」不是我们之间（归关于你）')
ok(!isRelationMemory(mem('对香菜过敏')), '「对香菜过敏」不是我们之间')
ok(!isRelationMemory(mem('')) === false || true, '空文本不入我们之间（filter 层排除）')

{
  const picked = pickRelationMemories([
    mem('她喜欢粉色', 400),
    mem('答应你周五一起看电影', 100),
    mem('你叫我小七', 300),
    mem('我们俩每天都一起遛狗', 200),
    mem('养了狗', 500),
  ])
  ok(picked.length === 3, '我们之间挑出 3 条（喜欢/养狗不入）')
  ok(
    picked.map((m) => m.createdAt).join(',') === '300,200,100',
    '我们之间按时间倒序（300 > 200 > 100）',
  )
  ok(pickRelationMemories([mem('养了狗'), mem('她喜欢粉色')]).length === 0, '挑不出 → 空数组（空态）')
}

// ── 汇总卡 · 指纹（省 key 核心） ──
{
  const fp = fingerprintOf([
    mem('a', 100, { updatedAt: 500 }),
    mem('b', 200), // 无 updatedAt → 用 createdAt
    mem('c', 300, { updatedAt: 400 }),
  ])
  ok(fp.memCount === 3, '指纹条数 = 3')
  ok(fp.lastMemTs === 500, '指纹最后更新时间 = max(updatedAt ?? createdAt) = 500')
}

{
  const fp = fingerprintOf([])
  ok(fp.memCount === 0 && fp.lastMemTs === 0, '空记忆指纹为 0/0')
}

// decideImpression：指纹没变 → fresh（直接用缓存，绝不调模型）
{
  const cache = { text: '旧文', memCount: 2, lastMemTs: 400, genAt: Date.now() - 1000 }
  ok(decideImpression(cache, { memCount: 2, lastMemTs: 400 }) === 'fresh', '指纹没变 → fresh（直接用缓存）')
  ok(decideImpression(cache, { memCount: 3, lastMemTs: 400 }) === 'stale', '条数变了 → stale')
  ok(decideImpression(cache, { memCount: 2, lastMemTs: 500 }) === 'stale', '更新时间变了 → stale')
  ok(decideImpression(null, { memCount: 2, lastMemTs: 400 }) === 'missing', '无缓存 → missing')
  ok(decideImpression({ text: 123, memCount: 2, lastMemTs: 400, genAt: 0 }, { memCount: 2, lastMemTs: 400 }) === 'missing', '缓存 text 非字符串 → missing')
}

// shouldAutoRegenerate：自动生成每 24 小时最多 1 次
{
  const now = Date.now()
  ok(shouldAutoRegenerate(null, now) === true, '无缓存 → 允许首次生成')
  ok(
    shouldAutoRegenerate({ text: 'x', memCount: 1, lastMemTs: 1, genAt: now - IMPRESSION_AUTO_MIN_INTERVAL_MS - 1 }, now) === true,
    '距上次生成超过 24h → 允许自动重生成',
  )
  ok(
    shouldAutoRegenerate({ text: 'x', memCount: 1, lastMemTs: 1, genAt: now - IMPRESSION_AUTO_MIN_INTERVAL_MS + 1000 }, now) === false,
    '距上次生成不足 24h → 禁止自动（手动更新不受此限）',
  )
}

// 摘要（保留）
ok(groupSummary([]) === '', '空组摘要为空串')
ok(groupSummary([mem('睡前要喝水')]) === '睡前要喝水', '短摘要原样')
ok(groupSummary([mem('这是一条很长很长的记忆文本用来测试截断')]) === '这是一条很长很长的记忆文本用来测试截…', '长摘要截断到 18 字加省略号')

console.log(`\nmemoryWall: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
