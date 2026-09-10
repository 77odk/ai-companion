// 构建后体积报告（2026-09-11 收尾批：去掉 javascript-obfuscator 混淆）
// 之前混淆让 index JS 403KB → 973KB（2.4x），手机上解析明显拖慢。
// 现在产物 = vite 自带 minify（esbuild），不再做二次混淆；这里只打印各 JS 产物字节数，方便以后盯体积回归。
const { readdirSync, statSync } = require('fs')
const { join } = require('path')

const dir = join(process.cwd(), 'dist', 'assets')
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.js')) continue
  const size = statSync(join(dir, f)).size
  console.log(`asset ${f}: ${size} bytes (${(size / 1024).toFixed(1)} KB)`)
}
console.log('build done ✅')
