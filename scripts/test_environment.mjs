import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateEnvironment as environment, weatherEffects } from '../src/lib/environment.ts'

// Independent reference: NOAA Julian-century equations (geometric elevation, no refraction).
const references = [
  ['2026-06-21T04:00:00Z', 39.9042, 116.4074, 'Asia/Shanghai', 73.1855274994],
  ['2026-12-21T04:00:00Z', 39.9042, 116.4074, 'Asia/Shanghai', 26.5951214638],
  ['2026-03-20T12:00:00Z', 51.5074, -0.1278, 'Europe/London', 38.4219537988],
  ['2026-06-21T16:00:00Z', 40.7128, -74.006, 'America/New_York', 68.8797641312],
  ['2026-12-21T01:00:00Z', -33.8688, 151.2093, 'Australia/Sydney', 74.4027021761],
]
for (const [time, latitude, longitude, timezone, reference] of references) {
  test(`solar altitude within one degree: ${timezone} ${time}`, () => {
    const result = environment({ utcTimestamp: Date.parse(time), latitude, longitude, timezone })
    assert.ok(Math.abs(result.solarAltitude - reference) <= 1, `${result.solarAltitude} versus ${reference}`)
  })
}
const beijing = { latitude: 39.9042, longitude: 116.4074, timezone: 'Asia/Shanghai' }
test('sunrise east, sunset west, night has no direct light', () => {
  const rising = environment({ ...beijing, utcTimestamp: Date.parse('2026-06-20T20:50:00Z') })
  const setting = environment({ ...beijing, utcTimestamp: Date.parse('2026-06-21T11:30:00Z') })
  assert.ok(rising.solarAzimuth > 45 && rising.solarAzimuth < 90)
  assert.ok(setting.solarAzimuth > 270 && setting.solarAzimuth < 315)
  for (const time of ['2026-06-20T19:00:00Z', '2026-06-21T14:00:00Z']) {
    assert.equal(environment({ ...beijing, utcTimestamp: Date.parse(time) }).directIntensity, 0)
  }
})
test('clouds reduce direct and increase diffuse; back-facing window has no direct', () => {
  const input = { ...beijing, utcTimestamp: Date.parse('2026-06-21T04:00:00Z') }
  const clear = environment({ ...input, cloudcover: 0 })
  const cloud = environment({ ...input, cloudcover: 100 })
  assert.ok(clear.directIntensity > cloud.directIntensity)
  assert.ok(clear.diffuseIntensity < cloud.diffuseIntensity)
  assert.equal(environment({ ...input, windowAzimuth: 0 }).directIntensity, 0)
})
test('city timezone, including DST, is independent from device zone', () => {
  const input = { utcTimestamp: Date.parse('2026-07-01T16:00:00Z'), latitude: 40.7, longitude: -74, timezone: 'America/New_York' }
  const previous = process.env.TZ
  process.env.TZ = 'Pacific/Honolulu'
  const a = environment(input)
  process.env.TZ = 'Asia/Tokyo'
  assert.deepEqual(environment(input), a)
  if (previous === undefined) delete process.env.TZ
  else process.env.TZ = previous
  assert.throws(() => environment({ ...input, timezone: '' }))
  assert.equal(weatherEffects(99).lightning, 3)
  assert.equal(weatherEffects(75).snow, 3)
})
