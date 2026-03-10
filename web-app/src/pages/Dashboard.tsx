import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useRole } from '../contexts/RoleContext';
import { useFhirSearch } from '../hooks/useFhirSearch';
import WorkflowWizard from '../components/workflow/WorkflowWizard';

// ---------------------------------------------------------------------------
// Health-check types & service definitions
// ---------------------------------------------------------------------------

type HealthStatus = 'up' | 'down' | 'checking' | 'unknown';

interface ServiceDef {
  name: string;
  desc: string;
  url?: string;
  port?: string;
  healthUrl?: string;
  group: 'placer' | 'fulfiller' | 'shared' | 'internal';
}

const SERVICES: ServiceDef[] = [
  // HospitalP (Placer) party
  {
    name: 'KrakenD Placer',
    desc: 'Internal API gateway',
    url: 'http://localhost:8080',
    port: '8080',
    healthUrl: 'http://localhost:8080/__health',
    group: 'placer',
  },
  {
    name: 'KrakenD Placer Ext',
    desc: 'External API gateway',
    url: 'http://localhost:8081',
    port: '8081',
    healthUrl: 'http://localhost:8081/__health',
    group: 'placer',
  },
  {
    name: 'OPA Placer',
    desc: 'Policy engine',
    url: 'http://localhost:8181',
    port: '8181',
    healthUrl: 'http://localhost:8181/health',
    group: 'placer',
  },
  // HospitalF (Fulfiller) party
  {
    name: 'KrakenD Fulfiller',
    desc: 'Internal API gateway',
    url: 'http://localhost:8082',
    port: '8082',
    healthUrl: 'http://localhost:8082/__health',
    group: 'fulfiller',
  },
  {
    name: 'KrakenD Fulfiller Ext',
    desc: 'External API gateway',
    url: 'http://localhost:8083',
    port: '8083',
    healthUrl: 'http://localhost:8083/__health',
    group: 'fulfiller',
  },
  {
    name: 'OPA Fulfiller',
    desc: 'Policy engine',
    url: 'http://localhost:8182',
    port: '8182',
    healthUrl: 'http://localhost:8182/health',
    group: 'fulfiller',
  },
  // Shared infrastructure
  {
    name: 'Keycloak',
    desc: 'Identity & access management',
    url: 'http://localhost:8180',
    port: '8180',
    healthUrl: 'http://localhost:8180/health/ready',
    group: 'shared',
  },
  {
    name: 'HAPI FHIR',
    desc: 'FHIR R4 server',
    url: 'http://localhost:8090',
    port: '8090',
    healthUrl: 'http://localhost:8090/fhir/metadata',
    group: 'shared',
  },
  {
    name: 'Web App',
    desc: 'React SPA (this app)',
    url: 'http://localhost:3000',
    port: '3000',
    healthUrl: 'http://localhost:3000',
    group: 'shared',
  },
  // Internal Docker-only (no exposed port reachable from browser)
  {
    name: 'nginx-proxy',
    desc: 'URL rewriting & partition routing',
    group: 'internal',
  },
  {
    name: 'PostgreSQL',
    desc: 'FHIR data persistence',
    group: 'internal',
  },
];

const GROUP_META: Record<
  ServiceDef['group'],
  { label: string; accent: string; badge: string; header: string }
> = {
  placer: {
    label: 'HospitalP — Placer',
    accent: 'border-blue-200 bg-blue-50/50',
    badge: 'bg-blue-100 text-blue-700',
    header: 'text-blue-700',
  },
  fulfiller: {
    label: 'HospitalF — Fulfiller',
    accent: 'border-amber-200 bg-amber-50/50',
    badge: 'bg-amber-100 text-amber-700',
    header: 'text-amber-700',
  },
  shared: {
    label: 'Shared Infrastructure',
    accent: 'border-slate-200 bg-slate-50/40',
    badge: 'bg-slate-100 text-slate-600',
    header: 'text-slate-600',
  },
  internal: {
    label: 'Internal (Docker only)',
    accent: 'border-gray-100 bg-gray-50/30',
    badge: 'bg-gray-100 text-gray-400',
    header: 'text-gray-400',
  },
};

// ---------------------------------------------------------------------------
// Capability bullets shown in the bottom-left column
// ---------------------------------------------------------------------------

const CAPABILITIES = [
  {
    icon: '🏥',
    title: 'Dual-party FHIR R4 workflow',
    body: 'HospitalP (Placer) creates ServiceRequests, Consents and Tasks; HospitalF (Fulfiller) processes and updates them. Each party owns a separate HAPI FHIR partition.',
  },
  {
    icon: '🔐',
    title: 'JWT-secured API gateways (KrakenD v2.7)',
    body: 'Four KrakenD instances enforce RS256 JWT validation. Internal gateways serve the web-app via OAuth2 user tokens; external gateways are M2M entry points.',
  },
  {
    icon: '🛡️',
    title: 'Consent-gated cross-party FHIR access',
    body: 'OPA policies enforce that cross-party reads are authorised by an active Consent resource. Consent ID travels in the M2M JWT via Keycloak dynamic scope consent:<id>.',
  },
  {
    icon: '🔑',
    title: 'Keycloak OIDC / OAuth2',
    body: 'Realm umzh-connect hosts the web-app client (authorization code flow) and M2M service accounts placer-client / fulfiller-client (client credentials flow).',
  },
  {
    icon: '🔄',
    title: 'nginx URL rewriting',
    body: 'Six nginx server blocks rewrite HAPI self-links and cross-party absolute references so the web-app always receives gateway-relative URLs.',
  },
  {
    icon: '📋',
    title: 'Pre-seeded reference data',
    body: 'Patients, Practitioners, Conditions, Consents and ServiceRequests are loaded at startup. Active use cases: Orthopedic Referral and Sarcoma Tumor Board.',
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const HealthDot: React.FC<{ status: HealthStatus }> = ({ status }) => {
  const dot = {
    up: 'bg-green-500',
    down: 'bg-red-500',
    checking: 'bg-yellow-400 animate-pulse',
    unknown: 'bg-gray-300',
  }[status];
  const text = { up: 'Up', down: 'Down', checking: '…', unknown: 'N/A' }[status];
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
      <span className="text-xs text-gray-400 w-8">{text}</span>
    </span>
  );
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const Dashboard: React.FC = () => {
  const { partyLabel, activeRole } = useRole();

  // FHIR resource counts
  const { data: patients } = useFhirSearch('Patient');
  const { data: serviceRequests } = useFhirSearch('ServiceRequest');
  const { data: tasks } = useFhirSearch('Task');
  const { data: conditions } = useFhirSearch('Condition');

  const stats = [
    {
      label: 'Patients',
      count: patients?.total ?? patients?.entry?.length ?? 0,
      path: '/resources',
      color: 'bg-blue-50 text-blue-700',
    },
    {
      label: 'Service Requests',
      count: serviceRequests?.total ?? serviceRequests?.entry?.length ?? 0,
      path: '/resources',
      color: 'bg-purple-50 text-purple-700',
    },
    {
      label: 'Tasks',
      count: tasks?.total ?? tasks?.entry?.length ?? 0,
      path: '/tasks',
      color: 'bg-yellow-50 text-yellow-700',
    },
    {
      label: 'Conditions',
      count: conditions?.total ?? conditions?.entry?.length ?? 0,
      path: '/resources',
      color: 'bg-green-50 text-green-700',
    },
  ];

  // Health-check state — initialise all checkable services as 'checking'
  const [health, setHealth] = useState<Record<string, HealthStatus>>(
    Object.fromEntries(
      SERVICES.map((s) => [s.name, s.healthUrl ? ('checking' as const) : ('unknown' as const)])
    )
  );

  const checkService = useCallback(async (svc: ServiceDef) => {
    if (!svc.healthUrl) return;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 3000);
      await fetch(svc.healthUrl, { signal: ctrl.signal, mode: 'no-cors' });
      clearTimeout(tid);
      setHealth((prev) => ({ ...prev, [svc.name]: 'up' }));
    } catch {
      setHealth((prev) => ({ ...prev, [svc.name]: 'down' }));
    }
  }, []);

  const refreshAll = useCallback(() => {
    setHealth((prev) => {
      const next = { ...prev };
      SERVICES.forEach((s) => {
        if (s.healthUrl) next[s.name] = 'checking';
      });
      return next;
    });
    SERVICES.forEach((svc) => checkService(svc));
  }, [checkService]);

  // Check on mount, then every 30 s
  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 30_000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  // Group services for the architecture panel (4 columns)
  const groups = (['placer', 'fulfiller', 'shared', 'internal'] as const).map((g) => ({
    key: g,
    ...GROUP_META[g],
    services: SERVICES.filter((s) => s.group === g),
  }));

  return (
    <div className="space-y-8">

      {/* ================================================================== */}
      {/* Page header                                                         */}
      {/* ================================================================== */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-500 mt-1">
          Active role: <strong>{partyLabel}</strong> · Clinical order workflow sandbox
        </p>
      </div>

      {/* ================================================================== */}
      {/* SECTION 1 — Architecture (4 horizontal columns)                    */}
      {/* ================================================================== */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Architecture</h3>
          <button
            onClick={refreshAll}
            className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
          >
            ↺ Refresh health
          </button>
        </div>

        {/* 4-column grid — one column per group */}
        <div className="grid grid-cols-4 gap-4">
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col">
              <p className={`text-xs font-bold uppercase tracking-wider mb-2 ${group.header}`}>
                {group.label}
              </p>
              <div className={`rounded-lg border p-2 space-y-0.5 flex-1 ${group.accent}`}>
                {group.services.map((svc) => (
                  <div
                    key={svc.name}
                    className="flex items-start justify-between gap-1 py-1.5 px-1.5 rounded hover:bg-white/70 transition-colors"
                  >
                    {/* Name + description */}
                    <div className="min-w-0 flex-1">
                      {svc.url ? (
                        <a
                          href={svc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-gray-800 hover:text-blue-600 transition-colors leading-tight block"
                        >
                          {svc.name}
                        </a>
                      ) : (
                        <span className="text-xs font-semibold text-gray-600 leading-tight block">
                          {svc.name}
                        </span>
                      )}
                      <p className="text-xs text-gray-400 truncate">{svc.desc}</p>
                    </div>

                    {/* Port badge + health dot stacked vertically */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {svc.port ? (
                        <span
                          className={`text-xs font-mono px-1 py-0.5 rounded leading-tight ${group.badge}`}
                        >
                          :{svc.port}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300 italic">internal</span>
                      )}
                      <HealthDot status={health[svc.name] ?? 'unknown'} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-4 pt-3 border-t border-gray-100">
          {[
            { cls: 'bg-green-500', label: 'Up' },
            { cls: 'bg-red-500', label: 'Down' },
            { cls: 'bg-yellow-400', label: 'Checking' },
            { cls: 'bg-gray-300', label: 'N/A' },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1 text-xs text-gray-400">
              <span className={`inline-block w-2 h-2 rounded-full ${l.cls}`} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* ================================================================== */}
      {/* SECTION 2 — Workflow Wizard                                         */}
      {/* ================================================================== */}
      <div className="border-b border-gray-200 pb-8">
        <WorkflowWizard key={activeRole} />
      </div>

      {/* ================================================================== */}
      {/* SECTION 3 — Two-column: Capabilities | Resource summaries           */}
      {/* ================================================================== */}
      <div className="grid grid-cols-2 gap-6 items-start">

        {/* Left column: Sandbox Capabilities */}
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Sandbox Capabilities</h3>
          <ul className="space-y-4">
            {CAPABILITIES.map((c) => (
              <li key={c.title} className="flex gap-3">
                <span className="text-xl leading-none mt-0.5 shrink-0">{c.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{c.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Right column: Resource summaries (2 × 2 stat cards) */}
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-gray-900">Resource Summary</h3>
          <div className="grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <Link
                key={s.label}
                to={s.path}
                className="card p-4 hover:shadow-md transition-shadow"
              >
                <span
                  className={`inline-flex px-2 py-0.5 rounded text-xs font-medium mb-1 ${s.color}`}
                >
                  {s.label}
                </span>
                <p className="text-3xl font-bold text-gray-900">{s.count}</p>
              </Link>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};

export default Dashboard;
