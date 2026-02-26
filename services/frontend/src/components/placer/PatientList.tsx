import { useEffect, useState, Fragment } from 'react'
import { fhirApi } from '../../api/client'
import { type LogEntry } from '../../hooks/useLog'

interface PatientListProps {
  onLog: (entries: LogEntry[]) => void
  onSelectPatient?: (patientId: string, patientName: string) => void
}

type FhirResource = Record<string, unknown>

function formatName(name?: Array<{ family?: string; given?: string[] }>): string {
  if (!name || name.length === 0) return 'Unknown'
  const n = name[0]
  const given = n.given?.join(' ') || ''
  const family = n.family || ''
  return `${given} ${family}`.trim()
}

export function PatientList({ onLog, onSelectPatient }: PatientListProps) {
  const [patients, setPatients] = useState<FhirResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fhirApi.search('partyA', 'Patient')
      .then(data => {
        onLog(data.log || [])
        const entries: FhirResource[] = data.result?.entry?.map((e: { resource: FhirResource }) => e.resource) || []
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
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {patients.map(p => {
              const name = formatName(p.name as Array<{ family?: string; given?: string[] }> | undefined)
              const pid = (p.id as string) || 'unknown'
              const isExpanded = expandedId === pid
              return (
                <Fragment key={pid}>
                  <tr
                    style={{ ...styles.tr, ...(selectedId === pid ? styles.trSelected : {}) }}
                    onClick={() => { setSelectedId(pid); onSelectPatient?.(pid, name) }}
                  >
                    <td style={styles.td}>{name}</td>
                    <td style={styles.td}>{(p.birthDate as string) || '—'}</td>
                    <td style={styles.td}>{(p.gender as string) || '—'}</td>
                    <td style={styles.tdMono}>{pid}</td>
                    <td style={styles.tdAction} onClick={e => { e.stopPropagation(); setExpandedId(isExpanded ? null : pid) }}>
                      <button style={styles.jsonBtn}>{isExpanded ? '×' : '{ }'}</button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <pre style={styles.json}>{JSON.stringify(p, null, 2)}</pre>
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
  tdAction: { padding: '4px 8px', borderBottom: '1px solid #eee', textAlign: 'right', width: '56px' },
  jsonBtn: { padding: '2px 7px', fontFamily: 'monospace', fontSize: '0.78rem', background: '#f5f5f5', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', color: '#555', whiteSpace: 'nowrap' },
  json: { margin: 0, background: '#0d1117', color: '#79c0ff', padding: '1rem', fontSize: '0.78rem', overflow: 'auto', maxHeight: '400px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
}
