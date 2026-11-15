import React, { useEffect, useState } from 'react'

/**
 * Genie panel — LEFT side, toggleable.
 *
 * Renders the Databricks Genie Agent as an iframe. Two hard constraints:
 *
 *  1. A workspace admin must allowlist the embedding domain (Settings →
 *     Security → External access → Embed dashboards). The allowlist is empty by
 *     default, so the frame renders blank until that is done.
 *  2. The iframe is CROSS-ORIGIN. We cannot read its DOM, so we cannot lift
 *     Genie's answer out of it and into the Viewer. Piping answers into the
 *     Viewer requires the Genie Conversation API instead.
 *
 * The embed src is pasted from the Genie Agent's Share → Embed space dialog and
 * kept in localStorage; there is no reliable way to construct it from a space id
 * alone, so we do not try.
 */

const STORAGE_KEY = 'momentum_genie_embed_src'

const WIDE_KEY = 'momentum_genie_wide'

export default function GeniePanel({ open, onToggle }) {
  const [src, setSrc] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // Two fixed sizes. The iframe is cross-origin, so its content width cannot be
  // measured — the wide preset is the substitute for auto-fitting.
  const [wide, setWide] = useState(() => localStorage.getItem(WIDE_KEY) === '1')

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) || ''
    setSrc(saved)
    setDraft(saved)
    setEditing(!saved)
  }, [])

  useEffect(() => {
    localStorage.setItem(WIDE_KEY, wide ? '1' : '0')
  }, [wide])

  const save = () => {
    const v = draft.trim()
    localStorage.setItem(STORAGE_KEY, v)
    setSrc(v)
    setEditing(false)
  }

  if (!open) {
    return (
      <button className="genie-reopen" onClick={onToggle} title="Open Genie">
        Genie
      </button>
    )
  }

  return (
    <div className={`genie-panel${wide ? ' wide' : ''}`}>
      <div className="genie-head">
        <span className="genie-title">Genie</span>
        <div className="genie-actions">
          <button
            className="mini-btn"
            onClick={() => setWide((v) => !v)}
            title={wide ? 'Narrow panel' : 'Widen panel'}
          >
            {wide ? '⇥' : '⇤'}
          </button>
          <button className="mini-btn" onClick={() => setEditing((v) => !v)} title="Configure embed">
            ⚙
          </button>
          <button className="mini-btn" onClick={onToggle} title="Hide panel">
            ×
          </button>
        </div>
      </div>

      {editing ? (
        <div className="genie-config">
          <p>
            Paste the <code>src</code> from the Genie Agent's <b>Share → Embed space</b> dialog.
          </p>
          <p className="genie-warn">
            A workspace admin must first allowlist this origin under{' '}
            <b>Settings → Security → External access → Embed dashboards</b>. The allowlist is
            empty by default, so the frame stays blank until that is done.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://<workspace>.databricks.com/embed/genie/..."
            rows={4}
          />
          <div className="genie-config-foot">
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={save} disabled={!draft.trim()}>
              Save
            </button>
          </div>
        </div>
      ) : src ? (
        <iframe
          className="genie-frame"
          src={src}
          title="Databricks Genie"
          allow="clipboard-write"
        />
      ) : (
        <div className="genie-empty">
          Not configured.
          <br />
          <button className="btn" onClick={() => setEditing(true)}>
            Add embed URL
          </button>
        </div>
      )}
    </div>
  )
}
