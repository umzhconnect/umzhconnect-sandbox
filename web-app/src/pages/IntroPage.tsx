import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';

import {
  VITE_PLACER_URL,
  VITE_PLACER_EXTERNAL_URL,
  VITE_FULFILLER_URL,
  VITE_FULFILLER_EXTERNAL_URL,
  VITE_KEYCLOAK_URL,
  VITE_KEYCLOAK_REALM,
} from '../config/env';

// ---------------------------------------------------------------------------
// Getting started — one entry per sandbox section (mirrors the sidebar nav)
// ---------------------------------------------------------------------------

interface GettingStartedStep {
  icon: string;
  title: string;
  /** Sidebar route this step maps to; when set the title links there. */
  path?: string;
  body: React.ReactNode;
}

const GETTING_STARTED: GettingStartedStep[] = [
  {
    icon: '🚪',
    title: 'Access',
    path: '/onboarding',
    body: (
      <>
        <span className="font-medium text-gray-700">Running on your own:</span> log in with the
        default credentials documented in the README (<code className="font-mono text-[11px]">placer-user</code> /{' '}
        <code className="font-mono text-[11px]">fulfiller-user</code> /{' '}
        <code className="font-mono text-[11px]">admin-user</code>).{' '}
        <br />
        <span className="font-medium text-gray-700">Public sandbox:</span> request an invite token by
        email to{' '}
        <a href="mailto:contact@umzhconnect.ch" className="text-blue-600 hover:underline">
          contact@umzhconnect.ch
        </a>
        , then redeem it under <span className="font-medium">Get access</span>.
      </>
    ),
  },
  {
    icon: '👥',
    title: 'Login — permissions per role',
    body: (
      <>
        <span className="font-medium text-gray-700">Placer</span> reads &amp; writes HospitalP&apos;s
        own partition (creates ServiceRequests, Consents, Tasks).{' '}
        <span className="font-medium text-gray-700">Fulfiller</span> reads &amp; writes
        HospitalF&apos;s own partition (processes and updates incoming Tasks).{' '}
        <span className="font-medium text-gray-700">Admin</span> holds both realm roles, so it can act
        from either perspective.
      </>
    ),
  },
  {
    icon: '🧭',
    title: 'Workflow',
    path: '/workflow',
    body: 'An end-to-end walk-through of the clinical order workflow — follow a single order from the Placer creating it through to the Fulfiller acting on it, switching perspective as you go.',
  },
  {
    icon: '📂',
    title: 'Resources',
    path: '/resources',
    body: 'Read (and write) FHIR resources from the Placer or Fulfiller perspective. The partitions are pre-seeded at startup with patients, conditions, consents and service requests.',
  },
  {
    icon: '✅',
    title: 'Tasks',
    path: '/tasks',
    body: "Read — and update where permitted — Tasks exposed by the partner's external API. Cross-party reads are gated by OPA against an active Consent, and the M2M token must carry the matching fhirContext (SMART v2 / RFC 9396).",
  },
  {
    icon: '🌐',
    title: 'Registry',
    path: '/registry',
    body: 'Publicly available (no auth) mCSD directory — the Organizations, Endpoints and HealthcareServices for both hospitals.',
  },
  {
    icon: '🎫',
    title: 'Credentials',
    path: '/credentials',
    body: "How to obtain access tokens for a partner's external API — mint an L2 private_key_jwt assertion, exchange it at Keycloak for an M2M token, and call the partner gateway.",
  },
];

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

const CAPABILITIES = [
  {
    icon: '🏥',
    title: 'Dual-party FHIR R4 workflow',
    body: 'HospitalP (Placer) creates ServiceRequests, Consents and Tasks; HospitalF (Fulfiller) processes and updates them. Each party owns a separate HAPI FHIR partition.',
  },
  {
    icon: '🔐',
    title: 'JWT-secured API gateways (APISIX v3.9)',
    body: 'Four APISIX instances enforce RS256 JWT validation. Internal gateways serve the web-app via OAuth2 user tokens; external gateways are M2M entry points.',
  },
  {
    icon: '🛡️',
    title: 'Context-centric cross-party FHIR access',
    body: 'OPA enforces cross-party reads against an active Consent resource. The M2M token carries a fhirContext claim (SMART v2) derived from RFC 9396 authorization_details. OPA locates the Consent via Consent?data=ServiceRequest/<id>&status=active and verifies the actor.',
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
    body: 'Patients, Practitioners, Conditions, Consents and ServiceRequests are loaded at startup. Active use cases: Orthopedic Referral and Sarcoma Tumor Board. The shared registry is seeded with Organizations, Endpoints and HealthcareServices for both hospitals.',
  },
];

// ---------------------------------------------------------------------------
// Architecture / health-check
// ---------------------------------------------------------------------------

type HealthStatus = 'up' | 'down' | 'checking' | 'unknown';

interface ServiceDef {
  name: string;
  desc: string;
  url?: string;
  healthUrl?: string;
  group: 'placer' | 'fulfiller' | 'shared' | 'internal';
}

const SERVICES: ServiceDef[] = [
  { name: 'APISIX Placer',       desc: 'Internal API gateway',                 url: VITE_PLACER_URL,          healthUrl: `${VITE_PLACER_URL}/__health`,          group: 'placer' },
  { name: 'APISIX Placer Ext',   desc: 'External API gateway',                 url: VITE_PLACER_EXTERNAL_URL, healthUrl: `${VITE_PLACER_EXTERNAL_URL}/__health`, group: 'placer' },
  { name: 'APISIX Fulfiller',    desc: 'Internal API gateway',                 url: VITE_FULFILLER_URL,          healthUrl: `${VITE_FULFILLER_URL}/__health`,          group: 'fulfiller' },
  { name: 'APISIX Fulfiller Ext',desc: 'External API gateway',                 url: VITE_FULFILLER_EXTERNAL_URL, healthUrl: `${VITE_FULFILLER_EXTERNAL_URL}/__health`, group: 'fulfiller' },
  { name: 'Keycloak',            desc: 'Identity & access management',         url: VITE_KEYCLOAK_URL, healthUrl: `${VITE_KEYCLOAK_URL}/realms/${VITE_KEYCLOAK_REALM}/.well-known/openid-configuration`, group: 'shared' },
  // No direct HAPI FHIR URL is exposed publicly — checked via the Placer gateway's unauthenticated /fhir/metadata route.
  { name: 'HAPI FHIR',           desc: 'FHIR R4 server (via Placer gateway)',  url: VITE_PLACER_URL, healthUrl: `${VITE_PLACER_URL}/fhir/metadata`, group: 'shared' },
  { name: 'Web App',             desc: 'React SPA (this app)',                 url: window.location.origin, healthUrl: window.location.origin, group: 'shared' },
  { name: 'OPA Placer',          desc: 'Policy engine (Docker-internal only)',                                                                                     group: 'internal' },
  { name: 'OPA Fulfiller',       desc: 'Policy engine (Docker-internal only)',                                                                                     group: 'internal' },
  { name: 'nginx-proxy',         desc: 'URL rewriting & partition routing',                                                                                        group: 'internal' },
  { name: 'PostgreSQL',          desc: 'FHIR data persistence',                                                                                                    group: 'internal' },
];

function portBadge(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.port || (u.protocol === 'https:' ? '443' : '80');
  } catch {
    return undefined;
  }
}

const GROUP_META = {
  placer:   { label: 'HospitalP — Placer',       accent: 'border-blue-200 bg-blue-50/50',    badge: 'bg-blue-100 text-blue-700',   header: 'text-blue-700' },
  fulfiller:{ label: 'HospitalF — Fulfiller',    accent: 'border-amber-200 bg-amber-50/50',  badge: 'bg-amber-100 text-amber-700', header: 'text-amber-700' },
  shared:   { label: 'Shared Infrastructure',    accent: 'border-slate-200 bg-slate-50/40',  badge: 'bg-slate-100 text-slate-600', header: 'text-slate-600' },
  internal: { label: 'Internal (Docker only)',   accent: 'border-gray-100 bg-gray-50/30',    badge: 'bg-gray-100 text-gray-400',   header: 'text-gray-400' },
};

const HealthDot: React.FC<{ status: HealthStatus }> = ({ status }) => {
  const dot = { up: 'bg-green-500', down: 'bg-red-500', checking: 'bg-yellow-400 animate-pulse', unknown: 'bg-gray-300' }[status];
  const text = { up: 'Up', down: 'Down', checking: '…', unknown: 'N/A' }[status];
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
      <span className="text-xs text-gray-400 w-8">{text}</span>
    </span>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const IntroPage: React.FC = () => {
  const [health, setHealth] = useState<Record<string, HealthStatus>>(
    Object.fromEntries(SERVICES.map((s) => [s.name, s.healthUrl ? 'checking' : 'unknown']))
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
      SERVICES.forEach((s) => { if (s.healthUrl) next[s.name] = 'checking'; });
      return next;
    });
    SERVICES.forEach((svc) => checkService(svc));
  }, [checkService]);

  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 30_000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  const groups = (['placer', 'fulfiller', 'shared', 'internal'] as const).map((g) => ({
    key: g,
    ...GROUP_META[g],
    services: SERVICES.filter((s) => s.group === g),
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">UMZH Connect Sandbox</h2>
        <p className="text-gray-500 mt-1">
          A reference implementation of a two-party healthcare order workflow using FHIR R4,
          OAuth2 / SMART on FHIR, and consent-centric authorization.
        </p>
      </div>

      {/* Two-column row */}
      <div className="flex gap-6 items-start">
        {/* Left: Getting started */}
        <div className="w-1/2 card">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Getting started</h3>
          <ul className="space-y-4">
            {GETTING_STARTED.map((s) => (
              <li key={s.title} className="flex gap-3">
                <span className="text-xl leading-none mt-0.5 shrink-0">{s.icon}</span>
                <div>
                  {s.path ? (
                    <Link to={s.path} className="text-sm font-semibold text-gray-800 hover:text-blue-600 transition-colors">
                      {s.title}
                    </Link>
                  ) : (
                    <p className="text-sm font-semibold text-gray-800">{s.title}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{s.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Right: Sandbox Capabilities */}
        <div className="w-1/2 card">
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
      </div>

      {/* Architecture */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Architecture</h3>
          <button onClick={refreshAll} className="text-xs text-blue-600 hover:text-blue-800 transition-colors">
            ↺ Refresh health
          </button>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col">
              <p className={`text-xs font-bold uppercase tracking-wider mb-2 ${group.header}`}>
                {group.label}
              </p>
              <div className={`rounded-lg border p-2 space-y-0.5 flex-1 ${group.accent}`}>
                {group.services.map((svc) => (
                  <div key={svc.name} className="flex items-start justify-between gap-1 py-1.5 px-1.5 rounded hover:bg-white/70 transition-colors">
                    <div className="min-w-0 flex-1">
                      {svc.url ? (
                        <a href={svc.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-gray-800 hover:text-blue-600 transition-colors leading-tight block">
                          {svc.name}
                        </a>
                      ) : (
                        <span className="text-xs font-semibold text-gray-600 leading-tight block">{svc.name}</span>
                      )}
                      <p className="text-xs text-gray-400 truncate">{svc.desc}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {portBadge(svc.url) ? (
                        <span className={`text-xs font-mono px-1 py-0.5 rounded leading-tight ${group.badge}`}>:{portBadge(svc.url)}</span>
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

        <div className="flex gap-4 mt-4 pt-3 border-t border-gray-100">
          {[{ cls: 'bg-green-500', label: 'Up' }, { cls: 'bg-red-500', label: 'Down' }, { cls: 'bg-yellow-400', label: 'Checking' }, { cls: 'bg-gray-300', label: 'N/A' }].map((l) => (
            <span key={l.label} className="flex items-center gap-1 text-xs text-gray-400">
              <span className={`inline-block w-2 h-2 rounded-full ${l.cls}`} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default IntroPage;
