import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRole } from '../../contexts/RoleContext';
import { useLog } from '../../contexts/LogContext';
import { useFhirClient } from '../../hooks/useFhirClient';
import { useAllTasks, useFhirSearch } from '../../hooks/useFhirSearch';
import type { Bundle, FhirResource, Organization, ServiceRequest, Task } from '../../types/fhir';
import JsonViewer from '../common/JsonViewer';
import LoadingSpinner from '../common/LoadingSpinner';
import StatusBadge from '../common/StatusBadge';
import CreateResourceModal from '../fhir/CreateResourceModal';
import CreateTaskModal from '../fhir/CreateTaskModal';
import ResourceEditForm from '../fhir/ResourceEditForm';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type TaskSource = 'local' | 'remote';
interface TaggedTask extends Task {
  _source: TaskSource;
}

// ---------------------------------------------------------------------------
// Wizard sub-modals
// ---------------------------------------------------------------------------

/** Read-only JSON viewer with Continue / Close buttons */
const WizardResourceViewModal: React.FC<{
  open: boolean;
  title: string;
  resource: unknown;
  onContinue: () => void;
  onClose: () => void;
}> = ({ open, title, resource, onContinue, onClose }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <JsonViewer data={resource} collapsed={false} />
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="btn-secondary">Close</button>
          <button onClick={onContinue} className="btn-primary">Continue →</button>
        </div>
      </div>
    </div>
  );
};

/** Task edit form (used for status update) */
const WizardUpdateModal: React.FC<{
  open: boolean;
  resource: FhirResource | null;
  onClose: () => void;
  onSuccess: (resource: FhirResource) => void;
}> = ({ open, resource, onClose, onSuccess }) => {
  if (!open || !resource) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Update {resource.resourceType}/{resource.id}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <ResourceEditForm resource={resource} onSaved={onClose} onSavedResource={onSuccess} />
        </div>
      </div>
    </div>
  );
};

/** Task-list modal — mirrors the TaskList UI so the user can pick a task */
const WizardTaskSelectModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSelect: (task: TaggedTask) => void;
}> = ({ open, onClose, onSelect }) => {
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<TaggedTask | null>(null);

  const searchParams: Record<string, string> = {};
  if (statusFilter) searchParams['status'] = statusFilter;

  const { data: allTasksData, isLoading } = useAllTasks(searchParams);

  const tasks: TaggedTask[] = [
    ...((allTasksData?.local?.entry?.map((e) => e.resource).filter(Boolean) as Task[]) ?? []).map(
      (t) => ({ ...t, _source: 'local' as const })
    ),
    ...((allTasksData?.remote?.entry?.map((e) => e.resource).filter(Boolean) as Task[]) ?? []).map(
      (t) => ({ ...t, _source: 'remote' as const })
    ),
  ];

  const extractRef = (ref?: { reference?: string; display?: string }) =>
    ref?.display ?? ref?.reference ?? '-';

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Step 1 — Select Task</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Status filter */}
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setSelected(null); }}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All statuses</option>
            <option value="ready">Ready</option>
            <option value="in-progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {selected && (
            <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
              Selected: Task/{selected.id}
            </span>
          )}
        </div>

        {/* Task rows */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && <LoadingSpinner message="Loading tasks…" />}
          {!isLoading && tasks.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">No tasks found.</div>
          )}
          {tasks.map((task) => {
            const isSelected = selected?.id === task.id && selected?._source === task._source;
            return (
              <button
                key={`${task._source}-${task.id}`}
                onClick={() => setSelected(task)}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono text-gray-400">Task/{task.id}</span>
                  <div className="flex items-center gap-1">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        task._source === 'local'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {task._source}
                    </span>
                    <StatusBadge status={task.status} />
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-900">
                  {task.description ?? task.code?.coding?.[0]?.display ?? 'Task'}
                </p>
                <div className="flex gap-4 mt-1 text-xs text-gray-500">
                  <span>Patient: {extractRef(task.for)}</span>
                  <span>Owner: {extractRef(task.owner)}</span>
                  {task.priority && <StatusBadge status={task.priority} />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="btn-secondary">Close</button>
          <button
            onClick={() => { if (selected) { onSelect(selected); setSelected(null); } }}
            disabled={!selected}
            className="btn-primary disabled:opacity-50"
          >
            Select Task →
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// WorkflowWizard
// ---------------------------------------------------------------------------

const WorkflowWizard: React.FC = () => {
  const { activeRole, partnerExternalBaseUrl } = useRole();
  const { addLog } = useLog();
  const client = useFhirClient();
  const queryClient = useQueryClient();

  const { data: orgBundle } = useFhirSearch<Organization>('Organization', {});
  const organizations = (orgBundle?.entry?.map((e) => e.resource).filter(Boolean) as Organization[]) ?? [];
  const partnerOrigin = new URL(partnerExternalBaseUrl).origin;
  const partnerOrg = organizations.find((o) =>
    o.meta?.tag?.some((tag) => tag.system === 'urn:umzh:api:external-host' && tag.code === partnerOrigin)
  );

  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, unknown>>({});

  // Modal state
  const [pendingResult, setPendingResult] = useState<unknown>(null);
  const [viewModal, setViewModal] = useState({ open: false, title: '' });
  const [createModal, setCreateModal] = useState<{
    open: boolean;
    type: string;
    draft: Record<string, unknown>;
  }>({ open: false, type: '', draft: {} });
  const [taskModal, setTaskModal] = useState({ open: false, srId: '', consentId: '' });
  const [updateModal, setUpdateModal] = useState<{
    open: boolean;
    resource: FhirResource | null;
  }>({ open: false, resource: null });
  const [taskSelectModal, setTaskSelectModal] = useState(false);

  // Step metadata
  const placerSteps = [
    {
      title: 'Step 1: Create ServiceRequest',
      description: 'Open a pre-filled ServiceRequest form for Petra Meier (Ortho referral).',
    },
    {
      title: 'Step 2: Create Consent',
      description: 'Open a Consent form linked to the ServiceRequest created in step 1.',
    },
    {
      title: 'Step 3: Create Task at Fulfiller',
      description: 'Open the Task form with SR and Consent pre-selected.',
    },
  ];

  const fulfillerSteps = [
    {
      title: 'Step 1: Select Task',
      description: 'Choose an incoming Task from the task list to process.',
    },
    {
      title: 'Step 2: Load Content',
      description: 'Fetch the linked ServiceRequest from the Placer via the proxy gateway.',
    },
    {
      title: 'Step 3: Update Status',
      description: 'Set the Task status to in-progress to acknowledge processing.',
    },
  ];

  const steps = activeRole === 'placer' ? placerSteps : fulfillerSteps;

  // -------------------------------------------------------------------------
  // Dispatch on "Run step" click
  // -------------------------------------------------------------------------

  const handleRunStep = async () => {
    if (step >= steps.length) return;

    if (activeRole === 'placer') {
      if (step === 0) {
        setCreateModal({
          open: true,
          type: 'ServiceRequest',
          draft: {
            identifier: [
              {
                type: {
                  coding: [
                    { system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'PLAC' },
                  ],
                },
                value: `REF-${Date.now()}`,
              },
            ],
            status: 'active',
            intent: 'order',
            category: [
              {
                coding: [
                  {
                    system: 'http://snomed.info/sct',
                    code: '183545006',
                    display: 'Referral to orthopedic service (procedure)',
                  },
                ],
              },
            ],
            subject: { reference: 'Patient/PetraMeier', display: 'Petra Meier' },
            authoredOn: new Date().toISOString().split('T')[0],
            requester: { reference: 'PractitionerRole/HansMusterRole' },
            note: [{ text: 'New referral created via workflow wizard.' }],
          },
        });
      } else if (step === 1) {
        const sr = results['step-0'] as ServiceRequest | undefined;
        const patientRef = sr?.subject?.reference ?? 'Patient/PetraMeier';
        const patientDisplay = sr?.subject?.display ?? 'Petra Meier';
        const srId = sr?.id;

        // Fetch the latest SR list from the server so the Consent dropdown is
        // as up-to-date as possible.
        setRunning(true);
        try {
          await queryClient.fetchQuery({
            queryKey: ['fhir', activeRole, 'ServiceRequest', {}],
            queryFn: () => client.search('ServiceRequest', {}),
            staleTime: 0,
          });
        } catch (err) {
          addLog({
            type: 'error',
            message: `Pre-fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          });
        } finally {
          setRunning(false);
        }

        // Always inject the newly created SR AFTER the network fetch.
        // This is the critical step: if the server (KrakenD cache or HAPI
        // search index) hasn't included the just-created resource yet, we
        // add it ourselves. The setQueryData guard prevents duplicates when
        // the server already returned it. Running this AFTER fetchQuery also
        // resets TanStack Query's isInvalidated flag, preventing a background
        // refetch that could silently remove the SR again.
        if (sr) {
          queryClient.setQueryData<Bundle>(
            ['fhir', activeRole, 'ServiceRequest', {}],
            (old): Bundle => {
              const entry = { resource: sr as FhirResource };
              if (!old) {
                return { resourceType: 'Bundle', type: 'searchset', total: 1, entry: [entry] };
              }
              if (old.entry?.some((e) => e.resource?.id === sr.id)) return old;
              return {
                ...old,
                total: (old.total ?? 0) + 1,
                entry: [...(old.entry ?? []), entry],
              };
            }
          );
        }

        setCreateModal({
          open: true,
          type: 'Consent',
          draft: {
            status: 'active',
            patient: { reference: patientRef, display: patientDisplay },
            ...(srId && { sourceReference: { reference: `ServiceRequest/${srId}` } }),
            ...(partnerOrg?.id && { performer: [{ reference: `Organization/${partnerOrg.id}` }] }),
            dateTime: new Date().toISOString(),
            provision: {
              type: 'permit',
              period: {
                start: new Date().toISOString().split('T')[0],
                end: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
                  .toISOString()
                  .split('T')[0],
              },
            },
          },
        });
      } else if (step === 2) {
        const sr = results['step-0'] as ServiceRequest | undefined;
        const consent = results['step-1'] as FhirResource | undefined;

        // Synchronously inject the newly-created Consent (and SR) into cache
        // so the Task modal's dropdowns are pre-selected on first render.
        if (consent) {
          queryClient.setQueryData<Bundle>(
            ['fhir', activeRole, 'Consent', {}],
            (old): Bundle => {
              const entry = { resource: consent };
              if (!old) {
                return { resourceType: 'Bundle', type: 'searchset', total: 1, entry: [entry] };
              }
              if (old.entry?.some((e) => e.resource?.id === consent.id)) return old;
              return {
                ...old,
                total: (old.total ?? 0) + 1,
                entry: [...(old.entry ?? []), entry],
              };
            }
          );
        }
        if (sr) {
          queryClient.setQueryData<Bundle>(
            ['fhir', activeRole, 'ServiceRequest', {}],
            (old): Bundle => {
              const entry = { resource: sr as FhirResource };
              if (!old) {
                return { resourceType: 'Bundle', type: 'searchset', total: 1, entry: [entry] };
              }
              if (old.entry?.some((e) => e.resource?.id === sr.id)) return old;
              return {
                ...old,
                total: (old.total ?? 0) + 1,
                entry: [...(old.entry ?? []), entry],
              };
            }
          );
        }

        setTaskModal({
          open: true,
          srId: sr?.id ?? '',
          consentId: consent?.id ?? '',
        });
      }

    } else {
      // -----------------------------------------------------------------------
      // Fulfiller steps
      // -----------------------------------------------------------------------
      if (step === 0) {
        // Open the task-select modal — user picks the task they want to process
        setTaskSelectModal(true);

      } else if (step === 1) {
        // Load content: replicate TaskList's "Load Content" button logic exactly.
        // Builds an _include search URL and forwards the X-Consent-Id header.
        const task = results['step-0'] as TaggedTask | undefined;
        const ref = task?.basedOn?.[0]?.reference;
        if (!ref) {
          addLog({ type: 'error', message: 'No basedOn reference on selected Task.' });
          return;
        }

        setRunning(true);
        try {
          addLog({ type: 'info', message: `Loading content for ${ref}…` });

          const lastSlash = ref.lastIndexOf('/');
          const id = ref.substring(lastSlash + 1);
          const typeBase = ref.substring(0, lastSlash); // e.g. "http://…/proxy/fhir/ServiceRequest"

          const searchUrl =
            `${typeBase}?_id=${encodeURIComponent(id)}` +
            `&_include=ServiceRequest:subject:Patient` +
            `&_include=ServiceRequest:requester:Practitioner`;

          // Consent ID lives in meta.security (system: 'urn:umzh:consent:id')
          const consentId = task?.meta?.security?.find(
            (s) => s.system === 'urn:umzh:consent:id'
          )?.code;

          const data = await client.fetchAbsolute<FhirResource>(
            searchUrl,
            consentId ? { 'X-Consent-Id': consentId } : undefined
          );

          setPendingResult(data);
          setViewModal({ open: true, title: 'Step 2 — ServiceRequest Content (read-only)' });
        } catch (err) {
          addLog({
            type: 'error',
            message: `Load content failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          });
        } finally {
          setRunning(false);
        }

      } else if (step === 2) {
        // Open update modal for the selected Task, pre-set to in-progress
        const task = results['step-0'] as Task | undefined;
        if (!task?.id) {
          addLog({ type: 'error', message: 'No Task available from step 1.' });
          return;
        }
        const updatedTask: Task = {
          ...task,
          status: 'in-progress',
          lastModified: new Date().toISOString(),
        };
        setUpdateModal({ open: true, resource: updatedTask });
      }
    }
  };

  // -------------------------------------------------------------------------
  // Success handlers
  // -------------------------------------------------------------------------

  const advanceStep = (result: unknown) => {
    setResults((prev) => ({ ...prev, [`step-${step}`]: result }));
    setStep((prev) => prev + 1);
  };

  const handleCreateSuccess = (resource: FhirResource) => {
    advanceStep(resource);
    setCreateModal({ open: false, type: '', draft: {} });
  };

  const handleTaskSuccess = (resource: FhirResource) => {
    advanceStep(resource);
    setTaskModal({ open: false, srId: '', consentId: '' });
  };

  const handleViewContinue = () => {
    advanceStep(pendingResult);
    setPendingResult(null);
    setViewModal({ open: false, title: '' });
  };

  const handleUpdateSuccess = (resource: FhirResource) => {
    advanceStep(resource);
    setUpdateModal({ open: false, resource: null });
  };

  const handleTaskSelect = (task: TaggedTask) => {
    advanceStep(task);
    setTaskSelectModal(false);
  };

  // -------------------------------------------------------------------------

  const handleReset = () => {
    setStep(0);
    setResults({});
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Workflow Wizard</h2>
        <p className="text-gray-500 mt-1">
          Step-by-step walkthrough of the clinical order workflow from the{' '}
          <strong>{activeRole === 'placer' ? 'Placer' : 'Fulfiller'}</strong> perspective.
        </p>
      </div>

      {/* Step Progress */}
      <div className="flex gap-2">
        {steps.map((s, i) => (
          <div
            key={i}
            className={`flex-1 p-3 rounded-lg border-2 transition-colors ${
              i < step
                ? 'border-green-300 bg-green-50'
                : i === step
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  i < step
                    ? 'bg-green-500 text-white'
                    : i === step
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-300 text-white'
                }`}
              >
                {i < step ? '✓' : i + 1}
              </div>
              <span className="text-sm font-medium">{s.title}</span>
            </div>
            <p className="text-xs text-gray-500 ml-8">{s.description}</p>
          </div>
        ))}
      </div>

      {/* Action */}
      <div className="flex gap-3">
        <button
          onClick={handleRunStep}
          disabled={running || step >= steps.length}
          className="btn-primary disabled:opacity-50"
        >
          {running
            ? 'Running…'
            : step >= steps.length
            ? 'All Steps Complete'
            : `Run: ${steps[step].title}`}
        </button>
        <button onClick={handleReset} className="btn-secondary">
          Reset
        </button>
      </div>

      {/* Results */}
      {Object.keys(results).length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Step Results</h3>
          {Object.entries(results).map(([key, value]) => (
            <JsonViewer
              key={key}
              data={value}
              title={`${key}: ${(value as FhirResource)?.resourceType ?? 'Result'}/${
                (value as FhirResource)?.id ?? ''
              }`}
              collapsed={true}
            />
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Modals                                                               */}
      {/* ------------------------------------------------------------------ */}

      {/* Placer: create resource */}
      <CreateResourceModal
        open={createModal.open}
        resourceType={createModal.type}
        initialDraft={createModal.draft}
        onClose={() => setCreateModal({ open: false, type: '', draft: {} })}
        onSuccess={() => {}}
        onSuccessResource={handleCreateSuccess}
      />

      {/* Placer: create task */}
      <CreateTaskModal
        open={taskModal.open}
        defaultSRId={taskModal.srId}
        defaultConsentId={taskModal.consentId}
        onClose={() => setTaskModal({ open: false, srId: '', consentId: '' })}
        onSuccess={() => {}}
        onSuccessResource={handleTaskSuccess}
      />

      {/* Fulfiller step 1: task selection */}
      <WizardTaskSelectModal
        open={taskSelectModal}
        onClose={() => setTaskSelectModal(false)}
        onSelect={handleTaskSelect}
      />

      {/* Fulfiller step 2: read-only content view */}
      <WizardResourceViewModal
        open={viewModal.open}
        title={viewModal.title}
        resource={pendingResult}
        onContinue={handleViewContinue}
        onClose={() => {
          setPendingResult(null);
          setViewModal({ open: false, title: '' });
        }}
      />

      {/* Fulfiller step 3: status update */}
      <WizardUpdateModal
        open={updateModal.open}
        resource={updateModal.resource}
        onClose={() => setUpdateModal({ open: false, resource: null })}
        onSuccess={handleUpdateSuccess}
      />
    </div>
  );
};

export default WorkflowWizard;
