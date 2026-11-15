import React from 'react'

/**
 * Parameter modal. The schema comes from graphModel.js so each engine declares
 * its own knobs and this component stays generic.
 */
export default function ParamModal({ title, schema, values, defaults, onChange, onReset, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {schema.map((f) => {
            const value = values[f.key]
            const isDefault = value === defaults[f.key]

            if (f.type === 'select') {
              return (
                <div className="param-row" key={f.key}>
                  <label>
                    {f.label}
                    {f.hint && <span className="param-hint">{f.hint}</span>}
                  </label>
                  <select
                    value={value}
                    onChange={(e) => onChange(f.key, e.target.value)}
                  >
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )
            }

            return (
              <div className="param-row" key={f.key}>
                <label>
                  {f.label}
                  {f.hint && <span className="param-hint">{f.hint}</span>}
                </label>
                <div className="param-control">
                  <input
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={value}
                    onChange={(e) => onChange(f.key, Number(e.target.value))}
                  />
                  <input
                    type="number"
                    className={`param-num${isDefault ? '' : ' changed'}`}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={value}
                    onChange={(e) => onChange(f.key, Number(e.target.value))}
                  />
                </div>
              </div>
            )
          })}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onReset}>
            Reset to defaults
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
