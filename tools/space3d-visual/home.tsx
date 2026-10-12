/** Development-only actual Home fixture; isolated Chromium profile, no real user data. */
import {createRoot} from 'react-dom/client'
import Home from '../../src/components/Home'
import '../../src/styles/tokens.css'
import '../../src/index.css'
import '../../src/styles/primitives.css'
import '../../src/styles/ui2.css'
import '../../src/styles/home.css'
import '../../src/styles/ui204MobileClosure.css'
const fixedTime=Date.parse('2026-06-21T04:00:00Z');Date.now=()=>fixedTime
const events:string[]=[];Object.assign(window,{visualEvents:events})
localStorage.setItem('ai_companion_user_profile',JSON.stringify({city:'北京'}))
localStorage.setItem('eluvin_home_weather_consent_v1','yes')
localStorage.setItem('eluvin_home_weather_v1',JSON.stringify({city:'北京',queryCity:'北京',temperature:26,
  weatherCode:0,fetchedAt:fixedTime,latitude:39.9042,longitude:116.4074,cloudcover:15,
  timezone:new URLSearchParams(location.search).get('invalid')==='1'?'Invalid/Zone':'Asia/Shanghai'}))
createRoot(document.getElementById('root')!).render(<div className="app"><main className="app-main">
  <Home onGoChat={()=>events.push('chat')} onGoLife={()=>events.push('life')}
    onGoAnniversary={()=>events.push('anniversary')} onGoNotifications={()=>events.push('notifications')} />
</main></div>)
