import React, { useState } from 'react';
import JsonViewer from '../components/common/JsonViewer';
import { useLog } from '../contexts/LogContext';

type Party = 'placer' | 'fulfiller';
type Level = 'l1' | 'l2';

const KEYCLOAK_TOKEN_URL =
  'http://localhost:8180/realms/umzh-connect/protocol/openid-connect/token';

const CLIENT_CONFIG = {
  placer: {
    l1: { clientId: 'placer-client', clientSecret: 'placer-secret-2025' },
    l2: { clientId: 'placer-client-l2', keyUrl: '/l2-keys/placer-l2.key', kid: 'placer-l2' },
    orgReference: 'http://localhost:8084/fhir/Organization/HospitalP',
    label: 'HospitalP (Placer)',
  },
  fulfiller: {
    l1: { clientId: 'fulfiller-client', clientSecret: 'fulfiller-secret-2025' },
    l2: { clientId: 'fulfiller-client-l2', keyUrl: '/l2-keys/fulfiller-l2.key', kid: 'fulfiller-l2' },
    orgReference: 'http://localhost:8084/fhir/Organization/HospitalF',
    label: 'HospitalF (Fulfiller)',
  },
} as const;

// ─── Web Crypto helpers ────────────────────────────────────────────────────────

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlStr(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );
}

interface AssertionParts {
  header:  { typ: string; alg: string; kid?: string };
  payload: { iss: string; sub: string; aud: string; exp: number; jti: string };
  jwt:     string;
}

async function buildClientAssertion(
  clientId: string,
  audience: string,
  key: CryptoKey,
  kid?: string,
): Promise<AssertionParts> {
  // kid links this signed assertion to a specific JWK in the JWKS that
  // Keycloak fetches from the client's jwks.url. With one key per client
  // today it's not strictly required, but it's the linkage that makes
  // overlap-window rotation work.
  const headerObj  = kid
    ? { typ: 'JWT', alg: 'RS256', kid }
    : { typ: 'JWT', alg: 'RS256' };
  const now        = Math.floor(Date.now() / 1000);
  const payloadObj = {
    iss: clientId,
    sub: clientId,
    aud: audience,
    exp: now + 60,
    jti: `${now}-${Math.random().toString(36).slice(2)}`,
  };

  const header  = base64urlStr(JSON.stringify(headerObj));
  const payload = base64urlStr(JSON.stringify(payloadObj));
  const sigInput  = `${header}.${payload}`;
  const sigBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput),
  );
  return {
    header:  headerObj,
    payload: payloadObj,
    jwt:     `${sigInput}.${base64url(sigBuffer)}`,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

const CredentialsPage: React.FC = () => {
  const { addLog } = useLog();
  const [tokenResponse, setTokenResponse]   = useState<Record<string, unknown> | null>(null);
  const [assertionData, setAssertionData]   = useState<AssertionParts | null>(null);
  const [loading, setLoading]               = useState(false);
  const [activeParty, setActiveParty]       = useState<Party>('placer');
  const [activeLevel, setActiveLevel]       = useState<Level>('l1');
  const [contextRef, setContextRef]         = useState('');

  // Reset assertion inspector when switching party or level
  const switchParty = (p: Party) => { setActiveParty(p); setAssertionData(null); setTokenResponse(null); };
  const switchLevel = (l: Level) => { setActiveLevel(l); setAssertionData(null); setTokenResponse(null); };

  const handleRequestToken = async () => {
    setLoading(true);
    setAssertionData(null);
    const cfg = CLIENT_CONFIG[activeParty];
    const ref = contextRef.trim();

    try {
      let data: Record<string, unknown>;

      if (activeLevel === 'l1') {
        // M2M flow — no `openid` scope. There's no user to attest to and no
        // meaningful ID token in client_credentials. The token's system/*
        // scopes come from the client's defaultClientScopes in Keycloak.
        const body = new URLSearchParams({
          grant_type:    'client_credentials',
          client_id:     cfg.l1.clientId,
          client_secret: cfg.l1.clientSecret,
        });
        if (ref) body.set('authorization_details',
          JSON.stringify([{ type: 'umzh-connect-context', identifier: ref }]));

        addLog({ type: 'request', method: 'POST', url: KEYCLOAK_TOKEN_URL,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: Object.fromEntries(body) });

        const t0  = Date.now();
        const res = await fetch(KEYCLOAK_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        data = await res.json();
        addLog({ type: res.ok ? 'response' : 'error', method: 'POST',
          url: KEYCLOAK_TOKEN_URL, status: res.status, body: data,
          duration: Date.now() - t0 });

      } else {
        // L2: fetch key → Web Crypto sign → POST to Keycloak with client_assertion
        const keyUrl = cfg.l2.keyUrl;
        addLog({ type: 'request', method: 'GET', url: keyUrl, headers: {}, body: null });
        const keyRes = await fetch(keyUrl);
        if (!keyRes.ok) throw new Error(`Failed to fetch private key: ${keyRes.status}`);
        const pem = await keyRes.text();
        addLog({ type: 'response', method: 'GET', url: keyUrl, status: keyRes.status,
          body: { note: 'RSA-2048 private key (PEM)' }, duration: 0 });

        const cryptoKey = await importPrivateKey(pem);
        const assertion = await buildClientAssertion(cfg.l2.clientId, KEYCLOAK_TOKEN_URL, cryptoKey, cfg.l2.kid);
        setAssertionData(assertion);

        // Same as L1: M2M, no `openid` scope.
        const body = new URLSearchParams({
          grant_type:            'client_credentials',
          client_id:             cfg.l2.clientId,
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion:      assertion.jwt,
        });
        if (ref) body.set('authorization_details',
          JSON.stringify([{ type: 'umzh-connect-context', identifier: ref }]));

        addLog({ type: 'request', method: 'POST', url: KEYCLOAK_TOKEN_URL,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: {
            grant_type:            'client_credentials',
            client_id:             cfg.l2.clientId,
            client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
            client_assertion:      `${assertion.jwt.slice(0, 40)}… (RS256-signed JWT)`,
            ...(ref ? { authorization_details: '…' } : {}),
          },
        });

        const t0  = Date.now();
        const res = await fetch(KEYCLOAK_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        data = await res.json();
        addLog({ type: res.ok ? 'response' : 'error', method: 'POST',
          url: KEYCLOAK_TOKEN_URL, status: res.status, body: data,
          duration: Date.now() - t0 });
      }

      if (data.access_token && typeof data.access_token === 'string') {
        const parts = data.access_token.split('.');
        if (parts.length === 3) {
          const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          data = { ...data, _decoded_payload: p };
        }
      }
      setTokenResponse(data);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token request failed';
      addLog({ type: 'error', message });
      setTokenResponse({ error: message });
    } finally {
      setLoading(false);
    }
  };

  const cfg  = CLIENT_CONFIG[activeParty];
  const isL2 = activeLevel === 'l2';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Credentials & Tokens</h2>
        <p className="text-gray-500 mt-1">
          Demonstrate OAuth2 client credentials — L1 (shared secret) and L2 (<code>private_key_jwt</code>).
          Both call Keycloak directly; L2 signs a client-assertion JWT in the browser via Web Crypto API.
        </p>
      </div>

      {/* Party + Level selectors */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-2">
          <button onClick={() => switchParty('placer')}
            className={activeParty === 'placer' ? 'btn-primary' : 'btn-secondary'}>
            Placer
          </button>
          <button onClick={() => switchParty('fulfiller')}
            className={activeParty === 'fulfiller' ? 'btn-success' : 'btn-secondary'}>
            Fulfiller
          </button>
        </div>
        <div className="w-px h-6 bg-gray-200" />
        <div className="flex gap-2">
          <button onClick={() => switchLevel('l1')}
            className={activeLevel === 'l1' ? 'btn-primary' : 'btn-secondary'}>
            Level 1 — client_secret
          </button>
          <button onClick={() => switchLevel('l2')}
            className={activeLevel === 'l2' ? 'btn-primary' : 'btn-secondary'}>
            Level 2 — private_key_jwt
          </button>
        </div>
      </div>

      {/* Client Details */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">
          {cfg.label} — {isL2 ? 'Level 2 (private_key_jwt)' : 'Level 1 (client_secret)'}
        </h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Client ID</label>
            <code className="block p-2 bg-gray-100 rounded font-mono text-sm">
              {isL2 ? cfg.l2.clientId : cfg.l1.clientId}
            </code>
          </div>
          <div>
            {isL2 ? (
              <>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Private Key
                </label>
                <code className="block p-2 bg-gray-100 rounded font-mono text-xs text-amber-700">
                  {cfg.l2.keyUrl}
                </code>
              </>
            ) : (
              <>
                <label className="block text-xs font-medium text-gray-500 mb-1">Client Secret</label>
                <code className="block p-2 bg-gray-100 rounded font-mono text-sm">
                  {cfg.l1.clientSecret}
                </code>
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Client Auth Method</label>
            <code className="block p-2 bg-gray-100 rounded font-mono text-sm">
              {isL2 ? 'private_key_jwt (RFC 7523)' : 'client_secret_basic'}
            </code>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Organization Reference</label>
            <code className="block p-2 bg-gray-100 rounded font-mono text-xs break-all">
              {cfg.orgReference}
            </code>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Token Endpoint</label>
            <code className="block p-2 bg-gray-100 rounded font-mono text-xs break-all">
              {KEYCLOAK_TOKEN_URL}
            </code>
          </div>

          {/* Token request body — side-by-side comparison */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-2">Token Request Body</label>
            <div className={`grid gap-3 ${isL2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {/* L1 column (always shown) */}
              <div className={isL2 ? 'opacity-40' : ''}>
                {isL2 && <p className="text-xs text-gray-400 mb-1">L1 (for comparison)</p>}
                <pre className="p-3 bg-gray-100 rounded text-xs font-mono leading-relaxed whitespace-pre-wrap">{
`grant_type=client_credentials
client_id=${cfg.l1.clientId}
client_secret=${cfg.l1.clientSecret}`
                }</pre>
              </div>
              {/* L2 column */}
              {isL2 && (
                <div>
                  <p className="text-xs text-amber-700 font-medium mb-1">L2 (active)</p>
                  <pre className="p-3 bg-amber-50 border border-amber-200 rounded text-xs font-mono leading-relaxed whitespace-pre-wrap text-amber-900">{
`grant_type=client_credentials
client_id=${cfg.l2.clientId}
client_assertion_type=
  urn:ietf:params:oauth:
  client-assertion-type:jwt-bearer
client_assertion=<signed JWT ↓>`
                  }</pre>
                </div>
              )}
            </div>
          </div>

          {/* Context Reference */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Context Reference
              <span className="font-normal text-gray-400 ml-1">
                (optional — <code>ResourceType/id</code>, adds RFC 9396 <code>authorization_details</code>)
              </span>
            </label>
            <input
              type="text"
              value={contextRef}
              onChange={e => setContextRef(e.target.value)}
              placeholder="e.g. ServiceRequest/ReferralOrthopedicSurgery"
              className="block w-full p-2 border border-gray-300 rounded font-mono text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {contextRef.trim() && (
              <p className="mt-1 text-xs text-blue-600">
                Adds{' '}
                <code className="bg-blue-50 px-1 rounded">
                  {`[{"type":"umzh-connect-context","identifier":"${contextRef.trim()}"}]`}
                </code>
                {' '}→ JWT will carry <code>fhirContext</code> claim for OPA consent lookup.
              </p>
            )}
          </div>
        </div>

        <div className="mt-4">
          <button onClick={handleRequestToken} disabled={loading}
            className="btn-primary disabled:opacity-50">
            {loading ? 'Requesting…' : 'Request Access Token'}
          </button>
        </div>
      </div>

      {/* L2 — decoded assertion inspector (shown after request) */}
      {isL2 && assertionData && (
        <div className="card border-amber-200">
          <h3 className="text-lg font-semibold mb-1 text-amber-800">
            Client Assertion JWT — Signed &amp; Sent
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            This is the exact JWT the browser constructed and sent as{' '}
            <code>client_assertion</code>. Keycloak verified its RS256 signature
            against the registered public key and accepted it as proof of client identity.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <JsonViewer data={assertionData.header}  title="Header" />
            <JsonViewer data={assertionData.payload} title="Payload (claims)" />
          </div>
          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Compact serialisation — <code>base64url(header).base64url(payload).signature</code>
            </label>
            <code className="block p-2 bg-gray-100 rounded font-mono text-xs break-all text-gray-500">
              {assertionData.jwt}
            </code>
          </div>
        </div>
      )}

      {/* Token Response */}
      {tokenResponse && (
        <JsonViewer data={tokenResponse} title="Token Response (with decoded payload)" />
      )}

      {/* Security Levels */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Security Levels</h3>
        <div className="space-y-3">
          {[
            { level: 'Level 1', name: 'client_secret',   desc: 'Shared secret. Sandbox, PoC, early pilots.',                          active: true  },
            { level: 'Level 2', name: 'private_key_jwt', desc: 'Asymmetric keys, no shared secret. Production baseline (RFC 7523).', active: true  },
            { level: 'Level 3', name: 'mTLS',            desc: 'Mutual TLS with sender-constrained tokens. Highest assurance.',       active: false },
          ].map(lvl => (
            <div key={lvl.level}
              className={`p-3 rounded-lg border ${lvl.active ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${lvl.active ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'}`}>
                  {lvl.level}
                </span>
                <span className="font-medium text-sm">{lvl.name}</span>
                {lvl.active && (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Active</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1 ml-14">{lvl.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* M2M Clients reference */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">M2M Clients</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b">
              <th className="pb-2">Client ID</th>
              <th className="pb-2">Level</th>
              <th className="pb-2">Party</th>
              <th className="pb-2">Credential</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="py-2 font-mono">placer-client</td>
              <td className="py-2"><span className="badge bg-blue-100 text-blue-800">L1</span></td>
              <td className="py-2">HospitalP</td>
              <td className="py-2 font-mono text-gray-600">placer-secret-2025</td>
            </tr>
            <tr>
              <td className="py-2 font-mono">fulfiller-client</td>
              <td className="py-2"><span className="badge bg-green-100 text-green-800">L1</span></td>
              <td className="py-2">HospitalF</td>
              <td className="py-2 font-mono text-gray-600">fulfiller-secret-2025</td>
            </tr>
            <tr>
              <td className="py-2 font-mono">placer-client-l2</td>
              <td className="py-2"><span className="badge bg-amber-100 text-amber-800">L2</span></td>
              <td className="py-2">HospitalP</td>
              <td className="py-2 font-mono text-amber-700">
                /l2-keys/placer-l2.key
                <span className="text-xs text-gray-500 block">JWKS: <a className="underline" href="http://localhost:8081/jwks.json" target="_blank" rel="noreferrer">localhost:8081/jwks.json</a></span>
              </td>
            </tr>
            <tr>
              <td className="py-2 font-mono">fulfiller-client-l2</td>
              <td className="py-2"><span className="badge bg-amber-100 text-amber-800">L2</span></td>
              <td className="py-2">HospitalF</td>
              <td className="py-2 font-mono text-amber-700">
                /l2-keys/fulfiller-l2.key
                <span className="text-xs text-gray-500 block">JWKS: <a className="underline" href="http://localhost:8083/jwks.json" target="_blank" rel="noreferrer">localhost:8083/jwks.json</a></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Web App Users */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Web App Users</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b">
              <th className="pb-2">Username</th>
              <th className="pb-2">Password</th>
              <th className="pb-2">Role</th>
              <th className="pb-2">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="py-2 font-mono">placer-user</td>
              <td className="py-2 font-mono">placer123</td>
              <td className="py-2"><span className="badge bg-blue-100 text-blue-800">Placer</span></td>
              <td className="py-2 text-gray-500">placer@hospitalp.example.org</td>
            </tr>
            <tr>
              <td className="py-2 font-mono">fulfiller-user</td>
              <td className="py-2 font-mono">fulfiller123</td>
              <td className="py-2"><span className="badge bg-green-100 text-green-800">Fulfiller</span></td>
              <td className="py-2 text-gray-500">fulfiller@hospitalf.example.org</td>
            </tr>
            <tr>
              <td className="py-2 font-mono">admin-user</td>
              <td className="py-2 font-mono">admin123</td>
              <td className="py-2"><span className="badge bg-purple-100 text-purple-800">Admin</span></td>
              <td className="py-2 text-gray-500">admin@umzh.example.org</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CredentialsPage;
