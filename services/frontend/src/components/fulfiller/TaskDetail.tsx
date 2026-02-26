import { useState, useEffect } from 'react'
import { fhirApi, workflowApi } from '../../api/client'
import { type LogEntry } from '../../hooks/useLog'

interface TaskDetailProps {
  taskId: string
  onLog: (entries: LogEntry[]) => void
}

type ViewMode = 'rendered' | 'json'

export function TaskDetail({ taskId, onLog }: TaskDetailProps) {
  const [task, setTask] = useState<Record<string, unknown> | null>(null)
  const [serviceRequest, setServiceRequest] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [srLoading, setSrLoading] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('rendered')
  const [newStatus, setNewStatus] = useState('')
  const [outputRef, setOutputRef] = useState('')
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fhirApi.read('partyB', 'Task', taskId)
      .then(data => {
        onLog(data.log || [])
        setTask(data.result)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [taskId, onLog])

  async function fetchServiceRequest() {
    if (!task) return
    const focusRef = (task.focus as { reference?: string })?.reference
    if (!focusRef) { setError('No ServiceRequest reference found in Task'); return }

    const srId = focusRef.split('/').pop()
    if (!srId) return

    setSrLoading(true)
    try {
      const data = await fhirApi.crossPartyRead('partyB', 'ServiceRequest', srId, 'partyA')
      onLog(data.log || [])
      setServiceRequest(data.result)
    } catch (e) {
      setError(`Cross-party fetch failed: ${e}`)
    } finally {
      setSrLoading(false)
    }
  }

  async function updateStatus() {
    if (!newStatus) return
    try {
      const data = await workflowApi.updateTaskStatus(taskId, { status: newStatus })
      onLog(data.log || [])
      setTask(data.result)
      setStatusMsg(`Status updated to: ${newStatus}`)
    } catch (e) {
      setError(String(e))
    }
  }

  async function addOutput() {
    if (!outputRef) return
    try {
      const [resType, resId] = outputRef.split('/')
      if (!resType || !resId) { setError('Use format: ResourceType/id'); return }
      const data = await workflowApi.addTaskOutput(taskId, {
        output_type: resType,
        output_reference: outputRef,
      })
      onLog(data.log || [])
      setTask(data.result)
      setStatusMsg('Output added to Task')
      setOutputRef('')
    } catch (e) {
      setError(String(e))
    }
  }

  if (loading) return <div style={{ padding: '1rem', color: '#666' }}>Loading task...</div>
  if (error) return <div style={{ padding: '1rem', color: '#d32f2f' }}>{error}</div>
  if (!task) return null

  const status = task.status as string
  const focusRef = (task.focus as { reference?: string })?.reference

  return (
    <section style={styles.section}>
      <div style={styles.headerRow}>
        <h2 style={styles.heading}>Task: {taskId}</h2>
        <div style={styles.viewTabs}>
          <button
            style={{ ...styles.viewTab, ...(viewMode === 'rendered' ? styles.viewTabActive : {}) }}
            onClick={() => setViewMode('rendered')}
          >Rendered</button>
          <button
            style={{ ...styles.viewTab, ...(viewMode === 'json' ? styles.viewTabActive : {}) }}
            onClick={() => setViewMode('json')}
          >Raw JSON</button>
        </div>
      </div>

      {viewMode === 'rendered' ? (
        <div style={styles.rendered}>
          <div style={styles.field}>
            <span style={styles.label}>Status:</span>
            <span style={{ ...styles.badge, background: STATUS_COLORS[status] || '#888' }}>{status}</span>
          </div>
          <div style={styles.field}>
            <span style={styles.label}>ServiceRequest:</span>
            <code>{focusRef || '—'}</code>
          </div>
          <div style={styles.field}>
            <span style={styles.label}>Owner:</span>
            <span>{(task.owner as { reference?: string })?.reference || '—'}</span>
          </div>
          {(task.output as unknown[])?.length > 0 && (
            <div style={styles.field}>
              <span style={styles.label}>Outputs:</span>
              <ul>
                {(task.output as Array<{ valueReference?: { reference?: string } }>).map((o, i) => (
                  <li key={i}><code>{o.valueReference?.reference}</code></li>
                ))}
              </ul>
            </div>
          )}

          <div style={styles.actions}>
            <div style={styles.actionGroup}>
              <h3 style={styles.actionHeading}>Fetch ServiceRequest from PartyA</h3>
              <p style={styles.actionDesc}>Cross-party read — shows OAuth negotiation in log panel</p>
              <button style={styles.btn} onClick={fetchServiceRequest} disabled={srLoading}>
                {srLoading ? 'Fetching...' : 'Fetch ServiceRequest'}
              </button>
            </div>

            {serviceRequest && (
              <div style={styles.srCard}>
                <h4>ServiceRequest from PartyA</h4>
                <pre style={styles.json}>{JSON.stringify(serviceRequest, null, 2)}</pre>
              </div>
            )}

            <div style={styles.actionGroup}>
              <h3 style={styles.actionHeading}>Update Status</h3>
              <div style={styles.row}>
                <select style={styles.select} value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                  <option value="">Select status...</option>
                  <option>accepted</option>
                  <option>in-progress</option>
                  <option>completed</option>
                  <option>cancelled</option>
                  <option>rejected</option>
                </select>
                <button style={styles.btn} onClick={updateStatus} disabled={!newStatus}>Update</button>
              </div>
            </div>

            <div style={styles.actionGroup}>
              <h3 style={styles.actionHeading}>Add Output Reference</h3>
              <div style={styles.row}>
                <input
                  style={styles.input}
                  placeholder="e.g. Appointment/appt-001"
                  value={outputRef}
                  onChange={e => setOutputRef(e.target.value)}
                />
                <button style={styles.btn} onClick={addOutput} disabled={!outputRef}>Add</button>
              </div>
            </div>

            {statusMsg && <div style={styles.success}>{statusMsg}</div>}
          </div>
        </div>
      ) : (
        <pre style={styles.json}>{JSON.stringify(task, null, 2)}</pre>
      )}
    </section>
  )
}

const STATUS_COLORS: Record<string, string> = {
  requested: '#ff9800',
  accepted: '#2196f3',
  'in-progress': '#9c27b0',
  completed: '#4caf50',
  cancelled: '#f44336',
}

const styles: Record<string, React.CSSProperties> = {
  section: { padding: '1rem' },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
  heading: { fontSize: '1.1rem', color: '#3d0c02', margin: 0 },
  viewTabs: { display: 'flex', gap: '4px' },
  viewTab: { padding: '4px 12px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer', borderRadius: '4px', fontSize: '0.8rem' },
  viewTabActive: { background: '#3d0c02', color: '#fff', borderColor: '#3d0c02' },
  rendered: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  field: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.9rem' },
  label: { fontWeight: 600, minWidth: '130px', color: '#555' },
  badge: { display: 'inline-block', padding: '2px 10px', borderRadius: '12px', color: '#fff', fontSize: '0.8rem', fontWeight: 600 },
  actions: { display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' },
  actionGroup: { padding: '0.75rem', background: '#fff8f8', borderRadius: '6px', border: '1px solid #f0cece' },
  actionHeading: { margin: '0 0 4px', fontSize: '0.9rem', color: '#3d0c02' },
  actionDesc: { margin: '0 0 8px', fontSize: '0.8rem', color: '#888' },
  row: { display: 'flex', gap: '8px', alignItems: 'center' },
  btn: { padding: '7px 14px', background: '#3d0c02', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', whiteSpace: 'nowrap' },
  select: { padding: '6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.85rem' },
  input: { flex: 1, padding: '6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.85rem' },
  srCard: { padding: '0.75rem', background: '#f5f5f5', borderRadius: '6px' },
  json: { background: '#0d1117', color: '#79c0ff', padding: '1rem', borderRadius: '6px', fontSize: '0.78rem', overflow: 'auto', maxHeight: '400px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  success: { padding: '0.5rem 0.75rem', background: '#e8f5e9', borderRadius: '4px', fontSize: '0.85rem', color: '#2e7d32' },
}
