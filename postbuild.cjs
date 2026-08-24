// 构建后混淆脚本：混淆 dist/assets 下的业务 JS，跳过 service worker
const { obfuscate } = require('javascript-obfuscator')
const { readdirSync, readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const dir = join(process.cwd(), 'dist', 'assets')
const skip = ['sw', 'workbox']  // SW 混淆会坏 PWA

for (const f of readdirSync(dir)) {
  if (!f.endsWith('.js')) continue
  if (skip.some(k => f.startsWith(k))) {
    console.log(`skip ${f} (service worker)`)
    continue
  }
  const path = join(dir, f)
  const code = readFileSync(path, 'utf8')
  const out = obfuscate(code, {
    compact: true,
    simplify: true,
    // 温和档：不开 controlFlowFlattening / selfDefending（那俩体积涨 20-30% 且拖慢首屏）
    // 只开死代码注入 + 字符串数组（不编码），体积增幅控制在 ~12% 以内
    controlFlowFlattening: false,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: false,
    stringArray: true,
    stringArrayThreshold: 0.8,
    splitStrings: false,
  }).getObfuscatedCode()
  writeFileSync(path, out)
  console.log(`obfuscated ${f}: ${code.length} -> ${out.length} chars`)
}
console.log('混淆完成 ✅')
