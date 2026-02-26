import { useEffect, useState } from 'react'
import { fhirApi } from '../../api/client'
import { type LogEntry } from '../../hooks/useLog'

interface PatientListProps {
  onLog: (entries: LogEntry[]) => void
  onSelectPatient?: (patientId: string, patientName: string) => void
}

export function PatientList({ onLog, onSelectPatient }: PatientListProps) {
  const [patients, setPatients] = useState<FhirResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    fhirApi.search('partyA', 'Patient')
      .then(data => {
        onLog(data.log || [])
        const entries = data.result?.entry?.map((e: { resource: FhirResource }) => e.resource) || []
        setPatients(entries)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [onLog])

  if (loading) return <div style={styles.loading}>Loading patients...</div>
  if (error) return <div style={styles.error}>{error}</div>

  return (
    <section style={styles.section}>
      <h2 style={styles.heading}>Patients (partyA)</h2>
      {patients.length === 0 ? (
        <div style={styles.empty}>No patients found. Run "Initialize Sandbox" first.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>DOB</th>
              <th style={styles.th}>Gender</th>
              <th style={styles.th}>ID</th>
            </tr>
          </thead>
          <tbody>
            {patients.map(p => {
              const name = formatName(p.name)
              const pid = p.id || 'unknown'
              return (
                <tr
                  key={pid}
                  style={{
                    ...styles.tr,
                    ...(selectedId === pid ? styles.trSelected : {}),
                  }}
                  onClick={() => {
                    setSelectedId(pid)
                    onSelectPatient?.(pid, name)
                  }}
                >
                  <td style={styles.td}>{name}</td>
                  <td style={styles.td}>{p.birthDate || '—'}</td>
                  <td style={styles.td}>{p.gender || '—'}</td>
                  <td style={styles.tdMono}>{pid}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

interface FhirResource {
  id?: string
  name?: Array<{ family?: string; given?: string[] }>
  birthDate?: string
  gender?: string
}

function formatName(name?: FhirResource['name']): string {
  if (!name || name.length === 0) return 'Unknown'
  const n = name[0]
  const given = n.given?.join(' ') || ''
  const family = n.family || ''
  return `${given} ${family}`.trim()
}

const styles: Record<string, React.CSSProperties> = {
  section: { padding: '1rem' },
  heading: { fontSize: '1.1rem', marginBottom: '0.75rem', color: '#1a1a2e' },
  loading: { padding: '1rem', color: '#666' },
  error: { padding: '1rem', color: '#d32f2f' },
  empty: { padding: '0.5rem', color: '#888', fontStyle: 'italic' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
  th: { textAlign: 'left', padding: '8px 12px', background: '#f5f5f5', borderBottom: '2px solid #ddd', fontWeight: 600 },
  tr: { cursor: 'pointer', transition: 'background 0.1s' },
  trSelected: { background: '#e3f2fd' },
  td: { padding: '8px 12px', borderBottom: '1px solid #eee' },
  tdMono: { padding: '8px 12px', borderBottom: '1px solid #eee', fontFamily: 'monospace', fontSize: '0.8rem', color: '#666' },
}
