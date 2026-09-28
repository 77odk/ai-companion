export type WeatherVisual =
  | 'clear'
  | 'cloud'
  | 'overcast'
  | 'drizzle'
  | 'rain'
  | 'thunder'
  | 'snow'
  | 'fog'

export interface HomeWeather {
  city: string
  temperature: number
  weatherCode: number
  visual: WeatherVisual
  label: string
  fetchedAt: number
}

const CACHE_KEY = 'eluvin_home_weather_v1'
const CONSENT_KEY = 'eluvin_home_weather_consent_v1'
const CACHE_MS = 30 * 60 * 1000
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

type CachedWeather = HomeWeather & { queryCity: string }

function weatherMeta(code: number): Pick<HomeWeather, 'visual' | 'label'> {
  if (code === 0) return { visual: 'clear', label: '晴' }
  if (code === 1 || code === 2) return { visual: 'cloud', label: '多云' }
  if (code === 3) return { visual: 'overcast', label: '阴' }
  if (code === 45 || code === 48) return { visual: 'fog', label: '雾' }
  if (code >= 51 && code <= 57) return { visual: 'drizzle', label: '小雨' }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return { visual: code === 61 || code === 80 ? 'drizzle' : 'rain', label: code === 61 || code === 80 ? '小雨' : '雨' }
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { visual: 'snow', label: '雪' }
  if (code >= 95 && code <= 99) return { visual: 'thunder', label: '雷雨' }
  return { visual: 'cloud', label: '多云' }
}

function readCache(city: string): CachedWeather | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedWeather>
    if (
      parsed.queryCity !== city ||
      typeof parsed.city !== 'string' ||
      typeof parsed.temperature !== 'number' ||
      typeof parsed.weatherCode !== 'number' ||
      typeof parsed.fetchedAt !== 'number'
    ) return null
    const meta = weatherMeta(parsed.weatherCode)
    return { ...parsed, ...meta, queryCity: city } as CachedWeather
  } catch {
    return null
  }
}

function writeCache(value: CachedWeather): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)) } catch { /* weather must never block Home */ }
}


export function isHomeWeatherEnabled(): boolean {
  try { return localStorage.getItem(CONSENT_KEY) === 'yes' } catch { return false }
}

export function setHomeWeatherEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(CONSENT_KEY, 'yes')
    else localStorage.removeItem(CONSENT_KEY)
  } catch {
    // Consent persistence failure means the next request remains gated.
  }
}

export function weatherVisualForCode(code: number): WeatherVisual {
  return weatherMeta(code).visual
}

export async function loadHomeWeather(cityInput: string, now = Date.now()): Promise<HomeWeather | null> {
  const city = cityInput.trim()
  if (!city || !isHomeWeatherEnabled()) return null

  const cached = readCache(city)
  if (cached && now - cached.fetchedAt < CACHE_MS) return cached

  try {
    const geoUrl = new URL(GEOCODING_URL)
    geoUrl.searchParams.set('name', city)
    geoUrl.searchParams.set('count', '1')
    geoUrl.searchParams.set('language', 'zh')
    geoUrl.searchParams.set('format', 'json')
    const geoRes = await fetch(geoUrl)
    if (!geoRes.ok) throw new Error('geocoding failed')
    const geo = await geoRes.json() as {
      results?: Array<{ name?: string; latitude?: number; longitude?: number }>
    }
    const place = geo.results?.[0]
    if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) throw new Error('city not found')

    const weatherUrl = new URL(FORECAST_URL)
    weatherUrl.searchParams.set('latitude', String(place.latitude))
    weatherUrl.searchParams.set('longitude', String(place.longitude))
    weatherUrl.searchParams.set('current', 'temperature_2m,weather_code')
    weatherUrl.searchParams.set('timezone', 'auto')
    const weatherRes = await fetch(weatherUrl)
    if (!weatherRes.ok) throw new Error('weather failed')
    const data = await weatherRes.json() as { current?: { temperature_2m?: number; weather_code?: number } }
    const temperature = data.current?.temperature_2m
    const weatherCode = data.current?.weather_code
    if (!Number.isFinite(temperature) || !Number.isFinite(weatherCode)) throw new Error('weather malformed')

    const meta = weatherMeta(Number(weatherCode))
    const value: CachedWeather = {
      queryCity: city,
      city: place.name?.trim() || city,
      temperature: Number(temperature),
      weatherCode: Number(weatherCode),
      ...meta,
      fetchedAt: now,
    }
    writeCache(value)
    return value
  } catch {
    return cached
  }
}
