import { useState, useEffect, Fragment } from 'react'
import { fhirApi, workflowApi } from '../../api/client'
import { type LogEntry } from '../../hooks/useLog'

interface TaskCreationProps {
  serviceRequestId?: string
  onLog: (entries: LogEntry[]) => void
  onCreated?: (taskId: string) => void
}

interface FhirOption {
  id: string
  display: string
}

type FhirResource = Record<string, unknown>

export function TaskCreation({ serviceRequestId, onLog, onCreated }: TaskCreationProps) {
  const [partyAOrgs, setPartyAOrgs] = useState<FhirOption[]>([])
  const [partyBOrgs, setPartyBOrgs] = useState<FhirOption[]>([])
  const [existingTasks, setExistingTasks] = useState<FhirResource[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [ownerOrgId, setOwnerOrgId] = useState('')
  const [requesterOrgId, setRequesterOrgId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ id: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fhirApi.search('partyA', 'Organization')
      .then(data => {
        const entries: FhirOption[] = (data.result?.entry || []).map((e: { resource: FhirResource }) => ({
          id: e.resource.id as string,
          display: (e.resource.name as string) || (e.resource.id as string),
        }))
        setPartyAOrgs(entries)
        if (entries.length > 0) setRequesterOrgId(entries[0].id)
      })
      .catch(() => {})

    fhirApi.search('partyB', 'Organization')
      .then(data => {
        const entries: FhirOption[] = (data.result?.entry || []).map((e: { resource: FhirResource }) => ({
          id: e.resource.id as string,
          display: (e.resource.name as string) || (e.resource.id as string),
        }))
        setPartyBOrgs(entries)
        if (entries.length > 0) setOwnerOrgId(entries[0].id)
      })
      .catch(() => {})

    fhirApi.search('partyB', 'Task')
      .then(data => {
        const entries: FhirResource[] = (data.result?.entry || []).map((e: { resource: FhirResource }) => e.resource)
        setExistingTasks(entries)
      })
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!serviceRequestId) { setError('ServiceRequest required.'); return }
    setLoading(true)
    setError(null)

    try {
      const data = await workflowApi.createTask({
        service_request_id: serviceRequestId,
        service_request_party: 'partyA',
        owner_organization_id: ownerOrgId,
        requester_organization_id: requesterOrgId,
      })
      onLog(data.log || [])
      const created = data.result as FhirResource
      setResult(created as { id: string })
      setExistingTasks(prev => [created, ...prev])
      onCreated?.(created.id as string)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section style={styles.section}>
      <h2 style={styles.heading}>Tasks (partyB)</h2>

      {existingTasks.length > 0 && (
        <div style={styles.listBlock}>
          <div style={styles.listTitle}>Existing Tasks at partyB</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Focus (SR)</th>
                <th style={styles.th}>Owner</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {existingTasks.map(t => {
                const id = t.id as string
                const isExpanded = expandedId === id
                const status = t.status as string
                const focus = (t.focus as { reference?: string })?.reference || '—'
                const owner = (t.owner as { reference?: string })?.reference || '—'
                return (
                  <Fragment key={id}>
                    <tr style={styles.tr}>
                      <td style={styles.tdMono}>{id}</td>
                      <td style={styles.td}><span style={{ ...styles.badge, ...statusColor(status) }}>{status}</span></td>
                      <td style={styles.td}>{focus}</td>
                      <td style={styles.td}>{owner}</td>
                      <td style={styles.tdAction}>
                        <button style={styles.jsonBtn} onClick={() => setExpandedId(isExpanded ? null : id)}>{isExpanded ? '×' : '{ }'}</button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} style={{ padding: 0 }}>
                          <pre style={styles.json}>{JSON.stringify(t, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={styles.formBlock}>
        <div style={styles.listTitle}>Create New</div>
        <p style={styles.desc}>
          Creates a Task in partyB's FHIR store referencing the ServiceRequest.
          PartyB will see this task in their queue.
        </p>

        {serviceRequestId && (
          <div style={styles.info}>
            ServiceRequest: <code>{serviceRequestId}</code>
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Requester Organization (partyA)
            {partyAOrgs.length > 0 ? (
              <select style={styles.select} value={requesterOrgId} onChange={e => setRequesterOrgId(e.target.value)} required>
                {partyAOrgs.map(o => (
                  <option key={o.id} value={o.id}>{o.display} ({o.id})</option>
                ))}
              </select>
            ) : (
              <input style={styles.input} value={requesterOrgId} onChange={e => setRequesterOrgId(e.target.value)} placeholder="partyA organization ID" required />
            )}
          </label>
          <label style={styles.label}>
            Owner Organization (partyB)
            {partyBOrgs.length > 0 ? (
              <select style={styles.select} value={ownerOrgId} onChange={e => setOwnerOrgId(e.target.value)} required>
                {partyBOrgs.map(o => (
                  <option key={o.id} value={o.id}>{o.display} ({o.id})</option>
                ))}
              </select>
            ) : (
              <input style={styles.input} value={ownerOrgId} onChange={e => setOwnerOrgId(e.target.value)} placeholder="partyB organization ID" required />
            )}
          </label>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" style={styles.btn} disabled={loading}>
            {loading ? 'Creating...' : 'Create Task at partyB'}
          </button>
        </form>

        {result && (
          <div style={styles.success}>
            Task created at partyB: <code>{result.id}</code>
          </div>
        )}
      </div>
    </section>
  )
}

function statusColor(status: string): React.CSSProperties {
  if (status === 'requested') return { background: '#fff8e1', color: '#f57f17' }
  if (status === 'in-progress') return { background: '#e3f2fd', color: '#1565c0' }
  if (status === 'completed') return { background: '#e8f5e9', color: '#2e7d32' }
  if (status === 'cancelled') return { background: '#fce4ec', color: '#c62828' }
  return { background: '#f5f5f5', color: '#555' }
}

const styles: Record<string, React.CSSProperties> = {
  section: { padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  heading: { fontSize: '1.1rem', marginBottom: '0', color: '#1a1a2e' },
  listBlock: { border: '1px solid #e0e0e0', borderRadius: '6px', overflow: 'hidden' },
  formBlock: { border: '1px solid #e0e0e0', borderRadius: '6px', padding: '1rem' },
  listTitle: { padding: '8px 12px', background: '#f5f5f5', borderBottom: '1px solid #e0e0e0', fontSize: '0.8rem', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' },
  desc: { fontSize: '0.85rem', color: '#555', margin: '0.5rem 0 1rem' },
  info: { marginBottom: '1rem', padding: '0.5rem', background: '#e3f2fd', borderRadius: '4px', fontSize: '0.85rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '500px' },
  label: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem', fontWeight: 600, color: '#333' },
  input: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' },
  select: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', background: '#fff' },
  btn: { padding: '10px 20px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' },
  error: { color: '#d32f2f', padding: '0.5rem', background: '#ffebee', borderRadius: '4px' },
  success: { marginTop: '1rem', padding: '0.75rem', background: '#e8f5e9', borderRadius: '4px', fontSize: '0.85rem' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' },
  th: { textAlign: 'left', padding: '8px 12px', background: '#fafafa', borderBottom: '1px solid #eee', fontWeight: 600, color: '#555' },
  tr: { borderBottom: '1px solid #f5f5f5' },
  td: { padding: '8px 12px', color: '#333' },
  tdMono: { padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.78rem', color: '#666' },
  tdAction: { padding: '4px 8px', textAlign: 'right', width: '56px' },
  badge: { padding: '2px 8px', borderRadius: '10px', fontSize: '0.78rem', fontWeight: 600 },
  jsonBtn: { padding: '2px 7px', fontFamily: 'monospace', fontSize: '0.78rem', background: '#f5f5f5', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', color: '#555', whiteSpace: 'nowrap' },
  json: { margin: 0, background: '#0d1117', color: '#79c0ff', padding: '1rem', fontSize: '0.78rem', overflow: 'auto', maxHeight: '400px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
}
