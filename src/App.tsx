import { useState } from 'react'
import Home from './components/Home'
import Chat from './components/Chat'
import Memory from './components/Memory'
import Settings from './components/Settings'

type View = 'home' | 'chat' | 'memory' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('home')

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">AI 伴侣</h1>
        <p className="app-subtitle">温柔 · 真诚 · 记得你说过的每句话</p>
      </header>

      <main className="app-main">
        {view === 'home' && <Home onGoChat={() => setView('chat')} onGoSettings={() => setView('settings')} />}
        {view === 'chat' && <Chat onGoSettings={() => setView('settings')} />}
        {view === 'memory' && <Memory />}
        {view === 'settings' && <Settings />}
      </main>

      <nav className="app-nav">
        <button
          className={`nav-btn${view === 'home' ? ' active' : ''}`}
          onClick={() => setView('home')}
        >
          主页
        </button>
        <button
          className={`nav-btn${view === 'chat' ? ' active' : ''}`}
          onClick={() => setView('chat')}
        >
          聊天
        </button>
        <button
          className={`nav-btn${view === 'memory' ? ' active' : ''}`}
          onClick={() => setView('memory')}
        >
          记忆
        </button>
        <button
          className={`nav-btn${view === 'settings' ? ' active' : ''}`}
          onClick={() => setView('settings')}
        >
          设置
        </button>
      </nav>
    </div>
  )
}
