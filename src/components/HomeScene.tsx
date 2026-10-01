import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { HomeWeather } from '../lib/homeWeather'

export type HomeSceneId = 'morning' | 'day' | 'night'

export interface HomeSceneState {
  id: HomeSceneId
  greeting: string
}

type RainDropStyle = CSSProperties & {
  '--rain-x': string
  '--rain-length': string
  '--rain-alpha': string
  '--rain-delay': string
  '--rain-drift': string
  '--rain-static-y': string
}

const RAIN_DROP_COUNT = 24

function rainDropStyle(index: number): RainDropStyle {
  const x = 3 + ((index * 37 + 11) % 94)
  const length = 9 + ((index * 7 + 3) % 13)
  const alpha = 0.42 + (((index * 17 + 5) % 43) / 100)
  const delay = -(((index * 29 + 7) % 180) / 100)
  const drift = -(5 + ((index * 11 + 3) % 9))
  const staticY = 4 + ((index * 53 + 19) % 90)
  return {
    '--rain-x': `${x}%`,
    '--rain-length': `${length}px`,
    '--rain-alpha': alpha.toFixed(2),
    '--rain-delay': `${delay.toFixed(2)}s`,
    '--rain-drift': `${drift}vw`,
    '--rain-static-y': `${staticY}vh`,
  }
}

function hasRain(weather: HomeWeather | null): boolean {
  return Boolean(weather && (weather.visual === 'drizzle' || weather.visual === 'rain' || weather.visual === 'thunder'))
}

export function getHomeScene(now: Date): HomeSceneState {
  const hour = now.getHours()
  if (hour >= 5 && hour < 12) return { id: 'morning', greeting: '早安。' }
  if (hour >= 12 && hour < 18) return { id: 'day', greeting: '今天也辛苦了。' }
  return { id: 'night', greeting: '夜深了。' }
}

function needsOvercastScene(weather: HomeWeather | null): boolean {
  return Boolean(weather && weather.visual !== 'clear')
}

export default function HomeScene({
  scene,
  weather,
  children,
}: {
  scene: HomeSceneState
  weather: HomeWeather | null
  children: ReactNode
}) {
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [overcastReady, setOvercastReady] = useState(false)
  const wantsOvercast = needsOvercastScene(weather)
  const clearPath = `/home-scenes/${scene.id}.webp`
  const overcastPath = `/home-scenes/${scene.id}-overcast.webp`
  const requestedPath = wantsOvercast ? overcastPath : clearPath

  useEffect(() => {
    let active = true
    const image = new Image()
    setLoadedPath(null)
    setOvercastReady(false)

    image.onload = () => {
      if (!active) return
      setLoadedPath(requestedPath)
      setOvercastReady(wantsOvercast)
    }
    image.onerror = () => {
      if (!active) return
      if (!wantsOvercast) {
        setLoadedPath(null)
        return
      }
      // 阴天母版缺失时回退现有晴图，同时关闭全屏天气动效，避免“艳阳天下雨”的视觉穿帮。
      const fallback = new Image()
      fallback.onload = () => {
        if (active) setLoadedPath(clearPath)
      }
      fallback.onerror = () => {
        if (active) setLoadedPath(null)
      }
      fallback.src = clearPath
    }
    image.src = requestedPath

    return () => {
      active = false
      image.onload = null
      image.onerror = null
    }
  }, [clearPath, requestedPath, wantsOvercast])

  const style = loadedPath
    ? { '--home-scene-image': `url("${loadedPath}")` } as CSSProperties
    : undefined
  const weatherClass = weather && (weather.visual === 'clear' || overcastReady)
    ? ` home-weather-state-${weather.visual}`
    : ''
  const rainy = Boolean(weatherClass && hasRain(weather))

  return (
    <div className={`home-page home-scene-${scene.id}${weatherClass}`} style={style}>
      <div className="home-scene-overlay" aria-hidden="true" />
      {weatherClass ? (
        <div className="home-weather-atmosphere" aria-hidden="true">
          <span className="home-weather-fx-cloud cloud-a" />
          <span className="home-weather-fx-cloud cloud-b" />
          <span className="home-weather-fx-particles">
            {rainy
              ? Array.from({ length: RAIN_DROP_COUNT }, (_, index) => (
                  <i
                    key={index}
                    className={`home-weather-rain-drop layer-${index % 3}`}
                    style={rainDropStyle(index)}
                  />
                ))
              : null}
          </span>
          <span className="home-weather-fx-fog" />
          <span className="home-weather-fx-flash" />
        </div>
      ) : null}
      {children}
    </div>
  )
}
