import { useState } from 'react'
import Chat from './components/Chat'
import Memory from './components/Memory'
import Work from './components/Work'
import Settings from './components/Settings'

type View = 'chat' | 'memory' | 'work' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('chat')

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">AI 伴侣</h1>
        <p className="app-subtitle">温柔 · 真诚 · 记得你说过的每句话</p>
      </header>

      <main className="app-main">
        {view === 'chat' && <Chat onGoSettings={() => setView('settings')} />}
        {view === 'memory' && <Memory />}
        {view === 'work' && <Work />}
        {view === 'settings' && <Settings />}
      </main>

      <nav className="app-nav">
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
          className={`nav-btn${view === 'work' ? ' active' : ''}`}
          onClick={() => setView('work')}
        >
          工作台
        </button>
        <button
          className={`nav-btn${view === 'settings' ? ' active' : ''}`}
          onClick={() => setView('settings')}
        >
          我的
        </button>
      </nav>
    </div>
  )
}
