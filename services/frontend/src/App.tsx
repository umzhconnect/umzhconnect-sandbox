import { useState, useCallback } from 'react'
import { useAuth } from './hooks/useAuth'
import { useLog, type LogEntry } from './hooks/useLog'
import { Header } from './components/layout/Header'
import { LogPanel } from './components/layout/LogPanel'
import { PatientList } from './components/placer/PatientList'
import { ServiceRequestForm } from './components/placer/ServiceRequestForm'
import { ConsentForm } from './components/placer/ConsentForm'
import { TaskCreation } from './components/placer/TaskCreation'
import { TaskList } from './components/fulfiller/TaskList'
import { TaskDetail } from './components/fulfiller/TaskDetail'
import { onboardingApi } from './api/client'

type Party = 'partyA' | 'partyB'
type PlacerStep = 'patients' | 'service-request' | 'consent' | 'task'

export default function App() {
  const auth = useAuth()
  const { entries: logEntries, addEntries, clearLog } = useLog()

  const [activeParty, setActiveParty] = useState<Party>('partyA')
  const [placerStep, setPlacerStep] = useState<PlacerStep>('patients')

  // Placer workflow state
  const [selectedPatientId, setSelectedPatientId] = useState<string | undefined>()
  const [selectedPatientName, setSelectedPatientName] = useState<string | undefined>()
  const [createdSrId, setCreatedSrId] = useState<string | undefined>()
  const [createdConsentId, setCreatedConsentId] = useState<string | undefined>()

  // Fulfiller state
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>()

  // Onboarding
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)

  const handleLog = useCallback((entries: LogEntry[]) => {
    addEntries(entries)
  }, [addEntries])

  async function handleSeed() {
    setSeeding(true)
    setSeedMsg(null)
    try {
      const data = await onboardingApi.register(auth.user?.email || 'demo@sandbox.local', auth.user?.name)
      addEntries(data.log || [])
      setSeedMsg(`Sandbox initialized! Patient: ${data.resources?.patient || 'created'}`)
    } catch (e) {
      setSeedMsg(`Error: ${e}`)
    } finally {
      setSeeding(false)
    }
  }

  if (auth.loading) {
    return (
      <div style={styles.centered}>
        <div style={styles.spinner} />
        <p style={{ color: '#888' }}>Initializing...</p>
      </div>
    )
  }

  if (!auth.authenticated) {
    return (
      <div style={styles.loginPage}>
        <div style={styles.loginCard}>
          <h1 style={styles.loginTitle}>UMZH-Connect COW Sandbox</h1>
          <p style={styles.loginDesc}>
            Clinical Order Workflow reference implementation.<br />
            Demonstrates the UMZH-Connect FHIR IG with full OAuth 2.0 security.
          </p>
          <button style={styles.loginBtn} onClick={auth.login}>
            Login with Keycloak
          </button>
          <p style={styles.loginHint}>
            Demo credentials: <code>demo@umzh-sandbox.local</code> / <code>demo</code>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.app}>
      <Header auth={auth} activeParty={activeParty} onPartyChange={setActiveParty} />

      <div style={styles.main}>
        <div style={styles.content}>

          {/* Onboarding banner */}
          <div style={styles.onboardingBar}>
            <span style={{ fontSize: '0.85rem', color: '#555' }}>
              Initialize the sandbox with sample FHIR data (Petra Meier, conditions, medications):
            </span>
            <button style={styles.seedBtn} onClick={handleSeed} disabled={seeding}>
              {seeding ? 'Initializing...' : 'Initialize Sandbox'}
            </button>
            {seedMsg && <span style={{ fontSize: '0.8rem', color: seedMsg.startsWith('Error') ? '#d32f2f' : '#2e7d32' }}>{seedMsg}</span>}
          </div>

          {/* PartyA — Placer view */}
          {activeParty === 'partyA' && (
            <div style={styles.partyView}>
              <nav style={styles.stepNav}>
                {(['patients', 'service-request', 'consent', 'task'] as PlacerStep[]).map(step => (
                  <button
                    key={step}
                    style={{
                      ...styles.stepBtn,
                      ...(placerStep === step ? styles.stepBtnActive : {}),
                    }}
                    onClick={() => setPlacerStep(step)}
                  >
                    {STEP_LABELS[step]}
                    {step === 'service-request' && createdSrId && ' ✓'}
                    {step === 'consent' && createdConsentId && ' ✓'}
                  </button>
                ))}
              </nav>

              <div style={styles.stepContent}>
                {placerStep === 'patients' && (
                  <PatientList
                    onLog={handleLog}
                    onSelectPatient={(id, name) => {
                      setSelectedPatientId(id)
                      setSelectedPatientName(name)
                      setPlacerStep('service-request')
                    }}
                  />
                )}
                {placerStep === 'service-request' && (
                  <ServiceRequestForm
                    patientId={selectedPatientId}
                    patientName={selectedPatientName}
                    onLog={handleLog}
                    onCreated={(id) => {
                      setCreatedSrId(id)
                      setPlacerStep('consent')
                    }}
                  />
                )}
                {placerStep === 'consent' && (
                  <ConsentForm
                    patientId={selectedPatientId}
                    serviceRequestId={createdSrId}
                    onLog={handleLog}
                    onCreated={(id) => {
                      setCreatedConsentId(id)
                      setPlacerStep('task')
                    }}
                  />
                )}
                {placerStep === 'task' && (
                  <TaskCreation
                    serviceRequestId={createdSrId}
                    onLog={handleLog}
                    onCreated={() => {
                      setActiveParty('partyB')
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* PartyB — Fulfiller view */}
          {activeParty === 'partyB' && (
            <div style={styles.partyView}>
              <div style={{ display: 'flex', gap: '0', height: '100%' }}>
                <div style={{ flex: '0 0 55%', borderRight: '1px solid #eee', overflowY: 'auto' }}>
                  <TaskList
                    onLog={handleLog}
                    onSelectTask={setSelectedTaskId}
                  />
                </div>
                <div style={{ flex: '0 0 45%', overflowY: 'auto' }}>
                  {selectedTaskId ? (
                    <TaskDetail taskId={selectedTaskId} onLog={handleLog} />
                  ) : (
                    <div style={{ padding: '2rem', color: '#888', textAlign: 'center' }}>
                      Select a task to view details
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <LogPanel entries={logEntries} onClear={clearLog} />
      </div>
    </div>
  )
}

const STEP_LABELS: Record<PlacerStep, string> = {
  patients: '1. Patients',
  'service-request': '2. ServiceRequest',
  consent: '3. Consent',
  task: '4. Task',
}

const styles: Record<string, React.CSSProperties> = {
  app: { display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif' },
  main: { display: 'flex', flex: 1, overflow: 'hidden' },
  content: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  centered: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh' },
  spinner: { width: '40px', height: '40px', border: '3px solid #f3f3f3', borderTop: '3px solid #1a1a2e', borderRadius: '50%', animation: 'spin 1s linear infinite' },

  loginPage: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' },
  loginCard: { background: '#fff', padding: '3rem', borderRadius: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.1)', maxWidth: '420px', width: '100%', textAlign: 'center' },
  loginTitle: { fontSize: '1.5rem', marginBottom: '0.5rem', color: '#1a1a2e' },
  loginDesc: { color: '#555', marginBottom: '2rem', lineHeight: 1.6 },
  loginBtn: { padding: '12px 32px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '1rem', marginBottom: '1rem' },
  loginHint: { fontSize: '0.8rem', color: '#888' },

  onboardingBar: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1.5rem', background: '#fffde7', borderBottom: '1px solid #f0e68c', flexWrap: 'wrap' },
  seedBtn: { padding: '5px 14px', background: '#f57f17', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' },

  partyView: { flex: 1, display: 'flex', flexDirection: 'column' },
  stepNav: { display: 'flex', gap: '4px', padding: '0.75rem 1rem', background: '#fafafa', borderBottom: '1px solid #eee' },
  stepBtn: { padding: '6px 14px', border: '1px solid #ddd', background: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: '#555' },
  stepBtnActive: { background: '#1a1a2e', color: '#fff', borderColor: '#1a1a2e' },
  stepContent: { flex: 1, overflowY: 'auto' },
}
