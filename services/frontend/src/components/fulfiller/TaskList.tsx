import { useEffect, useState } from 'react'
import { fhirApi } from '../../api/client'
import { type LogEntry } from '../../hooks/useLog'

interface Task {
  id: string
  status: string
  intent: string
  priority?: string
  focus?: { reference: string }
  owner?: { reference: string }
  authoredOn?: string
  lastModified?: string
}

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
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    fhirApi.search('partyB', 'Task')
      .then(data => {
        onLog(data.log || [])
        const entries = data.result?.entry?.map((e: { resource: Task }) => e.resource) || []
        setTasks(entries)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [onLog])

  function refresh() {
    setLoading(true)
    setError(null)
    fhirApi.search('partyB', 'Task')
      .then(data => {
        onLog(data.log || [])
        const entries = data.result?.entry?.map((e: { resource: Task }) => e.resource) || []
        setTasks(entries)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }

  if (loading) return <div style={{ padding: '1rem', color: '#666' }}>Loading tasks...</div>
  if (error) return <div style={{ padding: '1rem', color: '#d32f2f' }}>{error}</div>

  return (
    <section style={styles.section}>
      <div style={styles.headerRow}>
        <h2 style={styles.heading}>Tasks (partyB)</h2>
        <button style={styles.refreshBtn} onClick={refresh}>Refresh</button>
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
            </tr>
          </thead>
          <tbody>
            {tasks.map(task => (
              <tr
                key={task.id}
                style={{
                  ...styles.tr,
                  ...(selectedId === task.id ? styles.trSelected : {}),
                }}
                onClick={() => {
                  setSelectedId(task.id)
                  onSelectTask?.(task.id)
                }}
              >
                <td style={styles.td}>
                  <span
                    style={{
                      ...styles.badge,
                      background: STATUS_COLORS[task.status] || '#888',
                    }}
                  >
                    {task.status}
                  </span>
                </td>
                <td style={styles.tdMono}>{task.focus?.reference || '—'}</td>
                <td style={styles.td}>{task.owner?.reference || '—'}</td>
                <td style={styles.td}>{task.lastModified ? new Date(task.lastModified).toLocaleString() : '—'}</td>
                <td style={styles.tdMono}>{task.id}</td>
              </tr>
            ))}
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
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '0.75rem',
    fontWeight: 600,
  },
}
