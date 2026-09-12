// Chat 英文回复安全拆段回归测试（TASK-CHAT-SPLIT）
// 覆盖：英文单词/缩写/所有格不被从中间切开、英文句号断句、中文自然拆段保持、内容完整性。
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖构建工具。
// 跑法：node scripts/test_chat_split.mjs（npm test 会自动纳入 scripts/test_*.mjs）

import { splitAssistantReplies } from '../src/lib/sessionStore.ts'

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

const cut = (text, ts = 1) => splitAssistantReplies(text, ts).map((m) => m.content)
const seq = (s) => String(s ?? '').replace(/\s+/g, '')

/** 内容完整性：拆分后再拼接，非空白内容必须与原文完全一致（允许边界空白按 trim 语义处理） */
function checkIntegrity(text, chunks, name) {
  ok(seq(chunks.join('')) === seq(text), `${name}：拆分前后非空白内容一致（无丢失/重复/重排）`)
}

/** 切词检测：相邻两块边界处，原文对应位置必须是空白或标点（不允许单词/缩写/所有格被劈开） */
function checkNoWordCut(text, chunks, name) {
  // 逐块在原文中定位（递增查找），检查每块结束位置的下一个字符
  let pos = 0
  let bad = false
  for (const c of chunks) {
    const idx = text.indexOf(c, pos)
    if (idx < 0) {
      bad = true
      break
    }
    pos = idx + c.length
    if (pos < text.length) {
      const prev = text[pos - 1]
      const next = text[pos]
      const isWordChar = (ch) => /\w/.test(ch) || /[\u4e00-\u9fff]/.test(ch)
      if (isWordChar(prev) && isWordChar(next)) {
        bad = true
        break
      }
    }
  }
  ok(!bad, `${name}：无单词/缩写/所有格被从中间切开`)
}

console.log('\n[1] 英文单词跨 60 边界不切（this）')
{
  const text = 'x '.repeat(28) + 'this is fine, really fine'
  const chunks = cut(text)
  eq(chunks, ['x x x x x x x x x x x x x x x x x x x x x x x x x x x x', 'this is fine, really fine'], 'this 完整进入下一块（无 th|is）')
  checkIntegrity(text, chunks, 'this')
  checkNoWordCut(text, chunks, 'this')
}

console.log('\n[2] afternoon 跨 60 边界不切')
{
  const text = "The air's getting colder and the wind is picking up this afternoon, so please bring a jacket when you go out to the market later"
  const chunks = cut(text)
  ok(!chunks.some((c) => /aft$/.test(c) && chunks.some((d) => /^ernoon/.test(d))), 'afternoon 未被切成 aft|ernoon')
  ok(chunks.join(' ').includes('afternoon'), 'afternoon 完整存在')
  checkIntegrity(text, chunks, 'afternoon')
  checkNoWordCut(text, chunks, 'afternoon')
}

console.log('\n[3] air\'s 不切')
{
  const text = "x ".repeat(28) + "air's getting cold"
  const chunks = cut(text)
  ok(!chunks.some((c) => /air$/.test(c) && chunks.some((d) => /^'s/.test(d))), "air's 未被切成 air|'s")
  checkIntegrity(text, chunks, "air's")
  checkNoWordCut(text, chunks, "air's")
}

console.log("\n[4] don't 不切")
{
  const text = "x ".repeat(28) + "don't worry at all"
  const chunks = cut(text)
  ok(!chunks.some((c) => /don$/.test(c) && chunks.some((d) => /^'t/.test(d))), "don't 未被切成 don|'t")
  checkIntegrity(text, chunks, "don't")
  checkNoWordCut(text, chunks, "don't")
}

console.log("\n[5] I'm 不切")
{
  const text = "x ".repeat(28) + "I'm really tired now"
  const chunks = cut(text)
  ok(!chunks.some((c) => /I$/.test(c) && chunks.some((d) => /^'m/.test(d))), "I'm 未被切成 I|'m")
  checkIntegrity(text, chunks, "I'm")
  checkNoWordCut(text, chunks, "I'm")
}

console.log('\n[6] 英文多个完整句子（半角句点 . 断句）')
{
  const chunks = cut('I said this and then she left. That was it. Really.')
  eq(chunks, ['I said this and then she left.', 'That was it.', 'Really.'], '按 . 断成 3 句')
  checkIntegrity('I said this and then she left. That was it. Really.', chunks, '英文多句')
}

console.log('\n[7] 问号 / 感叹号断句')
{
  const chunks = cut('Really? You sure! Wait.')
  eq(chunks, ['Really?', 'You sure!', 'Wait.'], '按 ?! 断句')
  checkIntegrity('Really? You sure! Wait.', chunks, '问叹句')
}

console.log('\n[8] 中文长回复自然拆段')
{
  const text = '今天工作很累，晚上回家吃了饭，然后看了会儿电视，感觉整个人都放松下来了，明天还要早起，得早点睡，不然白天没精神。'
  const chunks = cut(text)
  ok(chunks.length >= 1, '中文拆出 ≥1 条')
  checkIntegrity(text, chunks, '中文长回复')
  checkNoWordCut(text, chunks, '中文长回复')
  // 中文无标点超长也不硬切语义块（连续 token 保护同样适用）
  const zhNoPunct = '这'.repeat(80)
  const zc = cut(zhNoPunct)
  eq(zc, [zhNoPunct], '中文无标点连续文本不硬切')
}

console.log('\n[9] 中英混合')
{
  const text = '今天天气很好，I went for a walk this morning and enjoyed the sunshine, 晚上打算早点休息。'
  const chunks = cut(text)
  checkIntegrity(text, chunks, '中英混合')
  checkNoWordCut(text, chunks, '中英混合')
}

console.log('\n[10] 超过 60 字符且完全没有安全空格/标点的连续 token')
{
  const token = 'x'.repeat(80)
  eq(cut(token), [token], '连续 token 整条保留，不硬切')
}

console.log('\n[11] 拆分前后内容完整性（全用例已在各节断言，这里补换行保持）')
{
  // 换行优先语义保持：AI 像发微信一样分行 → 每行一条
  const text = '第一行。\n第二行！\n第三行'
  const chunks = cut(text)
  eq(chunks, ['第一行。', '第二行！', '第三行'], '换行优先：每行一条')
  checkIntegrity(text, chunks, '换行保持')
}

console.log('\n[12] 用户截图复测')
{
  const text1 = 'Went for a walk this morning and it was really nice out, the sun was warm and the air\'s getting fresher by the day'
  const c1 = cut(text1)
  ok(!c1.some((c) => /th$/.test(c) && c1.some((d) => /^is/.test(d))), '截图1：不出现 th|is')
  ok(!c1.some((c) => /air$/.test(c) && c1.some((d) => /^'s/.test(d))), '截图1：不出现 air|\'s')
  checkIntegrity(text1, c1, '截图1')
  checkNoWordCut(text1, c1, '截图1')

  const text2 = "The air's getting colder and the wind is picking up this afternoon"
  const c2 = cut(text2)
  ok(!c2.some((c) => /air$/.test(c) && c2.some((d) => /^'s/.test(d))), "截图2：不出现 air|'s")
  ok(!c2.some((c) => /th$/.test(c) && c2.some((d) => /^is/.test(d))), '截图2：不出现 th|is')
  checkIntegrity(text2, c2, '截图2')
  checkNoWordCut(text2, c2, '截图2')
}

console.log('\n[13] 小数/缩写保护：句点后非空白不断句')
{
  const chunks = cut("It's 3.5 miles away. Mr Smith left.")
  ok(chunks.some((c) => c.includes('3.5 miles')), '3.5 小数未被句点拆开')
  eq(chunks, ["It's 3.5 miles away.", 'Mr Smith left.'], '仅在句尾句点处断句')
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
