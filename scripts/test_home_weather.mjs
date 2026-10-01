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
  assert.match(home, /填写城市即可开启当地天气，不会读取定位。天气由 Open-Meteo 提供；开启后，城市和天气也会发送给你选择的模型，让 TA 知道你这边的天气。/)
  assert.doesNotMatch(home, /城市会同步到「关于我」/)
  assert.match(home, /发送给你选择的模型/)
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

test('weather data module stays independent from TA runtime and chat implementation', () => {
  assert.doesNotMatch(weather, /from ['"].*(?:taRuntime|memory|eventDetector|Chat)/i)
  assert.doesNotMatch(weather, /getOrAdvanceTaRuntime|upsertMemory|processEventCandidate/)
})


test('user profile city has its own Cloud State entity', () => {
  const cloud = fs.readFileSync(new URL('../src/lib/cloudStateResources.ts', import.meta.url), 'utf8')
  assert.match(cloud, /queue\('user_profile', USER_PROFILE_ENTITY, value\)/)
  assert.match(cloud, /registerCloudStateAdapter\('user_profile'/)
  assert.match(cloud, /addEventListener\(ELUVIN_DATA_CHANGE, captureUserProfile\)/)
  assert.match(cloud, /city: profile\.city\?\.trim\(\) \?\? ''/)
})


test('home modal sheets hide the floating bottom navigation', () => {
  const css = fs.readFileSync(new URL('../src/styles/home.css', import.meta.url), 'utf8')
  assert.match(css, /\.app:has\(\.home-page \.home-inbox-mask\) \.app-nav/)
  assert.match(css, /\.app:has\(\.home-page \.home-time-mask\) \.app-nav/)
  assert.match(css, /visibility:\s*hidden/)
  assert.match(css, /\.home-weather-setup-sheet[\s\S]*max-height:\s*calc\(100dvh - 32px\)/)
})


test('rain effect uses deterministic layered streaks instead of one repeating stripe texture', () => {
  const css = fs.readFileSync(new URL('../src/styles/home.css', import.meta.url), 'utf8')
  assert.match(scene, /const RAIN_DROP_COUNT = 24/)
  assert.match(scene, /home-weather-rain-drop layer-\$\{index % 3\}/)
  assert.match(scene, /rainDropStyle\(index\)/)
  assert.doesNotMatch(scene, /Math\.random\(\)/)
  assert.match(css, /\.home-weather-rain-drop[\s\S]*width:\s*1px/)
  assert.match(css, /--rain-near-duration/)
  assert.match(css, /--rain-mid-duration/)
  assert.match(css, /--rain-far-duration/)
  assert.match(css, /@keyframes home-weather-rain-drop/)
  assert.doesNotMatch(css, /repeating-linear-gradient\(105deg, transparent 0 18px/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.home-weather-atmosphere/)
})
