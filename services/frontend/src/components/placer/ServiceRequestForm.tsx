import { useState, useEffect, Fragment } from 'react'
import { fhirApi, workflowApi } from '../../api/client'
import { type LogEntry } from '../../hooks/useLog'

interface ServiceRequestFormProps {
  patientId?: string
  patientName?: string
  onLog: (entries: LogEntry[]) => void
  onCreated?: (srId: string) => void
}

interface FhirOption {
  id: string
  display: string
}

type FhirResource = Record<string, unknown>

export function ServiceRequestForm({ patientId, patientName, onLog, onCreated }: ServiceRequestFormProps) {
  const [practitioners, setPractitioners] = useState<FhirOption[]>([])
  const [orgs, setOrgs] = useState<FhirOption[]>([])
  const [existingSrs, setExistingSrs] = useState<FhirResource[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [practitionerId, setPractitionerId] = useState('')
  const [orgId, setOrgId] = useState('')
  const [reasonCode, setReasonCode] = useState('444798002')
  const [reasonDisplay, setReasonDisplay] = useState('Suspected ACL Rupture')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ id: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fhirApi.search('partyA', 'Practitioner')
      .then(data => {
        const entries: FhirOption[] = (data.result?.entry || []).map((e: { resource: FhirResource }) => ({
          id: e.resource.id as string,
          display: formatPractitionerName(e.resource.name as Array<{ family?: string; given?: string[]; prefix?: string[] }> | undefined),
        }))
        setPractitioners(entries)
        if (entries.length > 0) setPractitionerId(entries[0].id)
      })
      .catch(() => {})

    fhirApi.search('partyB', 'Organization')
      .then(data => {
        const entries: FhirOption[] = (data.result?.entry || []).map((e: { resource: FhirResource }) => ({
          id: e.resource.id as string,
          display: (e.resource.name as string) || (e.resource.id as string),
        }))
        setOrgs(entries)
        if (entries.length > 0) setOrgId(entries[0].id)
      })
      .catch(() => {})

    fhirApi.search('partyA', 'ServiceRequest')
      .then(data => {
        const entries: FhirResource[] = (data.result?.entry || []).map((e: { resource: FhirResource }) => e.resource)
        setExistingSrs(entries)
      })
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!patientId) { setError('Select a patient first.'); return }
    setLoading(true)
    setError(null)

    try {
      const data = await workflowApi.createServiceRequest({
        patient_id: patientId,
        requester_practitioner_id: practitionerId,
        performer_organization_id: orgId,
        reason_code: reasonCode,
        reason_display: reasonDisplay,
        note: note || undefined,
      })
      onLog(data.log || [])
      const created = data.result as FhirResource
      setResult(created as { id: string })
      setExistingSrs(prev => [created, ...prev])
      onCreated?.((created.id as string))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section style={styles.section}>
      <h2 style={styles.heading}>ServiceRequests (partyA)</h2>

      {existingSrs.length > 0 && (
        <div style={styles.listBlock}>
          <div style={styles.listTitle}>Existing ServiceRequests</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Patient</th>
                <th style={styles.th}>Performer</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {existingSrs.map(sr => {
                const id = sr.id as string
                const isExpanded = expandedId === id
                const status = sr.status as string
                const patient = (sr.subject as { reference?: string })?.reference || '—'
                const performer = (sr.performer as Array<{ reference?: string }>)?.[0]?.reference || '—'
                return (
                  <Fragment key={id}>
                    <tr style={styles.tr}>
                      <td style={styles.tdMono}>{id}</td>
                      <td style={styles.td}><span style={{ ...styles.badge, ...statusColor(status) }}>{status}</span></td>
                      <td style={styles.td}>{patient}</td>
                      <td style={styles.td}>{performer}</td>
                      <td style={styles.tdAction}>
                        <button style={styles.jsonBtn} onClick={() => setExpandedId(isExpanded ? null : id)}>{isExpanded ? '×' : '{ }'}</button>
                        <button style={styles.useBtn} onClick={() => onCreated?.(id)}>Use →</button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} style={{ padding: 0 }}>
                          <pre style={styles.json}>{JSON.stringify(sr, null, 2)}</pre>
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
        {patientName && (
          <div style={styles.patient}>Patient: <strong>{patientName}</strong> ({patientId})</div>
        )}
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Requester Practitioner
            {practitioners.length > 0 ? (
              <select style={styles.select} value={practitionerId} onChange={e => setPractitionerId(e.target.value)} required>
                {practitioners.map(p => (
                  <option key={p.id} value={p.id}>{p.display} ({p.id})</option>
                ))}
              </select>
            ) : (
              <input style={styles.input} value={practitionerId} onChange={e => setPractitionerId(e.target.value)} placeholder="Practitioner ID (run Initialize Sandbox first)" required />
            )}
          </label>
          <label style={styles.label}>
            Performer Organization (partyB)
            {orgs.length > 0 ? (
              <select style={styles.select} value={orgId} onChange={e => setOrgId(e.target.value)} required>
                {orgs.map(o => (
                  <option key={o.id} value={o.id}>{o.display} ({o.id})</option>
                ))}
              </select>
            ) : (
              <input style={styles.input} value={orgId} onChange={e => setOrgId(e.target.value)} placeholder="Organization ID (run Initialize Sandbox first)" required />
            )}
          </label>
          <label style={styles.label}>
            Reason Code (SNOMED CT)
            <input style={styles.input} value={reasonCode} onChange={e => setReasonCode(e.target.value)} />
          </label>
          <label style={styles.label}>
            Reason Display
            <input style={styles.input} value={reasonDisplay} onChange={e => setReasonDisplay(e.target.value)} />
          </label>
          <label style={styles.label}>
            Clinical Note (optional)
            <textarea style={styles.textarea} value={note} onChange={e => setNote(e.target.value)} rows={3} />
          </label>
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" style={styles.btn} disabled={loading}>
            {loading ? 'Creating...' : 'Create ServiceRequest'}
          </button>
        </form>
        {result && (
          <div style={styles.success}>
            ServiceRequest created: <code>{result.id}</code>
          </div>
        )}
      </div>
    </section>
  )
}

function formatPractitionerName(name?: Array<{ family?: string; given?: string[]; prefix?: string[] }>): string {
  if (!name || name.length === 0) return 'Unknown'
  const n = name[0]
  const prefix = n.prefix?.join(' ') || ''
  const given = n.given?.join(' ') || ''
  const family = n.family || ''
  return `${prefix} ${given} ${family}`.trim()
}

function statusColor(status: string): React.CSSProperties {
  if (status === 'active') return { background: '#e8f5e9', color: '#2e7d32' }
  if (status === 'completed') return { background: '#e3f2fd', color: '#1565c0' }
  if (status === 'draft') return { background: '#fff8e1', color: '#f57f17' }
  return { background: '#f5f5f5', color: '#555' }
}

const styles: Record<string, React.CSSProperties> = {
  section: { padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  heading: { fontSize: '1.1rem', marginBottom: '0', color: '#1a1a2e' },
  listBlock: { border: '1px solid #e0e0e0', borderRadius: '6px', overflow: 'hidden' },
  formBlock: { border: '1px solid #e0e0e0', borderRadius: '6px', padding: '1rem' },
  listTitle: { padding: '8px 12px', background: '#f5f5f5', borderBottom: '1px solid #e0e0e0', fontSize: '0.8rem', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' },
  patient: { marginBottom: '1rem', padding: '0.5rem', background: '#e3f2fd', borderRadius: '4px', fontSize: '0.85rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '500px', marginTop: '0.75rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem', fontWeight: 600, color: '#333' },
  input: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' },
  select: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', background: '#fff' },
  textarea: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', resize: 'vertical' },
  btn: { padding: '10px 20px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' },
  error: { color: '#d32f2f', padding: '0.5rem', background: '#ffebee', borderRadius: '4px' },
  success: { marginTop: '1rem', padding: '0.75rem', background: '#e8f5e9', borderRadius: '4px', fontSize: '0.85rem' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' },
  th: { textAlign: 'left', padding: '8px 12px', background: '#fafafa', borderBottom: '1px solid #eee', fontWeight: 600, color: '#555' },
  tr: { borderBottom: '1px solid #f5f5f5' },
  td: { padding: '8px 12px', color: '#333' },
  tdMono: { padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.78rem', color: '#666' },
  tdAction: { padding: '4px 8px', textAlign: 'right', width: '88px', whiteSpace: 'nowrap' },
  badge: { padding: '2px 8px', borderRadius: '10px', fontSize: '0.78rem', fontWeight: 600 },
  jsonBtn: { padding: '2px 7px', fontFamily: 'monospace', fontSize: '0.78rem', background: '#f5f5f5', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', color: '#555', whiteSpace: 'nowrap' },
  useBtn: { padding: '3px 10px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', marginLeft: '4px', whiteSpace: 'nowrap' },
  json: { margin: 0, background: '#0d1117', color: '#79c0ff', padding: '1rem', fontSize: '0.78rem', overflow: 'auto', maxHeight: '400px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
}
