import { useState } from 'react'
import { workflowApi } from '../../api/client'
import { type LogEntry } from '../../hooks/useLog'

interface TaskCreationProps {
  serviceRequestId?: string
  onLog: (entries: LogEntry[]) => void
  onCreated?: (taskId: string) => void
}

export function TaskCreation({ serviceRequestId, onLog, onCreated }: TaskCreationProps) {
  const [ownerOrgId, setOwnerOrgId] = useState('')
  const [requesterOrgId, setRequesterOrgId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ id: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      <h2 style={styles.heading}>Create Task at PartyB</h2>
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
          Requester Organization ID (partyA)
          <input
            style={styles.input}
            value={requesterOrgId}
            onChange={e => setRequesterOrgId(e.target.value)}
            placeholder="partyA organization ID"
            required
          />
        </label>
        <label style={styles.label}>
          Owner Organization ID (partyB)
          <input
            style={styles.input}
            value={ownerOrgId}
            onChange={e => setOwnerOrgId(e.target.value)}
            placeholder="partyB organization ID"
            required
          />
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <button type="submit" style={styles.btn} disabled={loading}>
          {loading ? 'Creating...' : 'Create Task at PartyB'}
        </button>
      </form>

      {result && (
        <div style={styles.success}>
          Task created at partyB: <code>{result.id}</code>
        </div>
      )}
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  section: { padding: '1rem' },
  heading: { fontSize: '1.1rem', marginBottom: '0.5rem', color: '#1a1a2e' },
  desc: { fontSize: '0.85rem', color: '#555', marginBottom: '1rem' },
  info: { marginBottom: '1rem', padding: '0.5rem', background: '#e3f2fd', borderRadius: '4px', fontSize: '0.85rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '500px' },
  label: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem', fontWeight: 600, color: '#333' },
  input: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' },
  btn: { padding: '10px 20px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' },
  error: { color: '#d32f2f', padding: '0.5rem', background: '#ffebee', borderRadius: '4px' },
  success: { marginTop: '1rem', padding: '0.75rem', background: '#e8f5e9', borderRadius: '4px', fontSize: '0.85rem' },
}
