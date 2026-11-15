import React, { useEffect, useState } from 'react'
import { loadSnapshot } from './data.js'
import MomentumBoard from './views/MomentumBoard.jsx'
import GraphExplorer from './views/GraphExplorer.jsx'
import Setup from './views/Setup.jsx'
import Logs from './views/Logs.jsx'

const TABS = [
  { id: 'board', label: 'Momentum Board' },
  { id: 'graph', label: 'Graph Explorer' },
  { id: 'setup', label: 'Setup / Pillars' },
  { id: 'logs', label: 'Logs' },
]

export default function App() {
  const [tab, setTab] = useState('board')
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState(null)
  const [light, setLight] = useState(() => localStorage.getItem('momentum_theme') === 'light')

  useEffect(() => {
    document.body.classList.toggle('light', light)
    localStorage.setItem('momentum_theme', light ? 'light' : 'dark')
  }, [light])

  useEffect(() => {
    loadSnapshot().then(setSnapshot).catch((e) => setError(e.message))
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Momentum Engine
          <span>5 pillars · 7 sources</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        {snapshot && (
          <div className="meta">
            {snapshot.nodes.length.toLocaleString()} nodes ·{' '}
            {snapshot.edges.length.toLocaleString()} edges
          </div>
        )}
        <button
          className="theme-toggle"
          onClick={() => setLight((v) => !v)}
          title={light ? 'Switch to dark theme' : 'Switch to light theme'}
          aria-label="Toggle color theme"
        >
          {light ? '☾' : '☀'}
        </button>
      </header>

      <main className="main">
        {error && (
          <div className="empty">
            Could not load the data snapshot.
            <br />
            <span className="mono">{error}</span>
            <br />
            <br />
            Run <span className="mono">python scripts/export_ui_data.py</span> first.
          </div>
        )}
        {!error && !snapshot && <div className="loading">Loading…</div>}
        {snapshot && tab === 'board' && <MomentumBoard snapshot={snapshot} />}
        {snapshot && tab === 'graph' && <GraphExplorer snapshot={snapshot} />}
        {snapshot && tab === 'setup' && <Setup snapshot={snapshot} />}
        {snapshot && tab === 'logs' && <Logs snapshot={snapshot} />}
      </main>
    </div>
  )
}
