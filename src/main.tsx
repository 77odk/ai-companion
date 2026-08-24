import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { initSyncListener } from './lib/sync.ts'

// PWA：自动注册 Service Worker，新版本发布后自动更新
registerSW({ immediate: true })

// 账号同步：监听本地数据变更，防抖 4 秒后自动上传（未登录时静默跳过）
initSyncListener()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
