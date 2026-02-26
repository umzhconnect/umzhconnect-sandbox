import { useEffect, useState, Fragment } from 'react'
import { fhirApi } from '../../api/client'
import { type LogEntry } from '../../hooks/useLog'

type FhirResource = Record<string, unknown>

interface TaskListProps {
  onLog: (entries: LogEntry[]) => void
  onSelectTask?: (taskId: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  requested: '#ff9800',
  accepted: '#2196f3',
  'in-progress': '#9c27b0',
  completed: '#4caf50',
  cancelled: '#f44336',
  rejected: '#f44336',
}

export function TaskList({ onLog, onSelectTask }: TaskListProps) {
  const [tasks, setTasks] = useState<FhirResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function loadTasks() {
    setLoading(true)
    setError(null)
    fhirApi.search('partyB', 'Task')
      .then(data => {
        onLog(data.log || [])
        const entries: FhirResource[] = data.result?.entry?.map((e: { resource: FhirResource }) => e.resource) || []
        setTasks(entries)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadTasks() }, [onLog]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div style={{ padding: '1rem', color: '#666' }}>Loading tasks...</div>
  if (error) return <div style={{ padding: '1rem', color: '#d32f2f' }}>{error}</div>

  return (
    <section style={styles.section}>
      <div style={styles.headerRow}>
        <h2 style={styles.heading}>Tasks (partyB)</h2>
        <button style={styles.refreshBtn} onClick={loadTasks}>Refresh</button>
      </div>

      {tasks.length === 0 ? (
        <div style={styles.empty}>No tasks yet. PartyA must create a Task referencing a ServiceRequest.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>ServiceRequest</th>
              <th style={styles.th}>Owner</th>
              <th style={styles.th}>Last Modified</th>
              <th style={styles.th}>ID</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map(task => {
              const id = task.id as string
              const status = task.status as string
              const isExpanded = expandedId === id
              const focus = (task.focus as { reference?: string })?.reference || '—'
              const owner = (task.owner as { reference?: string })?.reference || '—'
              const lastMod = task.lastModified as string | undefined
              return (
                <Fragment key={id}>
                  <tr
                    style={{ ...styles.tr, ...(selectedId === id ? styles.trSelected : {}) }}
                    onClick={() => { setSelectedId(id); onSelectTask?.(id) }}
                  >
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, background: STATUS_COLORS[status] || '#888' }}>
                        {status}
                      </span>
                    </td>
                    <td style={styles.tdMono}>{focus}</td>
                    <td style={styles.td}>{owner}</td>
                    <td style={styles.td}>{lastMod ? new Date(lastMod).toLocaleString() : '—'}</td>
                    <td style={styles.tdMono}>{id}</td>
                    <td style={styles.tdAction} onClick={e => { e.stopPropagation(); setExpandedId(isExpanded ? null : id) }}>
                      <button style={styles.jsonBtn}>{isExpanded ? '×' : '{ }'}</button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <pre style={styles.json}>{JSON.stringify(task, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  section: { padding: '1rem' },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' },
  heading: { fontSize: '1.1rem', color: '#3d0c02', margin: 0 },
  refreshBtn: { padding: '5px 12px', background: '#fff', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' },
  empty: { padding: '0.5rem', color: '#888', fontStyle: 'italic' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
  th: { textAlign: 'left', padding: '8px 12px', background: '#fff8f8', borderBottom: '2px solid #f0cece', fontWeight: 600 },
  tr: { cursor: 'pointer', transition: 'background 0.1s' },
  trSelected: { background: '#fff0f0' },
  td: { padding: '8px 12px', borderBottom: '1px solid #eee' },
  tdMono: { padding: '8px 12px', borderBottom: '1px solid #eee', fontFamily: 'monospace', fontSize: '0.8rem', color: '#666' },
  tdAction: { padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right', width: '56px' },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: '12px', color: '#fff', fontSize: '0.75rem', fontWeight: 600 },
  jsonBtn: { padding: '2px 7px', fontFamily: 'monospace', fontSize: '0.78rem', background: '#fff8f8', border: '1px solid #f0cece', borderRadius: '4px', cursor: 'pointer', color: '#3d0c02', whiteSpace: 'nowrap' },
  json: { margin: 0, background: '#0d1117', color: '#79c0ff', padding: '1rem', fontSize: '0.78rem', overflow: 'auto', maxHeight: '400px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
}
