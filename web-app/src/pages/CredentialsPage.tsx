import React, { useState } from 'react';
import JsonViewer from '../components/common/JsonViewer';
import { useLog } from '../contexts/LogContext';

const CredentialsPage: React.FC = () => {
  const { addLog } = useLog();
  const [tokenResponse, setTokenResponse] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeClient, setActiveClient] = useState<'placer' | 'fulfiller'>('placer');
  const [consentId, setConsentId] = useState('');

  const clients = {
    placer: {
      clientId: 'placer-client',
      clientSecret: 'placer-secret-2025',
      partyId: 'hospitalp',
      label: 'HospitalP (Placer)',
    },
    fulfiller: {
      clientId: 'fulfiller-client',
      clientSecret: 'fulfiller-secret-2025',
      partyId: 'hospitalf',
      label: 'HospitalF (Fulfiller)',
    },
  };

  const handleRequestToken = async () => {
    setLoading(true);
    const client = clients[activeClient];
    try {
      const tokenUrl = 'http://localhost:8180/realms/umzh-connect/protocol/openid-connect/token';

      // Build scope: always include "openid"; if a consentId is provided,
      // append the dynamic scope token "consent:<id>" so the resulting JWT
      // carries `scope: "openid consent:<id>"`. KrakenD propagates the `scope`
      // claim as the X-Scope header and OPA extracts the consent_id from it
      // for fine-grained policy enforcement.
      const scopeValue = consentId.trim()
        ? `openid consent:${consentId.trim()}`
        : 'openid';

      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: client.clientId,
        client_secret: client.clientSecret,
        scope: scopeValue,
      });

      addLog({
        type: 'request',
        method: 'POST',
        url: tokenUrl,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: Object.fromEntries(body),
      });

      const start = Date.now();
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const duration = Date.now() - start;

      const data = await response.json();

      addLog({
        type: response.ok ? 'response' : 'error',
        method: 'POST',
        url: tokenUrl,
        status: response.status,
        body: data,
        duration,
      });

      setTokenResponse(data);

      // Decode JWT payload for display
      if (data.access_token) {
        const parts = data.access_token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          setTokenResponse({ ...data, _decoded_payload: payload });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token request failed';
      addLog({ type: 'error', message });
      setTokenResponse({ error: message });
    } finally {
      setLoading(false);
    }
  };

  const client = clients[activeClient];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Credentials & Tokens</h2>
        <p className="text-gray-500 mt-1">
          Manage client credentials and test OAuth2 client credentials flow (Level 1).
        </p>
      </div>

      {/* Client Selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveClient('placer')}
          className={activeClient === 'placer' ? 'btn-primary' : 'btn-secondary'}
        >
          Placer Client
        </button>
        <button
          onClick={() => setActiveClient('fulfiller')}
          className={activeClient === 'fulfiller' ? 'btn-success' : 'btn-secondary'}
        >
          Fulfiller Client
        </button>
      </div>

      {/* Client Details */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">{client.label} - Client Credentials</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Client ID</label>
            <code className="block p-2 bg-gray-100 rounded font-mono text-sm">{client.clientId}</code>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Client Secret</label>
            <code className="block p-2 bg-gray-100 rounded font-mono text-sm">{client.clientSecret}</code>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Party ID</label>
            <code className="block p-2 bg-gray-100 rounded font-mono text-sm">{client.partyId}</code>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Security Level</label>
            <code className="block p-2 bg-gray-100 rounded font-mono text-sm">Level 1 (shared secret)</code>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Token Endpoint</label>
            <code className="block p-2 bg-gray-100 rounded font-mono text-xs break-all">
              http://localhost:8180/realms/umzh-connect/protocol/openid-connect/token
            </code>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Grant Type</label>
            <code className="block p-2 bg-gray-100 rounded font-mono text-sm">client_credentials</code>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Consent ID{' '}
              <span className="font-normal text-gray-400">(optional — adds <code>consent:&lt;id&gt;</code> dynamic scope)</span>
            </label>
            <input
              type="text"
              value={consentId}
              onChange={(e) => setConsentId(e.target.value)}
              placeholder="e.g. ConsentOrthopedicReferral"
              className="block w-full p-2 border border-gray-300 rounded font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {consentId.trim() && (
              <p className="mt-1 text-xs text-blue-600">
                Scope will be:{' '}
                <code className="bg-blue-50 px-1 rounded">openid consent:{consentId.trim()}</code>
                {' '}→ JWT <code>scope</code> claim will carry the consent ID for policy enforcement.
              </p>
            )}
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={handleRequestToken}
            disabled={loading}
            className="btn-primary disabled:opacity-50"
          >
            {loading ? 'Requesting...' : 'Request Access Token'}
          </button>
        </div>
      </div>

      {/* Token Response */}
      {tokenResponse && (
        <JsonViewer data={tokenResponse} title="Token Response (with decoded payload)" />
      )}

      {/* Security Levels Info */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Security Levels</h3>
        <div className="space-y-3">
          {[
            {
              level: 'Level 1',
              name: 'Basic Client Credentials',
              desc: 'Shared secret. Sandbox, PoC, early pilots.',
              active: true,
            },
            {
              level: 'Level 2',
              name: 'private_key_jwt',
              desc: 'Asymmetric keys, no shared secrets. Production default.',
              active: false,
            },
            {
              level: 'Level 3',
              name: 'mTLS',
              desc: 'Mutual TLS with sender-constrained tokens. Highest assurance.',
              active: false,
            },
          ].map((lvl) => (
            <div
              key={lvl.level}
              className={`p-3 rounded-lg border ${
                lvl.active ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded ${
                    lvl.active ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'
                  }`}
                >
                  {lvl.level}
                </span>
                <span className="font-medium text-sm">{lvl.name}</span>
                {lvl.active && (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1 ml-14">{lvl.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Users */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Sandbox Users</h3>
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
