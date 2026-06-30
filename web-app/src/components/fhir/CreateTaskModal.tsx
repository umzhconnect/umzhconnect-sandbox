import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFhirSearch, useRegistrySearch } from '../../hooks/useFhirSearch';
import { useM2mToken } from '../../hooks/useFhirClient';
import { FhirClient } from '../../services/fhir-client';
import { useRole } from '../../contexts/RoleContext';
import { useLog } from '../../contexts/LogContext';
import type { FhirResource, Task, ServiceRequest, Organization, Endpoint } from '../../types/fhir';
import LoadingSpinner from '../common/LoadingSpinner';

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultSRId?: string;
  onSuccessResource?: (resource: FhirResource) => void;
}

const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  open,
  onClose,
  onSuccess,
  defaultSRId,
  onSuccessResource,
}) => {
  const { activeRole, partnerExternalBaseUrl, ownExternalBaseUrl, registryBaseUrl, ownL2ClientId } = useRole();
  const { addLog } = useLog();
  const getM2mToken = useM2mToken();
  const queryClient = useQueryClient();

  // Form state
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('routine');
  const [selectedSRId, setSelectedSRId] = useState(defaultSRId ?? '');
  const [selectedTargetOrgId, setSelectedTargetOrgId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch local resources (only when modal is open)
  const { data: srBundle, isLoading: srLoading } = useFhirSearch<ServiceRequest>(
    'ServiceRequest',
    {},
    open
  );
  const { data: registryBundle, isLoading: orgLoading } = useRegistrySearch<FhirResource>(
    'Organization',
    { '_revinclude': 'Endpoint:organization' },
    open
  );

  const serviceRequests =
    (srBundle?.entry?.map((e) => e.resource).filter(Boolean) as ServiceRequest[]) || [];
  const organizations = (registryBundle?.entry
    ?.map((e) => e.resource)
    .filter((r): r is Organization => r?.resourceType === 'Organization')) ?? [];
  const endpoints = (registryBundle?.entry
    ?.map((e) => e.resource)
    .filter((r): r is Endpoint => r?.resourceType === 'Endpoint')) ?? [];

  // Own org alias — exclude self from target list
  const ownAlias = activeRole === 'placer' ? 'HospitalP' : 'HospitalF';
  const partnerAlias = activeRole === 'placer' ? 'HospitalF' : 'HospitalP';

  // Build list of orgs that have a resolvable Endpoint (potential task targets)
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

  // Seed partner entry (always first / default)
  const partnerEntry = targetableOrgs.find((t) => t.org.alias?.includes(partnerAlias));

  // Selected target: explicit selection, or fall back to seed partner
  const selectedEntry =
    targetableOrgs.find((t) => t.org.id === selectedTargetOrgId) ?? partnerEntry ?? null;

  const effectiveApiHost  = selectedEntry?.endpoint.address ?? partnerExternalBaseUrl;
  const effectiveOwnerRef = selectedEntry
    ? `${registryBaseUrl}/Organization/${selectedEntry.org.id}`
    : undefined;
  const effectiveOwnerName = selectedEntry?.org.name ?? selectedEntry?.org.alias?.[0];

  // Derive patient from selected ServiceRequest, fallback to PetraMeier
  const selectedSR = serviceRequests.find((sr) => sr.id === selectedSRId) ?? null;
  const patientRef    = selectedSR?.subject?.reference ?? 'Patient/PetraMeier';
  const patientDisplay = selectedSR?.subject?.display  ?? 'Petra Meier';

  // Reset form on open/close
  useEffect(() => {
    if (open) {
      setSelectedSRId(defaultSRId ?? '');
      setSelectedTargetOrgId('');
      setDescription('');
      setPriority('routine');
      setError(null);
    } else {
      setDescription('');
      setPriority('routine');
      setSelectedSRId('');
      setSelectedTargetOrgId('');
      setError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    const srRef = selectedSRId
      ? `${ownExternalBaseUrl}/ServiceRequest/${selectedSRId}`
      : undefined;

    const task: Task = {
      resourceType: 'Task',
      status: 'ready',
      intent: 'order',
      priority,
      description: description || undefined,
      ...(srRef && {
        basedOn: [{ reference: srRef }],
        focus:   { reference: srRef },
      }),
      for: { reference: `${ownExternalBaseUrl}/${patientRef}`, display: patientDisplay },
      authoredOn: new Date().toISOString(),
      requester: {
        reference: `${ownExternalBaseUrl}/PractitionerRole/HansMusterRole`,
        display:   'Dr. med. Hans Muster',
      },
      ...(effectiveOwnerRef && {
        owner: { reference: effectiveOwnerRef, display: effectiveOwnerName },
      }),
    };

    addLog({ type: 'info', message: `Creating Task → ${effectiveApiHost}/fhir/Task (direct, in-browser M2M token)` });

    try {
      const m2mToken = await getM2mToken();
      const client   = new FhirClient(effectiveApiHost, m2mToken, addLog);
      const result   = await client.create<Task>(task);

      await queryClient.invalidateQueries({ queryKey: ['all-tasks'] });

      onSuccessResource?.(result);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const isLoading = srLoading || orgLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Create New Task</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {isLoading ? (
            <LoadingSpinner message="Loading clinical data…" />
          ) : (
            <>
              {/* Routing panel */}
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm space-y-3">
                <p className="font-medium text-blue-800">Direct cross-party create (in-browser M2M token)</p>

                {/* Target org selector */}
                <div>
                  <label className="block text-xs font-medium text-blue-700 mb-1">
                    Target organisation
                  </label>
                  {targetableOrgs.length === 0 ? (
                    <p className="text-blue-600 italic text-xs">No organisations with endpoints found in registry.</p>
                  ) : (
                    <select
                      value={selectedTargetOrgId}
                      onChange={(e) => setSelectedTargetOrgId(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-blue-300 rounded bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      {targetableOrgs.map(({ org }) => (
                        <option key={org.id} value={org.id!}>
                          {org.name ?? org.alias?.[0] ?? org.id}
                          {org.alias?.includes(partnerAlias) ? ' (sandbox partner)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Resolved routing info */}
                {selectedEntry && (
                  <div className="text-blue-700 space-y-0.5 text-xs">
                    <p>
                      <span className="font-medium">External host:</span>{' '}
                      <code className="bg-blue-100 px-1 rounded">{effectiveApiHost}</code>
                    </p>
                    <p>
                      <span className="font-medium">Authenticating client:</span>{' '}
                      <code className="bg-blue-100 px-1 rounded">{ownL2ClientId || '—'}</code>
                    </p>
                  </div>
                )}
              </div>

              {/* Task Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Task Details
                </h3>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="Clinical description of this referral task…"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="routine">routine</option>
                    <option value="urgent">urgent</option>
                    <option value="asap">asap</option>
                    <option value="stat">stat</option>
                  </select>
                </div>
              </div>

              {/* Clinical Context */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Clinical Context
                </h3>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Based On (ServiceRequest)
                    <span className="ml-1 text-gray-400 font-normal">— optional</span>
                  </label>
                  <select
                    value={selectedSRId}
                    onChange={(e) => setSelectedSRId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">None selected</option>
                    {serviceRequests.map((sr) => (
                      <option key={sr.id} value={sr.id!}>
                        {sr.id} — {sr.category?.[0]?.coding?.[0]?.display ?? sr.code?.coding?.[0]?.display ?? 'ServiceRequest'}
                      </option>
                    ))}
                  </select>
                  {selectedSR && (
                    <p className="mt-1 text-xs text-gray-500 font-mono">
                      Patient: {selectedSR.subject?.reference}
                    </p>
                  )}
                </div>

                <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                  Authorization is context-centric: the Fulfiller will request a token with{' '}
                  <code className="bg-gray-100 px-1 rounded">authorization_details</code> referencing
                  the ServiceRequest above. OPA locates the Consent automatically via{' '}
                  <code className="bg-gray-100 px-1 rounded">Consent?data=ServiceRequest/&lt;id&gt;&amp;status=active</code>.
                </p>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="btn-secondary" disabled={submitting}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || isLoading || !effectiveOwnerRef}
            className="btn-primary disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateTaskModal;
