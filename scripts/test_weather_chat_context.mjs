// Weather -> Chat context contract: cached, consented, user-side only; no extra weather fetch from Chat.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const weather = fs.readFileSync(new URL('../src/lib/homeWeather.ts', import.meta.url), 'utf8')
const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/lib/useChatScroll.ts', import.meta.url), 'utf8')

const chatAll = chat + '\n' + fs.readFileSync(new URL('../src/lib/chatContextBuild.ts', import.meta.url), 'utf8')

assert.match(weather, /export function readUserWeatherContext/)
assert.match(weather, /!isHomeWeatherEnabled\(\)/)
assert.match(weather, /!isUserWeatherChatEnabled\(\)/)
assert.match(weather, /Date\.now\(\) - cached\.fetchedAt >= CACHE_MS/)
assert.match(weather, /const cached = readCache\(city\)/)
const reader = weather.slice(weather.indexOf('export function readUserWeatherContext'), weather.indexOf('export function buildUserWeatherContext'))
assert.doesNotMatch(reader, /fetch\(/)
assert.match(weather, /USER's local weather/)
assert.match(weather, /USER 所在地天气/)
assert.match(weather, /not your own location|不是你的所在地/)
assert.match(chatAll, /readUserWeatherContext\(loadUserProfile\(\)\.city \?\? ''\)/)
assert.match(chatAll, /id: 'user-weather'/)
assert.match(chatAll, /priority: 'ambient'/)
assert.doesNotMatch(chat, /loadHomeWeather\(/)

console.log('weather chat context: PASS')
