/**
 * 本机已锁的性别要反向补种回云端（2026-10-09）
 *
 * 病根：同步只上传「变更事件」，用户在这条链上线之前设好的值永远传不上去。
 * 于是云端一直留着旧值（她实测：饺子在测试站显示成女的）。
 * 规则：本机已锁 + 云端值不同 → 把本机值写回「云端那一行的 entityId」，不是写 GLOBAL 常量。
 */
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../src/lib/cloudStateResources.ts', import.meta.url), 'utf8')
const fn = src.slice(src.indexOf('function applyGenderEntity'))
const body = fn.slice(0, fn.indexOf('\n}\n'))

let ok = true
const check = (name, cond) => { if (!cond) { console.error('✖ ' + name); ok = false } }

check('applyGenderEntity 存在', body.length > 0)
check('本机已锁且与云端不同时触发反向补种',
  /local\.locked && local\.g !== gender/.test(body))
check('补种写回 cloud entity.entityId（不是 GLOBAL 常量）',
  /queue\('gender', entity\.entityId, \{ g: local\.g, locked: true \}\)/.test(body))
check('补种后直接 return，不继续走「本机已锁一律不动」那条',
  body.indexOf("queue('gender', entity.entityId") < body.indexOf('if (local && (local.locked || !cloudLocked)) return'))
check('原「只增不改」规则仍在（本机没记录 / 本机未锁云端已锁 → 才写）',
  /if \(local && \(local\.locked \|\| !cloudLocked\)\) return/.test(body))

if (!ok) process.exit(1)
console.log('gender backfill: 5/5 通过')
