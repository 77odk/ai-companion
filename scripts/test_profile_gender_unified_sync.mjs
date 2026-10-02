import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('src/lib/cloudStateResources.ts', 'utf8')

assert.match(source, /collectAllGenders/)
assert.match(source, /gender\?: AIGender/)
assert.match(source, /const genders = collectAllGenders\(\)/)
assert.match(source, /gender === 'male' \|\| gender === 'female'/)
assert.match(source, /localStorage\.setItem\(genderStorageKey\(entity\.entityId\), JSON\.stringify\(\{ g: merged\.gender, locked: true \}\)\)/)
assert.match(source, /registerCloudStateAdapter\('gender'/, 'legacy gender adapter must remain for backwards compatibility')

console.log('profile gender unified sync contract: ok')
