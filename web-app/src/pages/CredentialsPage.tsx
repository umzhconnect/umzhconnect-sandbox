import React, { useState, useCallback, useEffect } from 'react';
import JsonViewer from '../components/common/JsonViewer';
import { useLog } from '../contexts/LogContext';
import { useAuth } from '../contexts/AuthContext';
import { importPrivateKey, buildClientAssertion } from '../services/l2-signing';
import type { AssertionParts } from '../services/l2-signing';
import { listMyClients, type OnboardedClient } from '../services/onboarding-api';
import {
  VITE_KEYCLOAK_URL,
  VITE_KEYCLOAK_REALM,
  VITE_REGISTRY_URL,
  VITE_PLACER_EXTERNAL_URL,
  VITE_FULFILLER_EXTERNAL_URL,
} from '../config/env';

type Party = 'placer' | 'fulfiller';
type Level = 'l1' | 'l2';

const KEYCLOAK_TOKEN_URL =
  `${VITE_KEYCLOAK_URL}/realms/${VITE_KEYCLOAK_REALM}/protocol/openid-connect/token`;

const CLIENT_CONFIG = {
  placer: {
    l1: { clientId: 'placer-client', clientSecret: 'placer-secret-2025' },
    l2: { clientId: 'placer-client-l2', keyUrl: '/l2-keys/placer-l2.key', kid: 'placer-l2' },
    orgReference: `${VITE_REGISTRY_URL}/fhir/Organization/HospitalP`,
    label: 'HospitalP (Placer)',
  },
  fulfiller: {
    l1: { clientId: 'fulfiller-client', clientSecret: 'fulfiller-secret-2025' },
    l2: { clientId: 'fulfiller-client-l2', keyUrl: '/l2-keys/fulfiller-l2.key', kid: 'fulfiller-l2' },
    orgReference: `${VITE_REGISTRY_URL}/fhir/Organization/HospitalF`,
    label: 'HospitalF (Fulfiller)',
  },
} as const;

function buildCurlCommand(party: Party, level: Level, tokenUrl: string, ref: string): string {
  const cfg = CLIENT_CONFIG[party];
  const trimmedRef = ref.trim();
  const authDetails = trimmedRef
    ? `\\\n  -d 'authorization_details=[{"type":"umzh-connect-context","identifier":"${trimmedRef}"}]'`
    : '';

  if (level === 'l1') {
    return (
`curl -s -X POST \\
  '${tokenUrl}' \\
  -H 'Content-Type: application/x-www-form-urlencoded' \\
  -d 'grant_type=client_credentials' \\
  -d 'client_id=${cfg.l1.clientId}' \\
  -d 'client_secret=${cfg.l1.clientSecret}'${authDetails}`
    );
  }

  return (
`# Step 1 — sign a client assertion (this page does this in-browser via Web Crypto)
# curl -s -X POST \\
#   '${VITE_PLACER_EXTERNAL_URL.replace('placer', party)}/sign' \\   # key-custodian /sign (demo only)
#   -H 'Content-Type: application/json' \\
#   -d '{"audience":"${tokenUrl}"}'

# Step 2 — exchange assertion for access token
curl -s -X POST \\
  '${tokenUrl}' \\
  -H 'Content-Type: application/x-www-form-urlencoded' \\
  -d 'grant_type=client_credentials' \\
  -d 'client_id=${cfg.l2.clientId}' \\
  -d 'client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer' \\
  -d 'client_assertion=<signed-JWT-from-step-1>'${authDetails}`
  );
}

// ─── My Clients card ──────────────────────────────────────────────────────────

const MyClientsCard: React.FC = () => {
  const { getToken } = useAuth();
  const [clients, setClients]   = useState<OnboardedClient[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const data = await listMyClients(token);
        if (!cancelled) setClients(data);
      } catch {
        // silently ignore — user may have no clients yet
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">My Clients</h3>
        {clients.length === 0 && (
          <a href="/onboarding" className="text-xs text-blue-600 hover:underline">
            Onboard a client →
          </a>
        )}
      </div>

      {clients.length === 0 ? (
        <p className="text-sm text-gray-500">
          No M2M clients onboarded yet. Go to the{' '}
          <a href="/onboarding" className="text-blue-600 hover:underline">Onboarding</a>{' '}
          page to create one.
        </p>
      ) : (
        <div className="space-y-2">
          {clients.map(c => {
            const isOpen = expanded === c.clientId;
            return (
              <div key={c.clientId} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(v => v === c.clientId ? null : c.clientId)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`shrink-0 text-xs font-bold px-1.5 py-0.5 rounded ${
                      c.level === 'l2' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {c.level.toUpperCase()}
                    </span>
                    <span className="font-mono text-sm text-gray-800 truncate">{c.clientId}</span>
                    <span className="text-xs text-gray-400 shrink-0 hidden sm:block">· {c.orgName}</span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 shrink-0 ml-2 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                    <div className="grid grid-cols-1 gap-2 text-xs">
                      {[
                        ['Organisation', c.orgName],
                        ['Client ID', c.clientId],
                        ['Org Reference', c.orgReference],
                        ['Token Endpoint', c.tokenEndpoint],
                        ['Created', new Date(c.createdAt).toLocaleString()],
                      ].map(([label, val]) => (
                        <div key={label} className="flex items-start gap-2">
                          <span className="font-medium text-gray-500 w-32 shrink-0">{label}</span>
                          <code className="font-mono text-gray-700 break-all">{val}</code>
                        </div>
                      ))}
                    </div>

                    {/* curl snippet */}
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">
                        {c.level === 'l1' ? 'curl (fill in your secret)' : 'curl (fill in your signed assertion)'}
                      </p>
                      <pre className="text-xs font-mono bg-gray-900 text-green-300 rounded p-3 whitespace-pre-wrap overflow-x-auto">{
                        c.level === 'l1'
                          ? `curl -s -X POST "${c.tokenEndpoint}" \\\n  -d "grant_type=client_credentials" \\\n  -d "client_id=${c.clientId}" \\\n  -d "client_secret=<YOUR_SECRET>"`
                          : `curl -s -X POST "${c.tokenEndpoint}" \\\n  -d "grant_type=client_credentials" \\\n  -d "client_id=${c.clientId}" \\\n  -d "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \\\n  -d "client_assertion=<YOUR_SIGNED_JWT>"`
                      }</pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────

const CredentialsPage: React.FC = () => {
  const { addLog }                          = useLog();
  const { authenticated }                   = useAuth();
  const [tokenResponse, setTokenResponse]   = useState<Record<string, unknown> | null>(null);
  const [assertionData, setAssertionData]   = useState<AssertionParts | null>(null);
  const [loading, setLoading]               = useState(false);
  const [activeParty, setActiveParty]       = useState<Party>('placer');
  const [activeLevel, setActiveLevel]       = useState<Level>('l1');
  const [contextRef, setContextRef]         = useState('');
  const [copied, setCopied]                 = useState(false);

  // Reset assertion inspector when switching party or level
  const switchParty = (p: Party) => { setActiveParty(p); setAssertionData(null); setTokenResponse(null); };
  const switchLevel = (l: Level) => { setActiveLevel(l); setAssertionData(null); setTokenResponse(null); };

  const copyCurl = useCallback(() => {
    navigator.clipboard.writeText(buildCurlCommand(activeParty, activeLevel, KEYCLOAK_TOKEN_URL, contextRef));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeParty, activeLevel, contextRef]);

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

      {/* User's own onboarded clients */}
      {authenticated && <MyClientsCard />}

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

        {/* curl equivalent */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-500">Equivalent curl command</label>
            <button onClick={copyCurl}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-0.5 rounded border border-gray-200 hover:border-gray-400">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <pre className="p-3 bg-gray-900 text-green-300 rounded text-xs font-mono leading-relaxed whitespace-pre overflow-x-auto">
            {buildCurlCommand(activeParty, activeLevel, KEYCLOAK_TOKEN_URL, contextRef)}
          </pre>
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
                <span className="text-xs text-gray-500 block">JWKS: <a className="underline" href={`${VITE_PLACER_EXTERNAL_URL}/jwks.json`} target="_blank" rel="noreferrer">{VITE_PLACER_EXTERNAL_URL}/jwks.json</a></span>
              </td>
            </tr>
            <tr>
              <td className="py-2 font-mono">fulfiller-client-l2</td>
              <td className="py-2"><span className="badge bg-amber-100 text-amber-800">L2</span></td>
              <td className="py-2">HospitalF</td>
              <td className="py-2 font-mono text-amber-700">
                /l2-keys/fulfiller-l2.key
                <span className="text-xs text-gray-500 block">JWKS: <a className="underline" href={`${VITE_FULFILLER_EXTERNAL_URL}/jwks.json`} target="_blank" rel="noreferrer">{VITE_FULFILLER_EXTERNAL_URL}/jwks.json</a></span>
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
