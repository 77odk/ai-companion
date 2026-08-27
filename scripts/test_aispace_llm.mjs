// TA 的空间 · LLM 路径纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_aispace_llm.mjs
// 覆盖：关键词猜 kind / LLM 返回清洗 / LLM 可用判断 / 提示词组装（含事件触发话题）/
//       LLM 动态构造 / 配图标记拆解 / 评论回复提示词 / 合并列表

import {
  cleanLlmText,
  guessKind,
  canUseLlm,
  buildLlmMessages,
  buildLlmPost,
  extractImageCaption,
  buildReplyMessages,
} from '../src/lib/aiSpaceLlm.ts'
import { mergeNewPosts, MAX_POSTS } from '../src/lib/aiSpaceCore.ts'

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

/** 可复现的伪随机，避免测试受 Math.random 影响 */
function seeded(seed = 42) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

console.log('\n[1] guessKind 关键词猜 kind')
eq(guessKind('今天有点想你'), '想你', '「想你」→ 想你')
eq(guessKind('想你了'), '想你', '「想」→ 想你')
eq(guessKind('忽然很怀念以前的日子'), '想你', '「念」→ 想你')
eq(guessKind('在整理一份表格'), '钻研', '表格/整理 → 钻研')
eq(guessKind('研究了半天代码'), '钻研', '代码 → 钻研')
eq(guessKind('窗外下雨了'), '天气', '雨 → 天气')
eq(guessKind('今天天气很好'), '天气', '天气 → 天气')
eq(guessKind('路过看到一只猫，好开心'), '小确幸', '猫/开心 → 小确幸')
eq(guessKind('刚出炉的面包真幸福'), '小确幸', '面包/幸福 → 小确幸')
eq(guessKind('有点难过，发了一会儿呆'), '心情', '难过/发呆 → 心情')
eq(guessKind('把房间打扫了一遍'), '日常', '无关键词 → 日常')
eq(guessKind(''), '日常', '空串 → 日常')

console.log('\n[2] cleanLlmText 清洗')
eq(cleanLlmText('  hello  '), 'hello', '去首尾空格')
eq(cleanLlmText('"今天天气很好"'), '今天天气很好', '去英文双引号')
eq(cleanLlmText('“今天天气很好”'), '今天天气很好', '去中文双引号')
eq(cleanLlmText('「今天天气很好」'), '今天天气很好', '去中文方引号')
eq(cleanLlmText("'今天天气很好'"), '今天天气很好', '去英文单引号')
eq(cleanLlmText('今天天气很好'), '今天天气很好', '无引号原样')
eq(cleanLlmText('  ""  '), null, '只剩引号 → null')
eq(cleanLlmText(''), null, '空串 → null')
eq(cleanLlmText('   '), null, '纯空格 → null')

console.log('\n[3] canUseLlm')
eq(canUseLlm('性格温柔', { apiKey: 'sk-1', baseUrl: 'https://x', model: 'm' }), true, '齐全 → true')
eq(canUseLlm('', { apiKey: 'sk-1', baseUrl: 'https://x', model: 'm' }), false, '没人设 → false')
eq(canUseLlm('   ', { apiKey: 'sk-1', baseUrl: 'https://x', model: 'm' }), false, '人设纯空格 → false')
eq(canUseLlm('性格温柔', { apiKey: '', baseUrl: 'https://x', model: 'm' }), false, '没 key → false')
eq(canUseLlm('性格温柔', { apiKey: 'sk-1', baseUrl: '  ', model: 'm' }), false, 'baseUrl 空白 → false')
eq(canUseLlm('性格温柔', { apiKey: 'sk-1', baseUrl: 'https://x', model: '' }), false, '没模型 → false')

console.log('\n[4] buildLlmMessages 提示词组装')
const msgs = buildLlmMessages({
  taName: '小忆',
  yourName: '阿明',
  persona: '你是只猫，爱晒太阳',
  season: '夏',
  timeWord: '午后',
  weatherWord: '晴',
  recent: ['今天吃了小鱼干', '窗台阳光很好'],
})
eq(msgs.length, 2, '两段消息：system + user')
eq(msgs[0].role, 'system', '首条是 system')
eq(msgs[1].role, 'user', '次条是 user')
ok(msgs[0].content.includes('小忆'), 'system 含 TA 昵称')
ok(msgs[0].content.includes('emoji'), 'system 禁止 emoji')
ok(msgs[1].content.includes('阿明'), 'user 含用户昵称')
ok(msgs[1].content.includes('夏'), 'user 含季节')
ok(msgs[1].content.includes('午后'), 'user 含时段')
ok(msgs[1].content.includes('晴'), 'user 含天气')
ok(msgs[1].content.includes('你是只猫，爱晒太阳'), 'user 含人设全文')
ok(msgs[1].content.includes('今天吃了小鱼干'), 'user 含最近动态')
ok(!msgs[0].content.includes('{') && !msgs[1].content.includes('{'), '提示词无残留占位符')

console.log('\n[4b] buildLlmMessages 事件触发话题（TASK_UI_BATCH2）')
const msgsWithTopics = buildLlmMessages({
  taName: '小忆',
  yourName: '阿明',
  persona: '你是只猫，爱晒太阳',
  season: '夏',
  timeWord: '午后',
  weatherWord: '晴',
  recent: [],
  chatTopics: ['火锅', '周末爬山'],
})
eq(msgsWithTopics.length, 2, '有话题时仍是两段消息')
ok(msgsWithTopics[1].content.includes('火锅'), 'user 含话题 1')
ok(msgsWithTopics[1].content.includes('周末爬山'), 'user 含话题 2')
ok(msgsWithTopics[1].content.includes('今天'), 'user 注入「今天」锚点让 TA 判断当天相关性')
ok(msgsWithTopics[1].content.includes('9月1号开学'), 'user 给出当天呼应的示例')

console.log('\n[5] extractImageCaption 配图标记拆解（TASK_UI_BATCH2）')
eq(extractImageCaption('今天路过花店，买了一把。\n[配图]一束粉色花束'), {
  text: '今天路过花店，买了一把。',
  caption: '一束粉色花束',
}, '拆出正文与配图描述')
eq(extractImageCaption('窗外在下雨。\n[配图] 雨滴打在窗玻璃上'), {
  text: '窗外在下雨。',
  caption: '雨滴打在窗玻璃上',
}, '支持 [配图] 后带空格')
eq(extractImageCaption('刚做好的早饭\n[配图]：一碗热粥'), {
  text: '刚做好的早饭',
  caption: '一碗热粥',
}, '支持 [配图]：中文冒号')
eq(extractImageCaption('正文\n[配图]  '), { text: '正文', caption: null }, '配图描述为空 → 正文保留、caption null')
eq(extractImageCaption('今天没有配图'), { text: '今天没有配图', caption: null }, '无标记 → 正文原样、caption null')
eq(extractImageCaption('正文\n[配图]一二三四五六七八九十甲乙丙丁子丑寅卯辰巳午未申酉'), {
  text: '正文',
  caption: '一二三四五六七八九十甲乙丙丁子丑寅卯辰巳…',
}, '配图描述超 20 字截断')
eq(extractImageCaption('正文 [配图]图片与正文同行'), {
  text: '正文',
  caption: '图片与正文同行',
}, '标记同行也拆干净')
ok(!/[\u{1F000}-\u{1FAFF}]/u.test(extractImageCaption('正文\n[配图]阳光下的沙滩🏖️').caption ?? ''), '配图描述里 emoji 被删')

console.log('\n[5b] buildLlmPost 构造动态')
const post = buildLlmPost('今天天气很好', 1700000000000, '天气', seeded(1))
eq(post.text, '今天天气很好', 'text 原样')
eq(post.at, 1700000000000, 'at 用给定时间戳')
eq(post.kind, '天气', 'kind 用给定值')
ok(typeof post.id === 'string' && post.id.length > 0, 'id 是合法字符串')
ok(Number.isFinite(post.art) && post.art >= 0 && post.art < 2, 'art 在合法范围')

console.log('\n[6] buildReplyMessages 评论回复提示词（TASK_UI_BATCH2）')
const replyMsgs = buildReplyMessages({
  taName: '小忆',
  yourName: '阿明',
  persona: '你是只猫，爱晒太阳',
  postText: '今天天气很好，出去走了走。',
  commentText: '去哪走了呀',
})
eq(replyMsgs.length, 2, '两段消息：system + user')
ok(replyMsgs[0].content.includes('小忆'), 'system 含 TA 昵称')
ok(replyMsgs[0].content.includes('回完就收住'), 'system 要求回完就收住')
ok(replyMsgs[1].content.includes('你是只猫，爱晒太阳'), 'user 含人设全文')
ok(replyMsgs[1].content.includes('今天天气很好，出去走了走。'), 'user 含动态原文')
ok(replyMsgs[1].content.includes('去哪走了呀'), 'user 含留言原文')
ok(!replyMsgs[0].content.includes('{') && !replyMsgs[1].content.includes('{'), '回复提示词无残留占位符')

console.log('\n[7] mergeNewPosts 合并列表')
const HOUR = 60 * 60 * 1000
const base = 2000000
const old = [
  { id: 'a', at: base, kind: '日常', text: 'A', art: 0 },
  { id: 'b', at: base - HOUR, kind: '日常', text: 'B', art: 0 },
]
const fresh = [
  { id: 'c', at: base + HOUR, kind: '日常', text: 'C', art: 0 },
  { id: 'd', at: base + 2 * HOUR, kind: '日常', text: 'D', art: 0 },
]
const merged = mergeNewPosts(old, fresh)
eq(merged.map((x) => x.text), ['D', 'C', 'A', 'B'], '合并后按时间倒序（新的在前）')

const many = []
for (let i = 0; i < MAX_POSTS + 5; i++) {
  many.push({ id: `m${i}`, at: base + i, kind: '日常', text: `M${i}`, art: 0 })
}
const capped = mergeNewPosts([], many)
eq(capped.length, MAX_POSTS, '合并后裁到上限 20 条')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
