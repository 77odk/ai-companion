import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const weather = fs.readFileSync(new URL('../src/lib/homeWeather.ts', import.meta.url), 'utf8')
const home = fs.readFileSync(new URL('../src/components/Home.tsx', import.meta.url), 'utf8')
const scene = fs.readFileSync(new URL('../src/components/HomeScene.tsx', import.meta.url), 'utf8')
const settings = fs.readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8')

test('home weather uses manual profile city and keyless Open-Meteo endpoints', () => {
  assert.match(home, /loadUserProfile\(\)\.city/)
  assert.match(weather, /geocoding-api\.open-meteo\.com/)
  assert.match(weather, /api\.open-meteo\.com/)
  assert.doesNotMatch(weather, /navigator\.geolocation/)
  assert.doesNotMatch(weather, /apiKey|api_key/)
  assert.match(weather, /!isHomeWeatherEnabled\(\)/)
  assert.match(home, /保存并开启天气/)
  assert.match(home, /saveUserProfile\(\{ \.\.\.profile, city \}\)/)
})

test('weather cache is thirty minutes and failures fall back silently', () => {
  assert.match(weather, /30 \* 60 \* 1000/)
  assert.match(weather, /catch \{\s*return cached\s*\}/)
})

test('non-clear scene requires overcast art and falls back without atmosphere', () => {
  assert.match(scene, /-overcast\.webp/)
  assert.match(scene, /setOvercastReady\(false\)/)
  assert.match(scene, /weather\.visual === 'clear' \|\| overcastReady/)
  assert.match(scene, /home-weather-state-\$\{weather\.visual\}/)
  assert.match(scene, /home-weather-fx-cloud/)
  assert.doesNotMatch(scene, /className="home-weather-cloud/)
})

test('home refresh shortcut is replaced by notifications while settings keeps update controls', () => {
  assert.doesNotMatch(home, /检查页面更新/)
  assert.match(home, /消息与通知/)
  assert.match(settings, /label="消息与通知"/)
  assert.match(settings, /<UpdateControls \/>/)
})

test('weather stays out of TA runtime', () => {
  assert.doesNotMatch(weather, /taRuntime|memory|eventDetector|chat/i)
})


test('user profile city has its own Cloud State entity', () => {
  const cloud = fs.readFileSync(new URL('../src/lib/cloudStateResources.ts', import.meta.url), 'utf8')
  assert.match(cloud, /queue\('user_profile', USER_PROFILE_ENTITY, value\)/)
  assert.match(cloud, /registerCloudStateAdapter\('user_profile'/)
  assert.match(cloud, /addEventListener\(ELUVIN_DATA_CHANGE, captureUserProfile\)/)
  assert.match(cloud, /city: profile\.city\?\.trim\(\) \?\? ''/)
})
