// 同轮记忆归并回归测试（TASK-MEM-DISTILL：本地显式检测 + 模型 marker 只写一条）
// 覆盖：显式记住/偏好/作息/短答追问 与 marker 的归并、fallback、inferred 语义、
//       source 真实性、中英文 marker 解析、同轮无双写、跨轮去重不受影响。
// 跑法：node scripts/test_memory_distill.mjs（npm test 会自动纳入 scripts/test_*.mjs）

import { detectMemoryInstruction, extractMemories, isSimilarMemory, matchMarkerToCandidate, planMemoryWrites, stripMemoryMarkers } from '../src/lib/memory.ts'

let passed = 0
let failed = 0
function ok(cond, name) {
  if (cond) {
    passed++
  } else {
    failed++
    console.log(`  ✗ FAIL: ${name}`)
  }
}
function eq(a, b, name) {
  if (JSON.stringify(a) === JSON.stringify(b)) {
    passed++
  } else {
    failed++
    console.log(`  ✗ FAIL: ${name}（得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`)
  }
}
function isExplicit(w) {
  return w.explicit === true
}
function isInferred(w) {
  return w.explicit === undefined || w.explicit === false
}

const userText = '帮我记一下我喜欢吃话梅味的排骨'
const cand = { text: '我喜欢吃话梅味的排骨', source: userText, topic: '饮食' }

console.log('\n[1] matchMarkerToCandidate：原话 vs 提炼版命中')
{
  eq(matchMarkerToCandidate([cand], 'TA 喜欢吃话梅味的排骨')?.text, cand.text, '提炼版命中候选')
  eq(matchMarkerToCandidate([cand], '对方喜欢吃话梅味的排骨')?.text, cand.text, '视角转换后仍命中')
  eq(matchMarkerToCandidate([cand], '你喜欢吃话梅味的排骨')?.text, cand.text, '包含关系命中')
}

console.log('\n[2] matchMarkerToCandidate：不命中/空输入')
{
  ok(matchMarkerToCandidate([cand], '今天天气很好') === null, '无关 marker 不命中')
  ok(matchMarkerToCandidate([cand], '') === null, '空 marker → null')
  ok(matchMarkerToCandidate([], 'TA 喜欢吃话梅味的排骨') === null, '空候选 → null')
  ok(matchMarkerToCandidate(null, 'TA 喜欢吃话梅味的排骨') === null, 'null 候选 → null')
}

console.log('\n[3] matchMarkerToCandidate：多候选取第一个命中')
{
  const c2 = { text: '我上晚班', source: '我上晚班', topic: '工作' }
  const c3 = { text: '我养了一只猫', source: '我养了一只猫', topic: '宠物' }
  const hit = matchMarkerToCandidate([c2, c3], '对方养了一只猫')
  eq(hit?.text, c3.text, '命中第二个候选')
}

console.log('\n[4] 任务1：显式“记住” + marker → 仅 1 条，text 为提炼版，explicit=true，source=用户原话')
{
  const plans = planMemoryWrites([cand], extractMemories('【记忆·饮食】TA 喜欢吃话梅味的排骨'), userText)
  eq(plans.length, 1, '只写 1 条（无双写）')
  ok(isExplicit(plans[0]), 'explicit=true（用户明确事实不被降级）')
  eq(plans[0].text, 'TA 喜欢吃话梅味的排骨', 'text = 模型提炼版')
  eq(plans[0].source, userText, 'source = 用户真实原话')
  eq(plans[0].topic, '饮食', 'topic 用 marker 主题')
}

console.log('\n[5] 任务2：偏好检测 + marker → 仅 1 条提炼版 explicit')
{
  const pref = { text: '我喜欢吃辣', source: '我喜欢吃辣', topic: '饮食' }
  const plans = planMemoryWrites([pref], extractMemories('【记忆·饮食】对方喜欢吃辣'), '我喜欢吃辣')
  eq(plans.length, 1, '只写 1 条')
  ok(isExplicit(plans[0]), 'explicit=true')
  eq(plans[0].text, '对方喜欢吃辣', 'text = 提炼版')
}

console.log('\n[6] 任务3：作息检测 + marker → 仅 1 条提炼版 explicit')
{
  const sched = { text: '我每天八点上班', source: '我每天八点上班', topic: '工作' }
  const plans = planMemoryWrites([sched], extractMemories('【记忆·工作】对方每天八点上班'), '我每天八点上班')
  eq(plans.length, 1, '只写 1 条')
  ok(isExplicit(plans[0]), 'explicit=true')
  eq(plans[0].topic, '工作', 'topic = 工作')
}

console.log('\n[7] 任务4：短答追问 + marker → 仅 1 条提炼版 explicit，source 保住用户回答')
{
  const shortCand = { text: '喜欢话梅', source: '我答：话梅\nTA问：你喜欢吃什么？', topic: '饮食' }
  const plans = planMemoryWrites([shortCand], extractMemories('【记忆·饮食】对方喜欢吃话梅'), '我答：话梅\nTA问：你喜欢吃什么？')
  eq(plans.length, 1, '只写 1 条')
  ok(isExplicit(plans[0]), 'explicit=true')
  ok(plans[0].source.startsWith('我答：话梅'), 'source 用户实际回答在前')
}

console.log('\n[8] 任务5：explicit candidate + 模型没 marker → fallback 仍写入且 explicit=true')
{
  const plans = planMemoryWrites([cand], [], userText)
  eq(plans.length, 1, 'fallback 写 1 条')
  ok(isExplicit(plans[0]), 'fallback explicit=true')
  eq(plans[0].text, cand.text, 'text = 本地候选原话')
  eq(plans[0].source, userText, 'source = 用户原话')
}

console.log('\n[9] 任务6：只有模型 marker、无本地候选 → 保持 inferred，不得自动升级 explicit')
{
  const plans = planMemoryWrites([], extractMemories('【记忆】TA 觉得今天天气不错'), '今天天气真好')
  eq(plans.length, 1, '写 1 条')
  ok(isInferred(plans[0]), 'inferred（explicit 不设）')
  eq(plans[0].text, 'TA 觉得今天天气不错', 'text = marker 内容')
  eq(plans[0].source, '今天天气真好', 'source = 用户消息')
}

console.log('\n[10] 任务7：marker 无效/空内容 → fallback，不丢记忆')
{
  // extractMemories 过滤空 marker；直接传空 markers 数组模拟
  const plans = planMemoryWrites([cand], [], userText)
  eq(plans.length, 1, '无有效 marker → fallback 1 条')
  ok(isExplicit(plans[0]), 'fallback explicit=true')
  // 全空输入
  eq(planMemoryWrites([], [], '').length, 0, '全空 → 0 条')
}

console.log('\n[11] 任务8/9：中英文 marker 解析（extractMemories 保持）')
{
  const zh = extractMemories('正文第一句\n【记忆·饮食】TA 喜欢吃话梅味的排骨\n再见')
  eq(zh.length, 1, '中文 marker 提取 1 条')
  eq(zh[0].topic, '饮食', '中文 topic')
  eq(zh[0].text, 'TA 喜欢吃话梅味的排骨', '中文 text')
  const en = extractMemories('line one\n[Memory: Food] They like plum-flavored ribs')
  eq(en.length, 1, '英文 marker 提取 1 条')
  eq(en[0].topic, 'Food', '英文 topic')
  eq(en[0].text, 'They like plum-flavored ribs', '英文 text')
}

console.log('\n[12] 任务10：同轮不产生“原话 + 提炼”两条同义 Memory')
{
  // marker 匹配候选 → 只出提炼版一条
  const matched = planMemoryWrites([cand], extractMemories('【记忆·饮食】TA 喜欢吃话梅味的排骨'), userText)
  eq(matched.length, 1, '匹配场景仅 1 条')
  // 计划内任意两条不得高度相似（同义并存即失败）
  const mixed = planMemoryWrites(
    [{ text: '我养了一只猫', source: '我养了一只猫', topic: '宠物' }],
    extractMemories('【记忆·宠物】对方养了一只猫\n【记忆·工作】对方在互联网公司上班'),
    '我养了一只猫',
  )
  let dup = false
  for (let i = 0; i < mixed.length; i++) {
    for (let j = i + 1; j < mixed.length; j++) {
      if (isSimilarMemory([{ id: 'x', text: mixed[i].text }], mixed[j].text)) dup = true
    }
  }
  ok(!dup, '计划内无两条相似记忆（未匹配的不同事实允许并存）')
}

console.log('\n[13] 任务11：跨轮去重机制不受影响（isSimilarMemory 原语义）')
{
  const items = [{ id: '1', text: 'TA 喜欢吃话梅味的排骨' }]
  ok(isSimilarMemory(items, 'TA 喜欢吃话梅味的排骨'), '完全相同的判重')
  ok(isSimilarMemory(items, '对方喜欢吃话梅味的排骨'), '视角转换后判重')
  ok(!isSimilarMemory(items, 'TA 喜欢打篮球'), '不同事实不判重')
}

console.log('\n[14] 任务15：source 必须是真实用户内容，不得来自模型')
{
  // 无论 marker 匹配与否，source 只来自 candidates.source / fallbackSource（用户输入），绝不来自 marker.text
  const s1 = planMemoryWrites([cand], extractMemories('【记忆·饮食】TA 喜欢吃话梅味的排骨'), userText)
  ok(s1[0].source === userText, '匹配条 source = 用户原话')
  const s2 = planMemoryWrites([], extractMemories('【记忆】TA 推测周末会下雨'), '用户原话A')
  ok(s2[0].source === '用户原话A', '纯 marker 条 source = 用户消息')
  const s3 = planMemoryWrites([cand], [], userText)
  ok(s3[0].source === userText, 'fallback 条 source = 用户原话')
}

console.log('\n[15] 任务16：Memory marker 仍从用户可见正文正确剥离（stripMemoryMarkers 不受影响）')
{
  const stripped = stripMemoryMarkers('正文\n【记忆·饮食】TA 喜欢吃话梅味的排骨\n[Memory: Food] x\n结尾')
  ok(!stripped.includes('【记忆'), '中文 marker 已剥离')
  ok(!stripped.includes('[Memory'), '英文 marker 已剥离')
  ok(stripped.includes('正文') && stripped.includes('结尾'), '正文保留')
}

console.log('\n[16] 多候选部分匹配：匹配的走提炼版、未匹配的 fallback explicit')
{
  const cA = { text: '我养了一只猫', source: '我养了一只猫', topic: '宠物' }
  const cB = { text: '我每天八点上班', source: '我每天八点上班', topic: '工作' }
  const plans = planMemoryWrites([cA, cB], extractMemories('【记忆·宠物】对方养了一只猫'), '我养了一只猫')
  eq(plans.length, 2, '2 条：1 提炼 explicit + 1 fallback explicit')
  const ta = plans.find((p) => p.text.includes('养了一只猫'))
  const sched = plans.find((p) => p.text.includes('八点'))
  ok(ta && isExplicit(ta) && ta.text === '对方养了一只猫', '匹配候选 = 提炼版 explicit')
  ok(sched && isExplicit(sched) && sched.text === '我每天八点上班', '未匹配候选 = fallback explicit')
}

console.log('\n[17] V1.1：instruction 候选前导标点清洗（detectMemoryInstruction）')
{
  eq(detectMemoryInstruction('记住，我不喜欢别人替我做决定。').fact, '我不喜欢别人替我做决定。', '“记住，”前导逗号被清')
  eq(detectMemoryInstruction('帮我记一下，我生日是8月5号。').fact, '我生日是8月5号。', '“帮我记一下，”前导逗号被清')
  eq(detectMemoryInstruction('记住 明天八点上班').fact, '明天八点上班', '前导空格被清')
  eq(detectMemoryInstruction('帮我记一下我早班7:50-15:50上班').fact, '我早班7:50-15:50上班', '无标点原样保留')
  eq(detectMemoryInstruction('今天天气不错').fact, null, '非指令 → fact null')
}

console.log('\n[18] V1.1：candidate + 无关 marker → 2 条（candidate explicit + marker inferred）')
{
  const plans = planMemoryWrites([cand], extractMemories('【记忆·日子】TA 觉得今天天气不错'), userText)
  eq(plans.length, 2, 'candidate + 无关 marker → 2 条')
  const exp = plans.find(isExplicit)
  const inf = plans.find(isInferred)
  ok(!!exp && exp.text === cand.text, 'candidate 以 explicit 写入，text=用户事实')
  ok(!!inf && inf.text === 'TA 觉得今天天气不错', '无关 marker 保持 inferred 写入')
  ok(!!exp && exp.source === userText, 'candidate source=用户原话')
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
