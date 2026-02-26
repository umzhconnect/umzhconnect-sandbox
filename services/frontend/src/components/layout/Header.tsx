import { type AuthState } from '../../hooks/useAuth'

type Party = 'partyA' | 'partyB'

interface HeaderProps {
  auth: AuthState
  activeParty: Party
  onPartyChange: (party: Party) => void
}

export function Header({ auth, activeParty, onPartyChange }: HeaderProps) {
  return (
    <header style={styles.header}>
      <div style={styles.brand}>
        <span style={styles.logo}>COW</span>
        <span style={styles.title}>UMZH-Connect Sandbox</span>
      </div>

      {auth.authenticated && (
        <div style={styles.tabs}>
          <button
            style={{
              ...styles.tab,
              ...(activeParty === 'partyA' ? styles.tabActive : {}),
            }}
            onClick={() => onPartyChange('partyA')}
          >
            PartyA — Placer
          </button>
          <button
            style={{
              ...styles.tab,
              ...(activeParty === 'partyB' ? styles.tabActiveB : {}),
            }}
            onClick={() => onPartyChange('partyB')}
          >
            PartyB — Fulfiller
          </button>
        </div>
      )}

      <div style={styles.user}>
        {auth.authenticated ? (
          <>
            <span style={styles.userName}>
              {auth.user?.name || auth.user?.email || 'User'}
            </span>
            <button style={styles.btn} onClick={auth.logout}>
              Logout
            </button>
          </>
        ) : (
          <button style={styles.btn} onClick={auth.login}>
            Login
          </button>
        )}
      </div>
    </header>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 1.5rem',
    height: '56px',
    background: '#1a1a2e',
    color: '#fff',
    borderBottom: '2px solid #16213e',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  brand: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  logo: {
    background: '#0f3460',
    padding: '4px 10px',
    borderRadius: '4px',
    fontWeight: 700,
    fontSize: '0.9rem',
    letterSpacing: '1px',
  },
  title: { fontWeight: 600, fontSize: '1rem', opacity: 0.9 },
  tabs: { display: 'flex', gap: '4px' },
  tab: {
    padding: '6px 16px',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '4px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    fontSize: '0.85rem',
    transition: 'all 0.15s',
  },
  tabActive: {
    background: '#0f3460',
    color: '#fff',
    borderColor: '#4a90e2',
  },
  tabActiveB: {
    background: '#3d0c02',
    color: '#fff',
    borderColor: '#e25252',
  },
  user: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  userName: { fontSize: '0.85rem', opacity: 0.8 },
  btn: {
    padding: '5px 12px',
    background: '#0f3460',
    border: '1px solid #4a90e2',
    borderRadius: '4px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
}
