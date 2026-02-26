import { useState } from 'react'
import { type LogEntry } from '../../hooks/useLog'

interface LogPanelProps {
  entries: LogEntry[]
  onClear: () => void
}

const METHOD_COLORS: Record<string, string> = {
  GET: '#4caf50',
  POST: '#2196f3',
  PUT: '#ff9800',
  DELETE: '#f44336',
  PATCH: '#9c27b0',
}

export function LogPanel({ entries, onClear }: LogPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <aside
      style={{
        ...styles.panel,
        width: collapsed ? '40px' : '360px',
        minWidth: collapsed ? '40px' : '360px',
      }}
    >
      <div style={styles.header}>
        {!collapsed && (
          <>
            <span style={styles.title}>Protocol Log ({entries.length})</span>
            <button style={styles.clearBtn} onClick={onClear}>Clear</button>
          </>
        )}
        <button style={styles.collapseBtn} onClick={() => setCollapsed(c => !c)}>
          {collapsed ? '>' : '<'}
        </button>
      </div>

      {!collapsed && (
        <div style={styles.entries}>
          {entries.length === 0 && (
            <div style={styles.empty}>
              Trigger a workflow action to see HTTP calls here.
            </div>
          )}
          {entries.map((entry, idx) => (
            <div
              key={entry.id || idx}
              style={{
                ...styles.entry,
                ...(selected === idx ? styles.entrySelected : {}),
              }}
              onClick={() => setSelected(selected === idx ? null : idx)}
            >
              <div style={styles.entryHeader}>
                <span
                  style={{
                    ...styles.method,
                    color: METHOD_COLORS[entry.method] || '#aaa',
                  }}
                >
                  {entry.method}
                </span>
                <span
                  style={{
                    ...styles.status,
                    color: entry.status && entry.status >= 400 ? '#f44336' : '#4caf50',
                  }}
                >
                  {entry.status || '...'}
                </span>
              </div>
              <div style={styles.url}>{entry.url}</div>
              {entry.note && <div style={styles.note}>{entry.note}</div>}

              {selected === idx && (
                <pre style={styles.detail}>
                  {JSON.stringify(
                    {
                      method: entry.method,
                      url: entry.url,
                      status: entry.status,
                      note: entry.note,
                      params: entry.params,
                      body_type: entry.body_type,
                      response_size: entry.response_size,
                      timestamp: entry.timestamp,
                    },
                    null,
                    2
                  )}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    background: '#0d1117',
    borderLeft: '1px solid #30363d',
    color: '#c9d1d9',
    fontFamily: 'monospace',
    fontSize: '0.78rem',
    height: '100%',
    overflowY: 'auto',
    transition: 'width 0.2s',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: '#161b22',
    borderBottom: '1px solid #30363d',
    gap: '8px',
    position: 'sticky',
    top: 0,
  },
  title: { fontWeight: 600, flex: 1, color: '#8b949e', fontSize: '0.75rem' },
  clearBtn: {
    background: 'none',
    border: '1px solid #30363d',
    color: '#8b949e',
    cursor: 'pointer',
    padding: '2px 8px',
    borderRadius: '3px',
    fontSize: '0.75rem',
  },
  collapseBtn: {
    background: 'none',
    border: '1px solid #30363d',
    color: '#8b949e',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '0.75rem',
  },
  entries: { flex: 1, overflowY: 'auto' },
  empty: {
    padding: '1rem',
    color: '#484f58',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  entry: {
    padding: '8px 12px',
    borderBottom: '1px solid #21262d',
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  entrySelected: { background: '#161b22' },
  entryHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: '2px' },
  method: { fontWeight: 700, fontSize: '0.72rem' },
  status: { fontWeight: 700, fontSize: '0.72rem' },
  url: { color: '#8b949e', wordBreak: 'break-all', fontSize: '0.72rem', lineHeight: 1.4 },
  note: { color: '#f0e68c', marginTop: '3px', fontSize: '0.7rem' },
  detail: {
    marginTop: '8px',
    padding: '8px',
    background: '#0d1117',
    borderRadius: '4px',
    fontSize: '0.7rem',
    overflowX: 'auto',
    color: '#79c0ff',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
}
