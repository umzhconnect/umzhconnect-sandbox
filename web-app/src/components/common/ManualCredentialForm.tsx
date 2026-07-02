import React from 'react';

export type ManualLevel = 'l1' | 'l2';

export interface ManualCredential {
  level:        ManualLevel;
  clientId:     string;
  clientSecret: string;  // L1
  assertion:    string;  // L2 — pre-signed client_assertion JWT
}

export const EMPTY_MANUAL_CREDENTIAL: ManualCredential = {
  level: 'l1', clientId: '', clientSecret: '', assertion: '',
};

export function manualCredIsReady(cred: ManualCredential): boolean {
  if (!cred.clientId) return false;
  return cred.level === 'l1' ? !!cred.clientSecret : !!cred.assertion;
}

export async function acquireTokenWithCredential(
  tokenUrl: string,
  cred: ManualCredential,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id:  cred.clientId,
  });
  if (cred.level === 'l1') {
    body.set('client_secret', cred.clientSecret);
  } else {
    body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    body.set('client_assertion', cred.assertion);
  }
  const res  = await fetch(tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `Token request failed (${res.status})`);
  return data.access_token as string;
}

// ─── Toggle switch ──────────────────────────────────────────────────────────

interface ToggleProps {
  enabled:   boolean;
  onToggle:  () => void;
  ready:     boolean;
  level:     ManualLevel;
}

export const ManualClientToggle: React.FC<ToggleProps> = ({ enabled, onToggle, ready, level }) => (
  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
    <span
      onClick={onToggle}
      className={`relative inline-block w-9 h-5 rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : ''}`} />
    </span>
    <span onClick={onToggle} className="text-sm font-medium text-gray-700">
      Set client manually
    </span>
    {enabled && ready && (
      <span className="text-xs text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
        {level.toUpperCase()} active
      </span>
    )}
    {enabled && !ready && (
      <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
        incomplete
      </span>
    )}
  </label>
);

// ─── Credential form ────────────────────────────────────────────────────────

interface FormProps {
  cred:     ManualCredential;
  onChange: (cred: ManualCredential) => void;
}

const ManualCredentialForm: React.FC<FormProps> = ({ cred, onChange }) => {
  const set = (field: keyof ManualCredential) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...cred, [field]: e.target.value });

  return (
    <div className="mt-3 bg-white border border-blue-200 rounded-xl p-4 space-y-4">
      {/* Level toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-600 shrink-0">Auth level:</span>
        {(['l1', 'l2'] as const).map(lvl => (
          <button
            key={lvl}
            type="button"
            onClick={() => onChange({ ...cred, level: lvl })}
            className={`px-3 py-1 text-xs font-medium rounded-md border transition-colors ${
              cred.level === lvl
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            {lvl === 'l1' ? 'L1 — client_secret' : 'L2 — signed assertion'}
          </button>
        ))}
      </div>

      {/* Client ID */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Client ID <span className="text-red-500">*</span>
        </label>
        <input
          value={cred.clientId}
          onChange={set('clientId')}
          placeholder="e.g. my-org-l1-abc123"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* L1: secret */}
      {cred.level === 'l1' && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Client secret <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            value={cred.clientSecret}
            onChange={set('clientSecret')}
            placeholder="Paste your client secret"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* L2: pre-signed assertion */}
      {cred.level === 'l2' && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Client assertion{' '}
            <span className="text-xs font-normal text-gray-400">(signed JWT)</span>{' '}
            <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={3}
            value={cred.assertion}
            onChange={set('assertion')}
            placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…"
            className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            Sign a JWT (iss=sub=clientId, aud=token endpoint, exp=now+60s) with your private key.
            Use the{' '}
            <a href="/credentials" className="text-blue-500 hover:underline">Credentials page</a>
            {' '}L2 flow to build one in-browser.
          </p>
        </div>
      )}
    </div>
  );
};

export default ManualCredentialForm;
