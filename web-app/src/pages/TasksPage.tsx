import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRole } from '../contexts/RoleContext';
import { useLog } from '../contexts/LogContext';
import { useRegistrySearch } from '../hooks/useFhirSearch';
import type { FhirResource, Organization, Endpoint } from '../types/fhir';
import TaskList from '../components/fhir/TaskList';
import CreateTaskModal from '../components/fhir/CreateTaskModal';
import ManualCredentialForm, {
  ManualClientToggle,
  acquireTokenWithCredential,
  manualCredIsReady,
  EMPTY_MANUAL_CREDENTIAL,
  type ManualCredential,
} from '../components/common/ManualCredentialForm';

// ─── Page ─────────────────────────────────────────────────────────────────────

const TasksPage: React.FC = () => {
  const { activeRole, partyLabel, keycloakTokenUrl } = useRole();
  const { addLog } = useLog();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState('');

  // Manual client state
  const [manualMode, setManualMode] = useState(false);
  const [manualCred, setManualCred] = useState<ManualCredential>(EMPTY_MANUAL_CREDENTIAL);

  const { data: registryBundle } = useRegistrySearch<FhirResource>(
    'Organization',
    { '_revinclude': 'Endpoint:organization' },
    activeRole !== 'registry'
  );
  const organizations = (registryBundle?.entry
    ?.map((e) => e.resource)
    .filter((r): r is Organization => r?.resourceType === 'Organization')) ?? [];
  const endpoints = (registryBundle?.entry
    ?.map((e) => e.resource)
    .filter((r): r is Endpoint => r?.resourceType === 'Endpoint')) ?? [];

  const ownAlias = activeRole === 'placer' ? 'HospitalP' : 'HospitalF';
  const targetableOrgs = organizations
    .filter((org) => !org.alias?.includes(ownAlias))
    .flatMap((org) => {
      const endpoint = endpoints.find(
        (ep) =>
          ep.managingOrganization?.reference?.endsWith(`/Organization/${org.id}`) ||
          ep.managingOrganization?.reference?.endsWith(`Organization/${org.id}`)
      );
      return endpoint ? [{ org, endpoint }] : [];
    });

  const selectedEntry = targetableOrgs.find((t) => t.org.id === selectedOrgId) ?? null;
  const remoteBaseUrl = selectedEntry?.endpoint.address ?? null;
  const remoteOrgName = selectedEntry?.org.name ?? selectedEntry?.org.alias?.[0] ?? null;

  const credReady = manualMode && manualCredIsReady(manualCred);

  const customGetToken = useCallback(
    () => {
      addLog({ type: 'info', message: `Using manual ${manualCred.level.toUpperCase()} credentials for client "${manualCred.clientId}"` });
      return acquireTokenWithCredential(keycloakTokenUrl, manualCred);
    },
    [keycloakTokenUrl, manualCred, addLog],
  );

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
  };

  if (activeRole === 'registry') {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Tasks</h2>
          <p className="text-gray-500 mt-1">Tasks are party-specific and not part of the shared registry.</p>
        </div>
        <div className="card p-8 text-center text-gray-400 space-y-2">
          <p className="text-sm">The Registry is a public mCSD directory containing Organizations and Endpoints.</p>
          <p className="text-sm">Switch to <strong className="text-gray-600">HospitalP (Placer)</strong> or <strong className="text-gray-600">HospitalF (Fulfiller)</strong> to manage Tasks.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Tasks</h2>
        <p className="text-gray-600 mt-1">
          Create and fetch authorized tasks from partner organizations. Note that the client credentials can be set manually for non-sandbox default organizations.
        </p>
        <p className="text-gray-500 mt-1">
          Active role: <strong>{partyLabel}</strong>
        </p>

        <button
          onClick={() => setModalOpen(true)}
          className="btn-primary mt-3"
        >
          + Create new
        </button>

        {/* Org selector */}
        <div className="mt-3 flex items-center gap-3">
          <label className="text-sm font-medium text-gray-600 shrink-0">Remote organisation:</label>
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm max-w-xs"
          >
            <option value="">— local tasks only —</option>
            {targetableOrgs.map(({ org }) => (
              <option key={org.id} value={org.id!}>
                {org.name ?? org.alias?.[0] ?? org.id}
              </option>
            ))}
          </select>
          {remoteBaseUrl && (
            <span className="text-xs text-gray-400 font-mono">{remoteBaseUrl}</span>
          )}
        </div>

        {/* Manual client toggle */}
        <div className="mt-4">
          <ManualClientToggle
            enabled={manualMode}
            onToggle={() => setManualMode(v => !v)}
            ready={credReady}
            level={manualCred.level}
          />
          {manualMode && (
            <ManualCredentialForm cred={manualCred} onChange={setManualCred} />
          )}
        </div>
      </div>

      <TaskList
        remoteBaseUrl={remoteBaseUrl}
        remoteOrgName={remoteOrgName}
        customGetToken={credReady ? customGetToken : undefined}
      />

      <CreateTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={handleSuccess}
      />
    </div>
  );
};

export default TasksPage;
