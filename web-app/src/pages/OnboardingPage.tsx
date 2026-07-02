import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  registerUser,
  createInvite,
  createClient,
  listMyOrganisations,
  listOrgHealthcareServices,
  addHealthcareService,
  type CreateClientResponse,
  type InviteResponse,
  type MyOrganisation,
  type HealthcareService,
} from '../services/onboarding-api';

// ─── Healthcare service type catalogue ───────────────────────────────────────

const HC_SERVICE_TYPES = [
  { code: '124', display: 'General Practice' },
  { code: '147', display: 'Pathology / Laboratory' },
  { code: '177', display: 'Pharmacy' },
  { code: '310', display: 'Diagnostic Imaging / Radiology' },
  { code: '411', display: 'Surgical' },
  { code: '27',  display: 'Specialist — Cardiology' },
  { code: '52',  display: 'Specialist — Neurology' },
  { code: '276', display: 'Specialist — Orthopaedics' },
] as const;

// ─── Registration form ────────────────────────────────────────────────────────

const RegistrationPanel: React.FC = () => {
  const { login } = useAuth();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', inviteToken: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await registerUser(form);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Account created</h2>
        <p className="text-sm text-gray-600">
          Your sandbox account is ready. You can now log in and onboard your own M2M client.
        </p>
        <button
          onClick={login}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          Log in
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-10">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Request sandbox access</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create a sandbox account with full read/write access to both Placer and Fulfiller.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">First name</label>
              <input
                required
                value={form.firstName}
                onChange={set('firstName')}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Last name</label>
              <input
                required
                value={form.lastName}
                onChange={set('lastName')}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              required
              type="email"
              value={form.email}
              onChange={set('email')}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
            <input
              required
              type="password"
              minLength={8}
              value={form.password}
              onChange={set('password')}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Invite token</label>
            <input
              required
              placeholder="Paste the token you received"
              value={form.inviteToken}
              onChange={set('inviteToken')}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <p className="mt-1 text-xs text-gray-400">
              Issued by a sandbox admin — single-use, valid for 48 hours.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-xs text-center text-gray-500">
          Already have an account?{' '}
          <button onClick={login} className="text-blue-600 hover:underline">
            Log in
          </button>
        </p>
      </div>
    </div>
  );
};

// ─── Result card ──────────────────────────────────────────────────────────────

const CopyField: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500 mb-1">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className={`flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded text-sm break-all ${mono ? 'font-mono' : ''}`}>
          {value}
        </span>
        <button
          onClick={copy}
          title="Copy"
          className="shrink-0 p-1.5 text-gray-400 hover:text-gray-700 rounded"
        >
          {copied
            ? <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2-2v8a2 2 0 002 2z" /></svg>
          }
        </button>
      </dd>
    </div>
  );
};

const ResultCard: React.FC<{ result: CreateClientResponse; onReset: () => void }> = ({ result, onReset }) => (
  <div className="max-w-2xl mx-auto space-y-6">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
        <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Client onboarded</h2>
        <p className="text-sm text-gray-500">{result.orgName} · {result.level.toUpperCase()}</p>
      </div>
    </div>

    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      <dl className="space-y-4">
        <CopyField label="Client ID"                  value={result.clientId}    mono />
        {result.clientSecret && (
          <CopyField label="Client Secret"            value={result.clientSecret} mono />
        )}
        {result.jwksUrl && (
          <CopyField label="JWKS URL (configured)"   value={result.jwksUrl}     mono />
        )}
        <CopyField label="Organisation reference"     value={result.orgReference} mono />
        <CopyField label="Token endpoint"             value={result.tokenEndpoint} mono />
      </dl>
    </div>

    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
      <strong>Note:</strong> The token your client obtains carries both{' '}
      <code className="font-mono">placer</code> and{' '}
      <code className="font-mono">fulfiller</code> realm roles, so it can call
      either party's external gateway. The{' '}
      <code className="font-mono">organization_reference</code> claim is set to
      your registry organisation URL above.
    </div>

    {result.level === 'l1' && (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-600 mb-2">L1 token request (curl)</p>
        <pre className="text-xs font-mono text-gray-800 whitespace-pre-wrap break-all">{
`curl -s -X POST "${result.tokenEndpoint}" \\
  -d "grant_type=client_credentials" \\
  -d "client_id=${result.clientId}" \\
  -d "client_secret=${result.clientSecret}"`
        }</pre>
      </div>
    )}

    {result.level === 'l2' && (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-600 mb-2">L2 token request (curl)</p>
        <pre className="text-xs font-mono text-gray-800 whitespace-pre-wrap">{
`# 1. Build a private_key_jwt assertion signed with your private key
# 2. POST the assertion:
curl -s -X POST "${result.tokenEndpoint}" \\
  -d "grant_type=client_credentials" \\
  -d "client_id=${result.clientId}" \\
  -d "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \\
  -d "client_assertion=<YOUR_SIGNED_JWT>"`
        }</pre>
      </div>
    )}

    <button
      onClick={onReset}
      className="text-sm text-blue-600 hover:underline"
    >
      Onboard another client
    </button>
  </div>
);

// ─── Admin: invite token generator ───────────────────────────────────────────

const InvitePanel: React.FC = () => {
  const { getToken } = useAuth();
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [invite, setInvite]     = useState<InviteResponse | null>(null);
  const [copied, setCopied]     = useState(false);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setInvite(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('No auth token');
      setInvite(await createInvite(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invite');
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!invite) return;
    navigator.clipboard.writeText(invite.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="max-w-xl mx-auto mb-8 bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Generate invite token</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Create a single-use token to share with a new sandbox user.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {invite && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded text-xs font-mono break-all">
              {invite.token}
            </code>
            <button
              onClick={copy}
              title="Copy token"
              className="shrink-0 p-1.5 text-gray-400 hover:text-gray-700 rounded"
            >
              {copied
                ? <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2-2v8a2 2 0 002 2z" /></svg>
              }
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Expires <span className="font-medium">{new Date(invite.expiresAt).toLocaleString()}</span> · single-use
          </p>
        </div>
      )}
    </div>
  );
};

// ─── Healthcare services panel ────────────────────────────────────────────────

const HealthcareServicesPanel: React.FC<{ org: MyOrganisation }> = ({ org }) => {
  const { getToken } = useAuth();
  const [services, setServices]     = useState<HealthcareService[]>([]);
  const [loading, setLoading]       = useState(true);
  const [adding, setAdding]         = useState(false);
  const [showForm, setShowForm]     = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [form, setForm]             = useState<{ name: string; typeCode: string }>({ name: '', typeCode: HC_SERVICE_TYPES[0].code });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const svcs = await listOrgHealthcareServices(org.orgId, token);
        if (!cancelled) setServices(svcs);
      } catch {
        // ignore — org may have no services yet
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [org.orgId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('No auth token');
      const type    = HC_SERVICE_TYPES.find(t => t.code === form.typeCode)!;
      const created = await addHealthcareService(
        org.orgId,
        { name: form.name, typeCode: type.code, typeDisplay: type.display },
        token,
      );
      setServices(prev => [...prev, created]);
      setForm({ name: '', typeCode: HC_SERVICE_TYPES[0].code });
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add service');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="mt-4 border border-gray-100 rounded-lg bg-gray-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Healthcare Services
        </h3>
        <button
          onClick={() => setShowForm(v => !v)}
          className="text-xs text-blue-600 hover:underline"
        >
          {showForm ? 'Cancel' : '+ Add service'}
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : services.length === 0 ? (
        <p className="text-xs text-gray-400">No services registered yet.</p>
      ) : (
        <ul className="space-y-1">
          {services.map(s => (
            <li key={s.id} className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
              <span className="font-medium text-gray-700">{s.name}</span>
              <span className="text-gray-400">— {s.typeDisplay || s.typeCode}</span>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <form onSubmit={handleAdd} className="space-y-3 pt-2 border-t border-gray-200">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Service name</label>
            <input
              required
              placeholder="e.g. Radiology Department"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Service type</label>
            <select
              value={form.typeCode}
              onChange={e => setForm(prev => ({ ...prev, typeCode: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {HC_SERVICE_TYPES.map(t => (
                <option key={t.code} value={t.code}>{t.display}</option>
              ))}
            </select>
          </div>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={adding}
            className="px-4 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add service'}
          </button>
        </form>
      )}
    </div>
  );
};

// ─── My organisations section (standalone — no client creation) ───────────────

const MyOrganisationsSection: React.FC = () => {
  const { getToken } = useAuth();
  const [orgs, setOrgs]             = useState<MyOrganisation[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const data = await listMyOrganisations(token);
        if (!cancelled) setOrgs(data);
      } catch {
        // user may have no orgs yet — silently skip
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || orgs.length === 0) return null;

  return (
    <div className="max-w-xl mx-auto">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">My Organisations</h2>

        <div className="space-y-2">
          {orgs.map(org => (
            <div key={org.orgId} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedId(v => v === org.orgId ? null : org.orgId)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-900">{org.orgName}</span>
                  {org.orgIdentifier && (
                    <span className="ml-2 text-xs text-gray-400">GLN {org.orgIdentifier}</span>
                  )}
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 shrink-0 ml-2 transition-transform ${expandedId === org.orgId ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {expandedId === org.orgId && (
                <div className="px-4 pb-4 border-t border-gray-100">
                  <HealthcareServicesPanel org={org} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Client onboarding wizard ─────────────────────────────────────────────────

const OnboardingWizard: React.FC = () => {
  const { getToken } = useAuth();

  // Org mode
  const [orgMode, setOrgMode]           = useState<'new' | 'existing'>('new');
  const [myOrgs, setMyOrgs]             = useState<MyOrganisation[]>([]);
  const [orgsLoading, setOrgsLoading]   = useState(false);
  const [orgsError, setOrgsError]       = useState<string | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState('');

  // New-org fields
  const [form, setForm] = useState({
    orgName:       '',
    orgIdentifier: '',
    fhirBaseUrl:   '',
    level:         'l1' as 'l1' | 'l2',
    jwksUrl:       '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<CreateClientResponse | null>(null);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  // Load user's orgs when switching to "existing" mode
  useEffect(() => {
    if (orgMode !== 'existing') return;
    let cancelled = false;
    (async () => {
      setOrgsLoading(true);
      setOrgsError(null);
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const orgs = await listMyOrganisations(token);
        if (!cancelled) {
          setMyOrgs(orgs);
          if (orgs.length > 0 && !selectedOrgId) setSelectedOrgId(orgs[0].orgId);
        }
      } catch (err) {
        if (!cancelled) setOrgsError(err instanceof Error ? err.message : 'Failed to load organisations');
      } finally {
        if (!cancelled) setOrgsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orgMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('No auth token — please log in again');

      const res = await createClient(
        orgMode === 'existing'
          ? {
              existingOrgId: selectedOrgId,
              level:   form.level,
              jwksUrl: form.level === 'l2' ? form.jwksUrl : undefined,
            }
          : {
              orgName:       form.orgName,
              orgIdentifier: form.orgIdentifier || undefined,
              fhirBaseUrl:   form.fhirBaseUrl   || undefined,
              level:         form.level,
              jwksUrl:       form.level === 'l2' ? form.jwksUrl : undefined,
            },
        token,
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return <ResultCard result={result} onReset={() => setResult(null)} />;
  }

  const selectedOrg = myOrgs.find(o => o.orgId === selectedOrgId) ?? null;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Onboard an M2M client</h1>
        <p className="mt-1 text-sm text-gray-500">
          Register your organisation in the FHIR registry and create a Keycloak client
          you can use to test the sandbox external gateways.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-5">

        {/* Organisation section */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-2">
            Organisation
          </h2>

          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            {(['new', 'existing'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setOrgMode(mode)}
                className={`py-2 text-sm font-medium rounded-lg border transition-colors ${
                  orgMode === mode
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {mode === 'new' ? 'Create new organisation' : 'Use existing organisation'}
              </button>
            ))}
          </div>

          {orgMode === 'new' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Organisation name <span className="text-red-500">*</span>
                </label>
                <input
                  required={orgMode === 'new'}
                  placeholder="e.g. Hospital Z AG"
                  value={form.orgName}
                  onChange={set('orgName')}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  GLN identifier <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  placeholder="e.g. 7601000000000"
                  value={form.orgIdentifier}
                  onChange={set('orgIdentifier')}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  FHIR API Base URL <span className="text-gray-400">(optional — creates an Endpoint resource)</span>
                </label>
                <input
                  type="url"
                  placeholder="https://fhir.example.org/fhir"
                  value={form.fhirBaseUrl}
                  onChange={set('fhirBaseUrl')}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {orgMode === 'existing' && (
            <div className="space-y-3">
              {orgsLoading && (
                <p className="text-sm text-gray-400">Loading your organisations…</p>
              )}
              {orgsError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{orgsError}</p>
              )}
              {!orgsLoading && !orgsError && myOrgs.length === 0 && (
                <div className="text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-4 py-3">
                  You have no organisations yet.{' '}
                  <button
                    type="button"
                    onClick={() => setOrgMode('new')}
                    className="text-blue-600 hover:underline"
                  >
                    Create one first.
                  </button>
                </div>
              )}
              {!orgsLoading && myOrgs.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-700">Select organisation</label>
                  <select
                    value={selectedOrgId}
                    onChange={e => setSelectedOrgId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {myOrgs.map(org => (
                      <option key={org.orgId} value={org.orgId}>{org.orgName}</option>
                    ))}
                  </select>

                  {selectedOrg && (
                    <div className="text-xs text-gray-500 space-y-0.5 px-1">
                      <p><span className="font-medium text-gray-600">Reference:</span>{' '}
                        <code className="font-mono">{selectedOrg.orgReference}</code>
                      </p>
                      {selectedOrg.orgIdentifier && (
                        <p><span className="font-medium text-gray-600">GLN:</span> {selectedOrg.orgIdentifier}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Auth level */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-2">
            Authentication level
          </h2>

          <div className="grid grid-cols-2 gap-3">
            {(['l1', 'l2'] as const).map(lvl => (
              <label
                key={lvl}
                className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                  form.level === lvl ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="level"
                  value={lvl}
                  checked={form.level === lvl}
                  onChange={() => setForm(prev => ({ ...prev, level: lvl }))}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {lvl === 'l1' ? 'L1 — client_secret' : 'L2 — private_key_jwt'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {lvl === 'l1'
                      ? 'Shared secret, simpler to set up'
                      : 'Asymmetric keys, RFC 7523 — more secure'}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* L2 JWKS URL */}
        {form.level === 'l2' && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-2">
              JWKS configuration
            </h2>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                JWKS URL <span className="text-red-500">*</span>
              </label>
              <input
                required={form.level === 'l2'}
                placeholder="http://your-custodian:8000/jwks.json"
                value={form.jwksUrl}
                onChange={set('jwksUrl')}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Must be reachable from inside the Docker network by Keycloak
                (e.g. <code className="font-mono">http://your-service:port/jwks.json</code>).
                Keycloak fetches this URL to verify your client assertions.
              </p>
            </div>
          </section>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || (orgMode === 'existing' && !selectedOrgId)}
          className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Creating client…' : 'Create client'}
        </button>
      </form>
    </div>
  );
};

// ─── Page root ────────────────────────────────────────────────────────────────

const OnboardingPage: React.FC = () => {
  const { authenticated, roles } = useAuth();

  if (!authenticated) {
    return <RegistrationPanel />;
  }

  const isAdmin    = roles.includes('admin');
  const canOnboard = isAdmin || roles.includes('user');

  if (!canOnboard) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center text-sm text-gray-500">
        Your account does not have the <code className="font-mono">user</code> or{' '}
        <code className="font-mono">admin</code> role required to onboard clients.
      </div>
    );
  }

  return (
    <div className="py-6 space-y-8">
      {isAdmin && <InvitePanel />}
      <MyOrganisationsSection />
      <OnboardingWizard />
    </div>
  );
};

export default OnboardingPage;
