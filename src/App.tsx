import { useState } from 'react'
import Welcome from './components/Welcome'
import Chat from './components/Chat'
import Memory from './components/Memory'
import Work from './components/Work'
import Settings from './components/Settings'
import AISpace from './components/AISpace'

type View = 'welcome' | 'chat' | 'memory' | 'work' | 'settings' | 'aispace'

export default function App() {
  const [view, setView] = useState<View>('welcome')
  const [spaceFrom, setSpaceFrom] = useState<View>('chat')

  const openSpace = (from: View) => {
    setSpaceFrom(from)
    setView('aispace')
  }

  const backFromSpace = () => setView(spaceFrom)

  return (
    <div className="app">
      {view === 'welcome' ? (
        <Welcome onStart={() => setView('chat')} />
      ) : view === 'aispace' ? (
        <AISpace onBack={backFromSpace} />
      ) : (
        <>
          <header className="app-header">
            <h1 className="app-title">忆文</h1>
            <p className="app-subtitle">忆过往，成文思</p>
          </header>

          <main className="app-main">
            {view === 'chat' && <Chat onGoSettings={() => setView('settings')} onOpenSpace={() => openSpace('chat')} />}
            {view === 'memory' && <Memory />}
            {view === 'work' && <Work />}
            {view === 'settings' && <Settings onOpenSpace={() => openSpace('settings')} />}
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
        </>
      )}
    </div>
  )
}
