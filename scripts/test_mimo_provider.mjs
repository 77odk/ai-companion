import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, COMMON_MODELS, PROVIDER_NAMES } from '../src/lib/storage.ts'
import { thinkingRequestOpts } from '../src/lib/modelChat.ts'

assert.equal(DEFAULT_SETTINGS.mimo.baseUrl, 'https://api.xiaomimimo.com/v1')
assert.equal(DEFAULT_SETTINGS.mimo.model, 'mimo-v2.6-pro')
assert.equal(PROVIDER_NAMES.mimo, '小米 MiMo')
assert.deepEqual(COMMON_MODELS.mimo, ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed', 'mimo-v2.5-pro', 'mimo-v2.5'])
const settings = { provider: 'mimo', apiKey: 'test', ...DEFAULT_SETTINGS.mimo }
assert.deepEqual(thinkingRequestOpts(settings), { thinking: { type: 'enabled' } })
assert.equal(thinkingRequestOpts(settings, false), undefined)
console.log('MiMo provider contract: ok')
