import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './styles/tokens.css'
import './index.css'
import './styles/primitives.css'
import './styles/ui2.css'
import './styles/home.css'
import './styles/spaceLetter.css'
import './styles/updateControls.css'
import App from './App.tsx'
import './styles/ui204MobileClosure.css'
import './styles/space.css'
import './styles/memory.css'
import './styles/mine.css'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { initSyncListener } from './lib/sync.ts'
import { applyTheme } from './lib/theme.ts'
import { initCloudStateResourceAdapters } from './lib/cloudStateResources.ts'
// PWA：自动注册 Service Worker，新版本发布后自动更新
registerSW({ immediate: true })
// 账号同步：监听本地数据变更，防抖 4 秒后自动上传（未登录时静默跳过）
initSyncListener()
initCloudStateResourceAdapters()
// 主题系统（TASK_THEME）：启动即应用本地/云端主题（渲染前写入 CSS 变量，避免闪烁）
applyTheme()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
