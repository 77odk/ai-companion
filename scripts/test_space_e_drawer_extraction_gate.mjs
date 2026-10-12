import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const extractor = readFileSync('scripts/g0a_extract_e_drawer.py', 'utf8')
const view = readFileSync('src/components/AISpace.tsx', 'utf8')
const manifest = readFileSync('public/space/layered/manifest.json', 'utf8')
const gate = readFileSync('docs/space/G0A_E_drawer_visual_gate.md', 'utf8')

// An offline design experiment MUST NOT be silently activated in the product.
assert.match(extractor, /EXPECTED_SIZE = \(941, 1672\)/)
assert.match(extractor, /CROP = \(460, 1429, 941, 1672\)/)
assert.match(extractor, /raise FileExistsError/)
assert.match(extractor, /destination\.stat\(\)\.st_size > LIMIT_BYTES/)
assert.match(extractor, /300_000/)
assert.match(extractor, /artwork\.crop\(CROP\)/)
assert.match(extractor, /putalpha\(alpha\)/)
assert.match(extractor, /EXPERIMENT_ONLY/)
assert.doesNotMatch(extractor, /requests\.|urllib\.|https?:\/\//)
assert.doesNotMatch(view, /e_drawer_original|eluvin_E_drawer_original/)
assert.doesNotMatch(manifest, /e_drawer_original|eluvin_E_drawer_original/)
assert.match(gate, /NOT APPROVED/)
assert.match(view, /SPACE_DRAWER_OPEN_PERCENT/)
console.log('[G0-A E art] exact-source candidate pipeline remains isolated until visual QA: PASS')
