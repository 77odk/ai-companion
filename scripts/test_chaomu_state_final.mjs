import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const state = fs.readFileSync(new URL('../src/lib/taState.ts', import.meta.url), 'utf8')
const panel = fs.readFileSync(new URL('../src/components/ChaomuStatePanel.tsx', import.meta.url), 'utf8')
const memory = fs.readFileSync(new URL('../src/components/Memory.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/styles/space.css', import.meta.url), 'utf8')

test('Chaomu score is derived from the two axes and energy', () => {
  assert.match(state, /quietActive \* 22/)
  assert.match(state, /relaxedTense \* 12/)
  assert.match(state, /tendencies\.energy/)
  assert.match(state, /getTaStateDetailView/)
})

test('Chaomu detail exposes nine real state curves', () => {
  for (const key of ['connection','expression','exploration','involvement','reminiscence','space','energy']) {
    assert.match(panel, new RegExp(key))
  }
  assert.match(panel, /relaxedTense/)
  assert.match(panel, /quietActive/)
  assert.match(memory, /<ChaomuStatePanel sessionId=\{sessionId\} \/>/)
})

test('Chaomu logs use recorded reasons and only pulse line runs continuously', () => {
  assert.match(panel, /item\.reason\.text/)
  assert.match(state, /history\?: TaStateSnapshot\[\]/)
  assert.match(css, /\.chaomu-pulse-line[\s\S]*animation: chaomu-pulse-run/)
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.chaomu-pulse-line \{ animation: none !important; \}/)
  assert.doesNotMatch(css, /\.chaomu-state-curve polyline[^}]*animation:/)
})
