import { useState, useEffect } from 'react'
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

export function ServiceRequestForm({ patientId, patientName, onLog, onCreated }: ServiceRequestFormProps) {
  const [practitioners, setPractitioners] = useState<FhirOption[]>([])
  const [orgs, setOrgs] = useState<FhirOption[]>([])
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
        const entries: FhirOption[] = (data.result?.entry || []).map((e: { resource: { id: string; name?: Array<{ family?: string; given?: string[] }> } }) => ({
          id: e.resource.id,
          display: formatPractitionerName(e.resource.name),
        }))
        setPractitioners(entries)
        if (entries.length > 0) setPractitionerId(entries[0].id)
      })
      .catch(() => {/* silently ignore — user sees empty dropdown */})

    fhirApi.search('partyB', 'Organization')
      .then(data => {
        const entries: FhirOption[] = (data.result?.entry || []).map((e: { resource: { id: string; name?: string } }) => ({
          id: e.resource.id,
          display: e.resource.name || e.resource.id,
        }))
        setOrgs(entries)
        if (entries.length > 0) setOrgId(entries[0].id)
      })
      .catch(() => {/* silently ignore */})
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
      setResult(data.result)
      onCreated?.(data.result?.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section style={styles.section}>
      <h2 style={styles.heading}>Create ServiceRequest</h2>
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

const styles: Record<string, React.CSSProperties> = {
  section: { padding: '1rem' },
  heading: { fontSize: '1.1rem', marginBottom: '0.75rem', color: '#1a1a2e' },
  patient: { marginBottom: '1rem', padding: '0.5rem', background: '#e3f2fd', borderRadius: '4px' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '500px' },
  label: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem', fontWeight: 600, color: '#333' },
  input: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' },
  select: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', background: '#fff' },
  textarea: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', resize: 'vertical' },
  btn: { padding: '10px 20px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' },
  error: { color: '#d32f2f', padding: '0.5rem', background: '#ffebee', borderRadius: '4px' },
  success: { marginTop: '1rem', padding: '0.75rem', background: '#e8f5e9', borderRadius: '4px', fontSize: '0.85rem' },
}
