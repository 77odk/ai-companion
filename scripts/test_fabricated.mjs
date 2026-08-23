// 编造共同经历检测（2026-08-23）
// 跑法：node scripts/test_fabricated.mjs
import { looksFabricated } from '../src/lib/api.ts'

let passed = 0
let failed = 0

function hit(text, name) {
  if (looksFabricated(text)) passed++
  else {
    failed++
    console.error(`  ✗ ${name}：应命中但没命中\n    「${text}」`)
  }
}
function pass(text, name) {
  if (!looksFabricated(text)) passed++
  else {
    failed++
    console.error(`  ✗ ${name}：不应命中但命中了\n    「${text}」`)
  }
}

console.log('[1] 应命中（编造共同经历）')
hit('是我们俩都认识的人啊，怎么突然问这个？', '我们俩都认识')
hit('当然啊，我还跟她见过好几次呢', '我见过她好几次')
hit('咱们之前一起碰到的那个小鸭头', '咱们之前一起')
hit('上次我们一起去过那家店', '我们一起去过')
hit('你忘了吗，那天我们一起吃的饭', '你忘了吗 我们一起')
hit('还记得吗，我们之前约过那家餐厅', '还记得 我们约过')

console.log('[2] 不应命中（正常对话）')
pass('李贝贝是你老公，你之前告诉我的', '记忆事实')
pass('你是对方身边的那个人', '人设描述')
pass('今天上班好累，晚上好好歇着', '日常关心')
pass('你觉得我像吗？你说是就是呗', '反问')
pass('我认识很多人，李贝贝也在其中', '泛指认识')
pass('我们在聊天，你问我这个干嘛', '现在时')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
