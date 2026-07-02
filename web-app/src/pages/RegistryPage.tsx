import React, { useState } from 'react';
import { useRegistrySearch } from '../hooks/useFhirSearch';
import type { FhirResource, Organization, Endpoint, HealthcareService } from '../types/fhir';
import JsonViewer from '../components/common/JsonViewer';
import LoadingSpinner from '../components/common/LoadingSpinner';

const FHIR_BASE_URL_EXT = 'https://umzhconnect.ch/ext/fhir-base-url';

// ---------------------------------------------------------------------------
// Modal — shows raw JSON for an Endpoint or HealthcareService
// ---------------------------------------------------------------------------

const ResourceModal: React.FC<{ resource: FhirResource | null; onClose: () => void }> = ({
  resource,
  onClose,
}) => {
  if (!resource) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">
            {resource.resourceType}/{resource.id}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <JsonViewer data={resource} collapsed={false} />
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// RegistryPage
// ---------------------------------------------------------------------------

const RegistryPage: React.FC = () => {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [modalResource, setModalResource] = useState<FhirResource | null>(null);

  // All organisations
  const { data: orgBundle, isLoading: orgsLoading } = useRegistrySearch<Organization>('Organization', {});
  const organizations =
    (orgBundle?.entry?.map((e) => e.resource).filter((r): r is Organization => r?.resourceType === 'Organization')) ?? [];

  const selectedOrg = organizations.find((o) => o.id === selectedOrgId) ?? null;
  const fhirBaseUrl = selectedOrg?.extension?.find((e) => e.url === FHIR_BASE_URL_EXT)?.valueUrl;

  // Endpoints for selected org
  const { data: endpointBundle, isLoading: endpointsLoading } = useRegistrySearch<Endpoint>(
    'Endpoint',
    selectedOrgId ? { organization: selectedOrgId } : {},
    !!selectedOrgId
  );
  const endpoints =
    (endpointBundle?.entry?.map((e) => e.resource).filter((r): r is Endpoint => r?.resourceType === 'Endpoint')) ?? [];

  // HealthcareServices for selected org
  const { data: hsBundle, isLoading: hsLoading } = useRegistrySearch<HealthcareService>(
    'HealthcareService',
    selectedOrgId ? { organization: selectedOrgId } : {},
    !!selectedOrgId
  );
  const healthcareServices =
    (hsBundle?.entry?.map((e) => e.resource).filter((r): r is HealthcareService => r?.resourceType === 'HealthcareService')) ?? [];

  return (
    <div className="flex flex-col space-y-4 h-full">

      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Registry</h2>
        <p className="text-gray-500 mt-1">
          Public mCSD directory — Organisations, Endpoints and HealthcareServices.
        </p>
      </div>

      {/* Two-panel layout */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* ── Left: organisation list ── */}
        <div className="w-1/3 flex flex-col min-h-0">
          <div className="flex-1 overflow-auto border border-gray-200 rounded-lg bg-white">
            {orgsLoading && <LoadingSpinner message="Loading organisations…" />}
            {!orgsLoading && organizations.length === 0 && (
              <div className="p-8 text-center text-gray-400 text-sm">No organisations found.</div>
            )}
            {organizations.map((org) => {
              const isSelected = org.id === selectedOrgId;
              const glnId = org.identifier?.find((i) => i.system?.includes('2.51.1.3'))?.value;
              return (
                <button
                  key={org.id}
                  onClick={() => setSelectedOrgId(org.id ?? null)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                    isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-medium text-gray-900 truncate pr-2">
                      {org.name ?? org.alias?.[0] ?? org.id}
                    </span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                        org.active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {org.active !== false ? 'active' : 'inactive'}
                    </span>
                  </div>
                  {glnId && (
                    <p className="text-xs text-gray-400 font-mono">GLN {glnId}</p>
                  )}
                  {org.alias && org.alias.length > 0 && (
                    <p className="text-xs text-gray-400">{org.alias.join(', ')}</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: detail ── */}
        <div className="flex-1 overflow-auto space-y-4 min-h-0">
          {!selectedOrg ? (
            <div className="border border-gray-200 rounded-lg bg-white flex items-center justify-center h-48 text-gray-400 text-sm">
              Select an organisation to view details
            </div>
          ) : (
            <>
              {/* Org info */}
              <div className="border border-gray-200 rounded-lg bg-white p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-gray-900">
                    {selectedOrg.name ?? selectedOrg.alias?.[0]}
                  </h3>
                  <button
                    onClick={() => setModalResource(selectedOrg)}
                    className="text-xs px-2.5 py-1 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Show JSON
                  </button>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div>
                    <dt className="text-xs font-medium text-gray-500 mb-0.5">Resource ID</dt>
                    <dd className="font-mono text-gray-800 text-xs break-all">{selectedOrg.id}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-gray-500 mb-0.5">Status</dt>
                    <dd>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        selectedOrg.active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {selectedOrg.active !== false ? 'active' : 'inactive'}
                      </span>
                    </dd>
                  </div>

                  {selectedOrg.alias && selectedOrg.alias.length > 0 && (
                    <div>
                      <dt className="text-xs font-medium text-gray-500 mb-0.5">Alias</dt>
                      <dd className="text-sm text-gray-800">{selectedOrg.alias.join(', ')}</dd>
                    </div>
                  )}

                  {selectedOrg.identifier?.map((id, i) => (
                    <div key={i}>
                      <dt className="text-xs font-medium text-gray-500 mb-0.5">
                        {id.type?.coding?.[0]?.display ?? id.system ?? 'Identifier'}
                      </dt>
                      <dd className="font-mono text-gray-800 text-xs">{id.value}</dd>
                    </div>
                  ))}

                  {fhirBaseUrl && (
                    <div className="col-span-2">
                      <dt className="text-xs font-medium text-gray-500 mb-0.5">FHIR Base URL</dt>
                      <dd className="font-mono text-gray-800 text-xs break-all">{fhirBaseUrl}</dd>
                    </div>
                  )}

                  {selectedOrg.telecom?.map((t, i) => (
                    <div key={i}>
                      <dt className="text-xs font-medium text-gray-500 mb-0.5 capitalize">{t.system ?? 'Contact'}</dt>
                      <dd className="text-sm text-gray-800">{t.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Endpoints */}
              <div className="border border-gray-200 rounded-lg bg-white p-5">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  Endpoints
                  {endpointsLoading && (
                    <span className="ml-2 text-xs text-gray-400 font-normal">Loading…</span>
                  )}
                </h4>
                {!endpointsLoading && endpoints.length === 0 && (
                  <p className="text-xs text-gray-400 italic">No endpoints registered.</p>
                )}
                <div className="space-y-2">
                  {endpoints.map((ep) => (
                    <button
                      key={ep.id}
                      onClick={() => setModalResource(ep)}
                      className="w-full text-left px-3 py-2.5 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-medium text-gray-900">
                          {ep.name ?? ep.connectionType?.code ?? 'Endpoint'}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ml-2 ${
                          ep.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {ep.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 font-mono truncate">{ep.address}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* HealthcareServices */}
              <div className="border border-gray-200 rounded-lg bg-white p-5">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  Healthcare Services
                  {hsLoading && (
                    <span className="ml-2 text-xs text-gray-400 font-normal">Loading…</span>
                  )}
                </h4>
                {!hsLoading && healthcareServices.length === 0 && (
                  <p className="text-xs text-gray-400 italic">No healthcare services registered.</p>
                )}
                <div className="space-y-2">
                  {healthcareServices.map((hs) => (
                    <button
                      key={hs.id}
                      onClick={() => setModalResource(hs)}
                      className="w-full text-left px-3 py-2.5 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-medium text-gray-900">
                          {hs.name ?? 'HealthcareService'}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ml-2 ${
                          hs.active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {hs.active !== false ? 'active' : 'inactive'}
                        </span>
                      </div>
                      {hs.type?.[0]?.coding?.[0]?.display && (
                        <p className="text-xs text-gray-500">{hs.type[0].coding[0].display}</p>
                      )}
                      {hs.comment && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{hs.comment}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <ResourceModal resource={modalResource} onClose={() => setModalResource(null)} />
    </div>
  );
};

export default RegistryPage;
