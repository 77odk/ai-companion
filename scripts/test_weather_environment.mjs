import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHomeWeather } from '../src/lib/homeWeather.ts'

test('weather extension preserves old cache, consent and thirty-minute expiry', async () => {
  const oldStorage = globalThis.localStorage, oldFetch = globalThis.fetch
  const store = new Map()
  globalThis.localStorage = { getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) }
  let calls = 0
  const now = Date.parse('2026-06-21T04:00:00Z')
  globalThis.fetch = async url => {
    calls++
    if (String(url).includes('geocoding')) return { ok: true, json: async () => ({ results: [
      { name: '北京', latitude: 39.9, longitude: 116.4, timezone: 'Asia/Shanghai' },
    ] }) }
    const u = new URL(url)
    assert.equal(u.searchParams.get('timezone'), 'auto')
    assert.equal(u.searchParams.get('daily'), 'sunrise,sunset')
    assert.match(u.searchParams.get('current'), /cloud_cover,wind_speed_10m,is_day/)
    return { ok: true, json: async () => ({ timezone: 'Asia/Shanghai',
      current: { temperature_2m: 26, weather_code: 3, cloud_cover: 90, wind_speed_10m: 12, is_day: 1 },
      daily: { sunrise: ['2026-06-21T04:46'], sunset: ['2026-06-21T19:46'] },
    }) }
  }
  try {
    assert.equal(await loadHomeWeather('北京', now), null)
    assert.equal(calls, 0)
    store.set('eluvin_home_weather_consent_v1', 'yes')
    const old = { city: '北京', queryCity: '北京', temperature: 20, weatherCode: 0, fetchedAt: now }
    store.set('eluvin_home_weather_v1', JSON.stringify(old))
    const cached = await loadHomeWeather('北京', now + 29 * 60000)
    assert.equal(cached.temperature, 20)
    assert.equal(cached.timezone, undefined)
    assert.equal(calls, 0)
    const fresh = await loadHomeWeather('北京', now + 30 * 60000)
    assert.equal(calls, 2)
    assert.equal(fresh.cloudcover, 90)
    assert.equal(fresh.timezone, 'Asia/Shanghai')
    globalThis.fetch = async () => { throw new Error('offline') }
    assert.equal((await loadHomeWeather('北京', now + 60 * 60000)).cloudcover, 90)
  } finally { globalThis.localStorage = oldStorage; globalThis.fetch = oldFetch }
})
