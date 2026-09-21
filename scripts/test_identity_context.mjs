// IDENTITY-CTX 单测：资料页的「性别 / 备注」必须进聊天、周记、TA 空间的提示词
// 起因：用户设了性别=女，聊天里 TA 答「我是男生啊」——性别从来没进提示词
// 运行：node scripts/test_identity_context.mjs
import { readFileSync } from 'node:fs'

// localStorage shim（Node 里跑 storage 层）
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size },
}

const { buildIdentityContext, hasIdentityContext } = await import('../src/lib/identityContext.ts')
const { saveAIGender, saveAIRemark } = await import('../src/lib/storage.ts')
const { buildLlmMessages, buildReplyMessages } = await import('../src/lib/aiSpaceLlm.ts')

let pass = 0, fail = 0
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  ✗ ' + msg) } }
function okNot(cond, msg) { ok(!cond, msg) }

const SID = 'idt-24'

// 1. 没设性别、没备注 → 一个字都不加（不硬塞）
ok(buildIdentityContext(SID, 'zh') === '', '未设性别/备注 → 空串')
ok(hasIdentityContext(SID) === false, '未设 → hasIdentityContext false')

// 2. 女 → 约束自称与语气，禁止男性自称
saveAIGender('female', SID)
let ctx = buildIdentityContext(SID, 'zh')
ok(ctx.includes('你是女生'), '女：写明你是女生')
ok(ctx.includes('不要用男性式'), '女：禁止男性式自称')
ok(ctx.includes('不要用油腻的搭话腔'), '女：禁止油腻腔')
okNot(ctx.includes('你是男生'), '女：不出现「你是男生」')

// 3. 男 → 反向约束
saveAIGender('male', SID)
ctx = buildIdentityContext(SID, 'zh')
ok(ctx.includes('你是男生') && ctx.includes('不要用女生式') && ctx.includes('油腻'), '男：明确性别 + 禁止女生式自称')

// 4. 备注 = 你给 TA 记的关于 TA 的事（不是"它怎么叫你"）
saveAIGender('female', SID)
saveAIRemark('她喜欢被叫阿阳；我们说好每周日通一次电话', SID)
ctx = buildIdentityContext(SID, 'zh')
ok(ctx.includes('关于你自己') && ctx.includes('喜欢被叫阿阳'), '备注：作为关于 TA 自己的事实注入')
ok(ctx.includes('不是让你拿它去称呼 USER'), '备注：明确不是让它拿这个称呼去叫对方')

// 5. 会话隔离：别的会话不串
ok(buildIdentityContext('idt-other', 'zh') === '', '会话隔离：其他会话不受影响')

// 6. 英文档
const enCtx = buildIdentityContext(SID, 'en')
ok(enCtx.includes('You are female') && enCtx.includes('About you'), 'en：性别 + 备注都在')

// 7. 三个入口都接上了（静态断言）
const chat = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const weekly = readFileSync(new URL('../src/lib/weeklyReview.ts', import.meta.url), 'utf8')
const space = readFileSync(new URL('../src/lib/aiSpaceLlm.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/components/WeeklyPage.tsx', import.meta.url), 'utf8')
const spaceCaller = readFileSync(new URL('../src/lib/aiSpace.ts', import.meta.url), 'utf8')
ok(chat.includes('buildIdentityContext(activeSessionId'), '聊天：注入身份块')
ok(weekly.includes('buildIdentityContext(ctx.sessionId'), '周记：注入身份块')
ok(page.includes('sessionId: currentSid'), '周记：调用方传 sessionId')
ok(space.includes('idSuffix(ctx.sessionId'), 'TA 空间：动态/评论都追加身份块')
ok(spaceCaller.includes('sessionId,'), 'TA 空间：调用方传 sessionId')

// 8. 真的进到 prompt 里（跑构建函数）
const messages = buildLlmMessages({
  taName: '阳阳', yourName: '七七', persona: '你性格阳光鲜活。', season: '秋天', timeWord: '晚上',
  weatherWord: '晴', recent: [], sessionId: SID,
})
const sys = messages.find((m) => m.role === 'system')?.content ?? ''
ok(sys.includes('你是女生') && sys.includes('喜欢被叫阿阳'), 'TA 空间动态 system 里带性别 + 备注')
const reply = buildReplyMessages({
  taName: '阳阳', yourName: '七七', persona: '你性格阳光鲜活。', postText: '今天天气不错。',
  commentText: '嗯嗯', sessionId: SID,
})
ok((reply.find((m) => m.role === 'system')?.content ?? '').includes('你是女生'), 'TA 空间评论回复 system 里带性别')
const noId = buildReplyMessages({
  taName: '阳阳', yourName: '七七', persona: '你性格阳光鲜活。', postText: '今天天气不错。', commentText: '嗯嗯',
})
okNot((noId.find((m) => m.role === 'system')?.content ?? '').includes('【你的性别】'), '没传 sessionId → 不硬塞身份块')

console.log(`结果：${pass} 通过，${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
