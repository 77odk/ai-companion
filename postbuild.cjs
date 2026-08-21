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
    controlFlowFlattening: false,
    deadCodeInjection: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: false,
    stringArray: true,
    stringArrayThreshold: 0.5,
    splitStrings: false,
  }).getObfuscatedCode()
  writeFileSync(path, out)
  console.log(`obfuscated ${f}: ${code.length} -> ${out.length} chars`)
}
console.log('混淆完成 ✅')
