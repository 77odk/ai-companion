/** Development-only synthetic fixture; never included in Vite's production entry. */
import { createRoot } from 'react-dom/client'
import Space3DCanvas from '../../src/components/space3d/Space3DCanvas'
import AISpace from '../../src/components/AISpace'
import { getListenTogetherSnapshot } from '../../src/lib/listenTogetherState'
import { calculateEnvironment } from '../../src/lib/environment'
import '../../src/styles/space3d.css'
import '../../src/styles/space.css'
import '../../src/styles/ui2.css'

const fixedTime = Date.parse('2026-06-21T04:00:00Z')
Date.now = () => fixedTime
const synthetic = '这是一段用于截图验收的合成文字，不来自任何用户聊天。窗边的书桌安静地摆着一本书，翻到下一页，仍能清楚地看见每一个字。今天的天气和光线只用于固定测试条件。'
const messages = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, role: i % 2 ? 'assistant' as const : 'user' as const,
  ts: fixedTime + i * 1000, content: synthetic.repeat(4) }))
const weather = { city:'北京',temperature:26,weatherCode:0,visual:'clear' as const,label:'晴',fetchedAt:fixedTime,
  latitude:39.9042,longitude:116.4074,timezone:'Asia/Shanghai',cloudcover:15,windspeed10m:5,isday:1 }
const params = new URLSearchParams(location.search)
const events: string[] = []
Object.assign(window, { visualFixture: { time:fixedTime,weather,dpr:1,synthetic:true }, visualEvents:events })
if (params.get('integrated') === '1') {
  createRoot(document.getElementById('root')!).render(<AISpace onOpenStarJar={()=>events.push('jar')}
    onOpenThoughts={()=>events.push('book')} onOpenListen={()=>events.push('player')} onOpenWeekly={()=>events.push('drawer')} />)
} else createRoot(document.getElementById('root')!).render(<Space3DCanvas data={{ sessionId:'visual-only',messages,
  memoryCount:24,weeklyCount:4,photoUrls:params.get('photos')==='8'?Array.from({length:8},(_,i)=>'/home-scenes/'+['morning','day','night'][i%3]+'.webp'):[],listen:getListenTogetherSnapshot(),weather }}
  onOpen={hit=>events.push(String(hit))} onReady={()=>Object.assign(window,{visualReady:true})}
  onFailure={reason=>Object.assign(window,{visualFailure:reason})} />)

// Separate renderer-only probe for diagnostics, independent from the React state tree.
Object.assign(window, { environmentFixture: calculateEnvironment({...weather,utcTimestamp:fixedTime}) })
