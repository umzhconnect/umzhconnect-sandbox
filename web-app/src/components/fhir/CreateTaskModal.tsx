import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFhirSearch } from '../../hooks/useFhirSearch';
import type { AllTasksResponse } from '../../hooks/useFhirSearch';
import { useFhirClient } from '../../hooks/useFhirClient';
import { useRole } from '../../contexts/RoleContext';
import { useLog } from '../../contexts/LogContext';
import type { FhirResource, Task, ServiceRequest, Consent, Organization } from '../../types/fhir';
import LoadingSpinner from '../common/LoadingSpinner';

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultSRId?: string;
  defaultConsentId?: string;
  onSuccessResource?: (resource: FhirResource) => void;
}

const IRCP_TYPE = {
  coding: [
    {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
      code: 'IRCP',
      display: 'information recipient',
    },
  ],
};

const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  open,
  onClose,
  onSuccess,
  defaultSRId,
  defaultConsentId,
  onSuccessResource,
}) => {
  const { activeRole, apiBasePath, partnerExternalBaseUrl, ownExternalBaseUrl } = useRole();
  const { addLog } = useLog();
  const client = useFhirClient();
  const queryClient = useQueryClient();

  // Form state — initialise SR/Consent from defaults so they're correct on the very first render
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('routine');
  const [selectedSRId, setSelectedSRId] = useState(defaultSRId ?? '');
  const [selectedConsentId, setSelectedConsentId] = useState(defaultConsentId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch local resources (only when modal is open)
  const { data: srBundle, isLoading: srLoading } = useFhirSearch<ServiceRequest>(
    'ServiceRequest',
    {},
    open
  );
  const { data: consentBundle, isLoading: consentLoading } = useFhirSearch<Consent>(
    'Consent',
    {},
    open
  );
  const { data: orgBundle, isLoading: orgLoading } = useFhirSearch<Organization>(
    'Organization',
    {},
    open
  );

  const serviceRequests =
    (srBundle?.entry?.map((e) => e.resource).filter(Boolean) as ServiceRequest[]) || [];
  const consents =
    (consentBundle?.entry?.map((e) => e.resource).filter(Boolean) as Consent[]) || [];
  const organizations =
    (orgBundle?.entry?.map((e) => e.resource).filter(Boolean) as Organization[]) || [];

  // Discover partner organization from meta.tag — the one whose external-host
  // matches the partner's origin derived from partnerExternalBaseUrl.
  const partnerOrigin = new URL(partnerExternalBaseUrl).origin;
  const partnerOrg = organizations.find((org) =>
    org.meta?.tag?.some(
      (t) => t.system === 'urn:umzh:api:external-host' && t.code === partnerOrigin
    )
  );
  const partnerClientId = partnerOrg?.meta?.tag?.find(
    (t) => t.system === 'urn:umzh:keycloak:client-id'
  )?.code;
  const partnerApiHost = partnerOrg?.meta?.tag?.find(
    (t) => t.system === 'urn:umzh:api:external-host'
  )?.code;

  // Build the owner reference using THIS party's own external gateway URL so the
  // receiving party can follow the link through our external API. HAPI treats
  // absolute references as external and stores them verbatim — no placeholder
  // creation, no HAPI-0825.
  const partnerOrgAbsoluteRef =
    partnerOrg?.id ? `${ownExternalBaseUrl}/Organization/${partnerOrg.id}` : undefined;

  // Derive patient from selected ServiceRequest, fallback to PetraMeier
  const selectedSR = serviceRequests.find((sr) => sr.id === selectedSRId) ?? null;
  const patientRef = selectedSR?.subject?.reference ?? 'Patient/PetraMeier';
  const patientDisplay = selectedSR?.subject?.display ?? 'Petra Meier';

  // Reset / initialise form on open/close
  useEffect(() => {
    if (open) {
      // Pre-populate from wizard defaults when provided
      setSelectedSRId(defaultSRId ?? '');
      setSelectedConsentId(defaultConsentId ?? '');
      setDescription('');
      setPriority('routine');
      setError(null);
    } else {
      setDescription('');
      setPriority('routine');
      setSelectedSRId('');
      setSelectedConsentId('');
      setError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!selectedConsentId) {
      setError('A Consent must be selected to authorise cross-party data access.');
      return;
    }

    setSubmitting(true);
    setError(null);

    // All references inside the Task body must use ownExternalBaseUrl (this
    // party's external gateway) so the receiving party can resolve them.
    // Using apiBasePath (the internal gateway) would produce URLs the partner
    // cannot reach.
    const srRef = selectedSRId
      ? `${ownExternalBaseUrl}/ServiceRequest/${selectedSRId}`
      : undefined;

    const task: Task = {
      resourceType: 'Task',
      meta: {
        security: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
            code: 'CONSENT',
            display: 'consent',
          },
          {
            system: 'urn:umzh:consent:id',
            code: selectedConsentId,
          },
        ],
      },
      status: 'ready',
      intent: 'order',
      priority,
      description: description || undefined,
      ...(srRef && {
        basedOn: [{ reference: srRef }],
        focus: { reference: srRef },
      }),
      for: { reference: `${ownExternalBaseUrl}/${patientRef}`, display: patientDisplay },
      authoredOn: new Date().toISOString(),
      requester: {
        reference: `${ownExternalBaseUrl}/PractitionerRole/HansMusterRole`,
        display: 'Dr. med. Hans Muster',
      },
      ...(partnerOrgAbsoluteRef && {
        owner: {
          reference: partnerOrgAbsoluteRef,
          display: partnerOrg?.name ?? partnerOrg?.alias?.[0],
        },
      }),
      input: [
        {
          type: IRCP_TYPE,
          valueReference: {
            reference: `${ownExternalBaseUrl}/Consent/${selectedConsentId}`,
          },
        },
      ],
    };

    addLog({ type: 'info', message: `Creating Task → ${partnerApiHost}/fhir/Task via /api/actions/create-task` });

    try {
      const result = await client.postAction<Task>('/api/actions/create-task', task);

      // Await invalidation so any CURRENTLY-ACTIVE all-tasks subscriber
      // completes its refetch first (same post-fetch injection pattern as SR).
      await queryClient.invalidateQueries({ queryKey: ['all-tasks'] });

      // The task was created on the PARTNER's FHIR partition ('local' from
      // their perspective). Inject it into the partner's all-tasks cache after
      // the invalidation refetch, so switching to their view shows the task
      // immediately even if the FHIR server or KrakenD hasn't indexed it yet.
      // setQueryData also resets isInvalidated=false, preventing a background
      // refetch from silently removing the injected task.
      const partnerRole = activeRole === 'placer' ? 'fulfiller' : 'placer';
      queryClient.setQueryData<AllTasksResponse>(
        ['all-tasks', partnerRole, {}],
        (old): AllTasksResponse => {
          const newEntry = { resource: result };
          const emptyBundle = {
            resourceType: 'Bundle' as const,
            type: 'searchset' as const,
            total: 0,
            entry: [] as { resource: Task }[],
          };
          if (!old) {
            return { local: { ...emptyBundle, total: 1, entry: [newEntry] }, remote: emptyBundle };
          }
          if (old.local?.entry?.some((e) => e.resource?.id === result.id)) return old;
          return {
            ...old,
            local: {
              ...old.local,
              total: (old.local?.total ?? 0) + 1,
              entry: [...(old.local?.entry ?? []), newEntry],
            },
          };
        }
      );

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

  const isLoading = srLoading || consentLoading || orgLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Create New Task</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {isLoading ? (
            <LoadingSpinner message="Loading clinical data…" />
          ) : (
            <>
              {/* Routing panel — tag-based partner discovery */}
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
                <p className="font-medium text-blue-800 mb-1">Routing via /api/actions/create-task</p>
                {partnerOrg ? (
                  <div className="text-blue-700 space-y-0.5">
                    <p>
                      <span className="font-medium">Target:</span>{' '}
                      {partnerOrg.name ?? partnerOrg.alias?.[0] ?? partnerOrg.id}
                    </p>
                    <p>
                      <span className="font-medium">Keycloak client:</span>{' '}
                      <code className="bg-blue-100 px-1 rounded">{partnerClientId ?? '—'}</code>
                    </p>
                    <p>
                      <span className="font-medium">External host:</span>{' '}
                      <code className="bg-blue-100 px-1 rounded">{partnerApiHost ?? '—'}</code>
                    </p>
                  </div>
                ) : (
                  <p className="text-blue-600 italic">Partner organization not found in local partition.</p>
                )}
              </div>

              {/* Task Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Task Details
                </h3>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="Clinical description of this referral task…"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Priority
                  </label>
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Consent <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedConsentId}
                    onChange={(e) => setSelectedConsentId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a consent…</option>
                    {consents.map((c) => (
                      <option key={c.id} value={c.id!}>
                        {c.id} — {c.scope?.coding?.[0]?.code ?? c.status}
                        {c.provision?.period?.end ? ` (expires ${c.provision.period.end})` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedConsentId && (
                    <p className="mt-1 text-xs text-gray-500">
                      Sets <code className="bg-gray-100 px-1 rounded">meta.security[CONSENT]</code> and{' '}
                      <code className="bg-gray-100 px-1 rounded">input[IRCP]</code> on the Task.
                    </p>
                  )}
                </div>
              </div>

              {/* Error */}
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
            disabled={submitting || isLoading || !partnerOrgAbsoluteRef}
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
