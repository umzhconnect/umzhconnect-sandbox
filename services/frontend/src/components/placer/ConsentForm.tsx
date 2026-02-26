import { useState } from 'react'
import { workflowApi } from '../../api/client'
import { type LogEntry } from '../../hooks/useLog'

interface ConsentFormProps {
  patientId?: string
  serviceRequestId?: string
  onLog: (entries: LogEntry[]) => void
  onCreated?: (consentId: string) => void
}

export function ConsentForm({ patientId, serviceRequestId, onLog, onCreated }: ConsentFormProps) {
  const [performerOrgId, setPerformerOrgId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ id: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!patientId || !serviceRequestId) {
      setError('Patient and ServiceRequest are required.')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const data = await workflowApi.createConsent({
        patient_id: patientId,
        service_request_id: serviceRequestId,
        performer_party_id: 'partyB',
        performer_organization_id: performerOrgId,
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
      <h2 style={styles.heading}>Create Consent</h2>
      <p style={styles.desc}>
        Grant PartyB (fulfiller) access to the ServiceRequest and related clinical data.
      </p>

      {serviceRequestId && (
        <div style={styles.info}>
          ServiceRequest: <code>{serviceRequestId}</code>
        </div>
      )}

      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          Fulfiller Organization ID (partyB)
          <input
            style={styles.input}
            value={performerOrgId}
            onChange={e => setPerformerOrgId(e.target.value)}
            placeholder="Organization ID at partyB"
            required
          />
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <button type="submit" style={styles.btn} disabled={loading}>
          {loading ? 'Creating...' : 'Create Consent'}
        </button>
      </form>

      {result && (
        <div style={styles.success}>
          Consent created: <code>{result.id}</code>
          <br />
          <small>partyB can now read resources referenced by ServiceRequest/{serviceRequestId}</small>
        </div>
      )}
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  section: { padding: '1rem' },
  heading: { fontSize: '1.1rem', marginBottom: '0.5rem', color: '#1a1a2e' },
  desc: { fontSize: '0.85rem', color: '#555', marginBottom: '1rem' },
  info: { marginBottom: '1rem', padding: '0.5rem', background: '#fff8e1', borderRadius: '4px', fontSize: '0.85rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '500px' },
  label: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem', fontWeight: 600, color: '#333' },
  input: { padding: '8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' },
  btn: { padding: '10px 20px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' },
  error: { color: '#d32f2f', padding: '0.5rem', background: '#ffebee', borderRadius: '4px' },
  success: { marginTop: '1rem', padding: '0.75rem', background: '#e8f5e9', borderRadius: '4px', fontSize: '0.85rem' },
}
