/** NOAA fractional-year approximation. Angles: degrees, azimuth clockwise from north. */
export interface EnvironmentInput {
  utcTimestamp: number
  latitude: number
  longitude: number
  timezone: string
  cloudcover?: number
  windspeed10m?: number
  sunrise?: string
  sunset?: string
  isday?: number
  weatherCode?: number
  /** Outward window normal: south, fifteen degrees east. */
  windowAzimuth?: number
}

export interface EnvironmentState {
  solarAzimuth: number
  solarAltitude: number
  directIntensity: number
  diffuseIntensity: number
  colorTemperature: number
  skyColor: string
  effects: { rain: number; snow: number; fog: number; lightning: number }
  isDay: boolean
  windspeed10m: number
}

const radians = Math.PI / 180
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t) }

export function weatherEffects(code: number) {
  let rain = 0, snow = 0, fog = 0, lightning = 0
  if ([51, 56, 61, 66, 80].includes(code)) rain = 1
  if ([53, 63, 81].includes(code)) rain = 2
  if ([55, 57, 65, 67, 82, 95, 96, 99].includes(code)) rain = 3
  if ([71, 77, 85].includes(code)) snow = 1
  if (code === 73) snow = 2
  if ([75, 86].includes(code)) snow = 3
  if (code === 45) fog = 1
  if (code === 48) fog = 2
  if (code === 95) lightning = 1
  if (code === 96) lightning = 2
  if (code === 99) lightning = 3
  return { rain, snow, fog, lightning }
}

/** No device-timezone fallback: an invalid/missing city zone is a caller error. */
export function calculateEnvironment(input: EnvironmentInput): EnvironmentState {
  const { utcTimestamp, latitude, longitude, timezone } = input
  if (!Number.isFinite(utcTimestamp) || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !timezone) {
    throw new RangeError('A UTC timestamp, city coordinates and city timezone are required')
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(utcTimestamp))
  const value = (key: string) => Number(parts.find(p => p.type === key)?.value)
  const year = value('year'), month = value('month'), day = value('day')
  const localMidnight = Date.UTC(year, month - 1, day)
  const ordinal = Math.floor((localMidnight - Date.UTC(year, 0, 1)) / 86400000) + 1
  const daysInYear = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000
  const minutes = value('hour') * 60 + value('minute') + value('second') / 60
  const offsetMinutes = (localMidnight + minutes * 60000 - Math.floor(utcTimestamp / 1000) * 1000) / 60000
  const gamma = 2 * Math.PI / daysInYear * (ordinal - 1 + (minutes / 60 - 12) / 24)
  const equation = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma))
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma)
  const solarMinutes = ((minutes + equation + 4 * longitude - offsetMinutes) % 1440 + 1440) % 1440
  const hourAngle = (solarMinutes / 4 - 180) * radians
  const lat = latitude * radians
  const altitude = Math.asin(clamp(Math.sin(lat) * Math.sin(declination)
    + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle), -1, 1)) / radians
  const azimuth = (Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat)
    - Math.tan(declination) * Math.cos(lat)) / radians + 180 + 360) % 360
  const cloud = clamp((input.cloudcover ?? 0) / 100)
  const windowFacing = Math.max(0, Math.cos((azimuth - (input.windowAzimuth ?? 165)) * radians))
  const daylight = smooth((altitude + 6) / 12)
  const direct = altitude <= 0 ? 0 : smooth(altitude / 3)
    * Math.sqrt(Math.sin(altitude * radians)) * (1 - 0.85 * cloud) * windowFacing
  return {
    solarAzimuth: azimuth, solarAltitude: altitude,
    directIntensity: direct,
    diffuseIntensity: daylight * (0.22 + 0.38 * cloud),
    colorTemperature: altitude <= 0 ? 7800 : 3000 + 3500 * smooth(altitude / 25) + 700 * cloud,
    skyColor: altitude < -6 ? '#24354E' : altitude < 3 ? '#B4A6A0' : cloud > 0.7 ? '#B8C2C8' : '#ADCBDD',
    effects: weatherEffects(input.weatherCode ?? 0),
    isDay: altitude > 0,
    windspeed10m: Math.max(0, input.windspeed10m ?? 0),
  }
}
