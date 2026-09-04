// 思考链剥离 · 纯函数自测（2026-09-05 乔补——豆包未写单测导致 <think> 标签被剥成空坏了一整周无人发现）
// 覆盖：闭合块提取/剥离 / 无闭合保护中文正文 / 纯思考过滤 / 正常文本不动
import { extractThinkBlocks, isPureThinkBlock, stripThinkBlocks } from '../src/lib/memory.ts'
let passed = 0
let failed = 0
function ok(cond, name) {
  if (cond) { passed++ } else { failed++; console.log('❌', name) }
}

// 1. 闭合块：提取思考、剥离留正文
const c1 = '<think>结合人设：好梦。乖乖睡吧。【检查规则】\n</think>乖，闭上眼睛吧。好梦。'
ok(extractThinkBlocks(c1).includes('结合人设'), '闭合块 extract 提取思考内容')
ok(extractThinkBlocks(c1).includes('好梦'), '闭合块 extract 内容完整')
ok(!extractThinkBlocks(c1).includes('<'), 'extract 不含标签')
ok(stripThinkBlocks(c1) === '乖，闭上眼睛吧。好梦。', '闭合块 strip 留正文')
ok(stripThinkBlocks(c1).includes('乖，闭上眼睛吧'), '闭合块正文保留')

// 2. 无闭合 + 英文思考 + 中文正文：只删思考，保护正文
const c2 = '<think>English reasoning without any closing tag here 然后接中文正文在'
ok(stripThinkBlocks(c2).startsWith('然后接中文正文'), '无闭合 strip 删英文思考保中文正文')
ok(extractThinkBlocks(c2).length > 0, '无闭合 extract 有内容')

// 3. 无闭合 + 无中文（整条思考）：删到结尾
const c3 = '<think>pure english chain only no content after'
ok(stripThinkBlocks(c3) === '', '无中文纯思考 strip 为空')

// 4. 整条就是 <think> 标记
ok(stripThinkBlocks('<think>') === '', '纯标记 strip 为空')

// 5. 正常文本不动
const c5 = '刚把合同看完，正想你呢。这么晚还不睡？'
ok(stripThinkBlocks(c5) === c5, '正常文本不动')
ok(extractThinkBlocks(c5) === '', '正常文本无思考')
ok(!isPureThinkBlock(c5), '正常文本非纯思考')

// 6. isPureThinkBlock：<think> 开头 & 英文推理开头
ok(isPureThinkBlock('<think>'), '<think> 开头判纯思考')
ok(isPureThinkBlock('<think>something'), '<think>+内容判纯思考')
ok(isPureThinkBlock('Interpreting the Input I am analyzing...'), '英文推理开头判纯思考')
ok(!isPureThinkBlock('正文而已'), '中文正文非纯思考')

// 7. 多行闭合 + 正文在同串
const c7 = '<think>line1\nline2 推理\n</think>这是正文。'
ok(stripThinkBlocks(c7) === '这是正文。', '多行闭合剥离')
ok(extractThinkBlocks(c7).includes('line1'), '多行 extract')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
