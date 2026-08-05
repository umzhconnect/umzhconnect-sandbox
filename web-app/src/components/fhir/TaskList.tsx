import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAllTasks } from '../../hooks/useFhirSearch';
import { useFhirClient, useCrossPartyFetch, usePartnerClient } from '../../hooks/useFhirClient';
import { useRole } from '../../contexts/RoleContext';
import { useLog } from '../../contexts/LogContext';
import type { Task, FhirResource, TaskParameter } from '../../types/fhir';
import StatusBadge from '../common/StatusBadge';
import JsonViewer from '../common/JsonViewer';
import LoadingSpinner from '../common/LoadingSpinner';
import type { QuestionnaireNavState } from '../../pages/QuestionnairePage';

// Task.output entries that point at a Questionnaire carry it as either an
// absolute valueCanonical (the common case — see the orthopedic-surgery
// use case) or a valueReference; both are absolute URLs per IG convention.
const extractQuestionnaireUrl = (out: TaskParameter): string | undefined => {
  if (out.valueCanonical?.includes('/Questionnaire/')) return out.valueCanonical;
  if (out.valueReference?.reference?.includes('Questionnaire/')) return out.valueReference.reference;
  return undefined;
};

// Task.input entries that point at a QuestionnaireResponse (added once the
// placer submits the filled form — see QuestionnairePage's handleSubmit).
const extractQuestionnaireResponseUrl = (inp: TaskParameter): string | undefined => {
  if (inp.valueReference?.reference?.includes('/QuestionnaireResponse/')) return inp.valueReference.reference;
  return undefined;
};

type TaskSource = 'local' | 'remote';
interface TaggedTask extends Task {
  _source: TaskSource;
}

const TaskList: React.FC = () => {
  const { activeRole, registryBaseUrl, ownOrgRegistryRef } = useRole();
  const { addLog } = useLog();
  const client = useFhirClient();
  const crossPartyFetch = useCrossPartyFetch();
  const getPartnerClient = usePartnerClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState('');
  const [selectedTask, setSelectedTask] = useState<TaggedTask | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editOwner, setEditOwner] = useState('');
  const [saving, setSaving] = useState(false);

  const [srModalOpen, setSrModalOpen] = useState(false);
  const [srModalLoading, setSrModalLoading] = useState(false);
  const [srModalData, setSrModalData] = useState<FhirResource | null>(null);
  const [srModalError, setSrModalError] = useState<string | null>(null);

  const searchParams: Record<string, string> = {};
  if (statusFilter) searchParams['status'] = statusFilter;

  const { data: allTasksData, isLoading, error } = useAllTasks(searchParams);

  const tasks: TaggedTask[] = [
    ...((allTasksData?.local?.entry?.map((e) => e.resource).filter(Boolean) as Task[]) || [])
      .map((t) => ({ ...t, _source: 'local' as const })),
    ...((allTasksData?.remote?.entry?.map((e) => e.resource).filter(Boolean) as Task[]) || [])
      .map((t) => ({ ...t, _source: 'remote' as const })),
  ];

  const handleSelectTask = (task: TaggedTask) => {
    setSelectedTask(task);
    setEditStatus(task.status);
    setEditOwner(task.owner?.reference || '');
  };

  const patchSelectedTask = async (
    ops: Array<{ op: string; path: string; value?: unknown }>,
    logMessage: string
  ) => {
    if (!selectedTask) return;
    setSaving(true);
    try {
      addLog({ type: 'info', message: logMessage });
      const targetClient =
        selectedTask._source === 'remote' ? await getPartnerClient() : client;
      const result = await targetClient.patch<Task>('Task', selectedTask.id!, ops);
      setSelectedTask({ ...result, _source: selectedTask._source });
      await queryClient.invalidateQueries({queryKey: ['all-tasks', activeRole]});
    } catch (err) {
      console.error('Task update failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleMoveToPlacer = () => {
    if (!selectedTask) return;
    patchSelectedTask(
      [
        { op: 'replace', path: '/owner', value: { reference: placerOrgRef } },
        {
          op: 'add',
          path: '/businessStatus',
          value: {
            coding: [{ system: 'http://hl7.org/fhir/uv/cow/CodeSystem/temp', code: 'awaiting-information' }],
          },
        },
      ],
      `Patching Task/${selectedTask.id}: owner=${placerOrgRef}, businessStatus=awaiting-information`
    );
  };

  const handleMoveToFulfiller = () => {
    if (!selectedTask) return;
    const ops: Array<{ op: string; path: string; value?: unknown }> = [
      { op: 'replace', path: '/owner', value: { reference: fulfillerOrgRef } },
    ];
    if (selectedTask.businessStatus) {
      ops.push({ op: 'remove', path: '/businessStatus' });
    }
    patchSelectedTask(ops, `Patching Task/${selectedTask.id}: owner=${fulfillerOrgRef}, businessStatus removed`);
  };

  const handleSetTaskStatus = (newStatus: string) => {
    if (!selectedTask) return;
    patchSelectedTask(
      [{ op: 'replace', path: '/status', value: newStatus }],
      `Patching Task/${selectedTask.id}: status=${newStatus}`
    );
  };

  const handleLoadBasedOn = async () => {
    const ref = selectedTask?.basedOn?.[0]?.reference;
    if (!ref) return;

    setSrModalOpen(true);
    setSrModalLoading(true);
    setSrModalError(null);
    setSrModalData(null);

    try {
      // Parse "…/ServiceRequest/SomeId" — split at last slash to get type base + id.
      // The reference points at the partner's external gateway (absolute URL), so
      // we call it directly with an M2M token whose fhirContext is this SR.
      const lastSlash = ref.lastIndexOf('/');
      const id = ref.substring(lastSlash + 1);
      const typeBase = ref.substring(0, lastSlash); // e.g. "http://localhost:8083/fhir/ServiceRequest"

      // Build an _id search with included resources.
      const searchUrl =
        `${typeBase}?_id=${encodeURIComponent(id)}` +
        `&_include=ServiceRequest:subject` +
        `&_include=ServiceRequest:requester` +
        `&_include=ServiceRequest:supporting-info`;

      // Mint an M2M token bound to this ServiceRequest as fhirContext, then read
      // directly from the partner external gateway (OPA validates the context).
      const data = await crossPartyFetch<FhirResource>(searchUrl, `ServiceRequest/${id}`);

      setSrModalData(data);
    } catch (err) {
      setSrModalError(err instanceof Error ? err.message : 'Failed to load ServiceRequest');
    } finally {
      setSrModalLoading(false);
    }
  };

  const handleFillQuestionnaire = (questionnaireUrl: string, readOnly: boolean) => {
    if (!selectedTask) return;
    const state: QuestionnaireNavState = {
      questionnaireUrl,
      task: selectedTask,
      patientRef: selectedTask.for!,
      readOnly,
    };
    navigate('/questionnaire', { state });
  };

  const handleViewQuestionnaireResponse = (questionnaireResponseUrl: string) => {
    if (!selectedTask) return;
    const state: QuestionnaireNavState = {
      questionnaireResponseUrl,
      task: selectedTask,
      patientRef: selectedTask.for!,
      readOnly: true,
    };
    navigate('/questionnaire', { state });
  };

  const extractDisplayRef = (ref?: { reference?: string; display?: string }): string => {
    if (!ref) return '-';
    return ref.display || ref.reference || '-';
  };

  const placerOrgRef = `${registryBaseUrl}/Organization/HospitalP`;
  const fulfillerOrgRef = `${registryBaseUrl}/Organization/HospitalF`;

  const isOwnTask = selectedTask?.owner?.reference === ownOrgRegistryRef;
  const isAssignedToPlacer = selectedTask?.owner?.reference === placerOrgRef;
  const isAssignedToFulfiller = selectedTask?.owner?.reference === fulfillerOrgRef;
  const isOwnFulfillerTask = isAssignedToFulfiller && isOwnTask;
  const isInProgress = selectedTask?.status === 'in-progress';
  const canAccept = isOwnFulfillerTask && selectedTask?.status === 'requested';
  const canReject = isOwnFulfillerTask && selectedTask?.status === 'requested';
  const canStartWork = isOwnFulfillerTask && selectedTask?.status === 'accepted';
  const canFail = isOwnFulfillerTask && isInProgress;
  const canComplete = isOwnFulfillerTask && isInProgress;
  const canFillQuestionnaire =
        activeRole === 'placer' &&
        selectedTask?.owner?.reference === placerOrgRef &&
        selectedTask?.status === 'in-progress';

  return (
    <div className="flex gap-4 h-full">
      {/* Task List */}
      <div className="w-1/2 flex flex-col">
        <div className="flex gap-3 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All Statuses</option>
            <option value="ready">Ready</option>
            <option value="in-progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="flex-1 overflow-auto border border-gray-200 rounded-lg">
          {isLoading && <LoadingSpinner message="Loading tasks..." />}
          {error && (
            <div className="p-4 text-red-600 text-sm">Failed to load tasks</div>
          )}
          {!isLoading && tasks.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">No tasks found.</div>
          )}
          {tasks.map((task) => (
            <button
              key={`${task._source}-${task.id}`}
              onClick={() => handleSelectTask(task)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                selectedTask?.id === task.id && selectedTask?._source === task._source
                  ? 'bg-blue-50 border-l-4 border-l-blue-500'
                  : ''
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
                {task.description || task.code?.coding?.[0]?.display || 'Task'}
              </p>
              <div className="flex gap-4 mt-1 text-xs text-gray-500">
                <span>Patient: {extractDisplayRef(task.for)}</span>
                <span>Owner: {extractDisplayRef(task.owner)}</span>
                {task.priority && <StatusBadge status={task.priority} />}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Task Detail */}
      <div className="w-1/2 flex flex-col gap-4">
        {selectedTask ? (
          <>
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-lg font-semibold">Task/{selectedTask.id}</h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    selectedTask._source === 'local'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-purple-100 text-purple-700'
                  }`}
                >
                  {selectedTask._source === 'local' ? 'Local' : 'Remote'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                  <StatusBadge status={selectedTask.status} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Owner</label>
                  <p className="text-gray-900">{extractDisplayRef(selectedTask.owner)}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Business Status</label>
                  <p className="text-gray-900">
                    {selectedTask.businessStatus?.coding?.[0]?.code || selectedTask.businessStatus?.text || '-'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Intent</label>
                  <p className="text-gray-900">{selectedTask.intent}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
                  <p className="text-gray-900">{selectedTask.priority || '-'}</p>
                </div>
                <div className="col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-500">Based On</label>
                    {selectedTask.basedOn?.[0]?.reference && (
                      <button
                        onClick={handleLoadBasedOn}
                        className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                      >
                        Load Content
                      </button>
                    )}
                  </div>
                  <p className="text-gray-900 font-mono text-xs break-all">
                    {selectedTask.basedOn?.[0]?.reference || '-'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Patient</label>
                  <p className="text-gray-900">{extractDisplayRef(selectedTask.for)}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Requester</label>
                  <p className="text-gray-900">{extractDisplayRef(selectedTask.requester)}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Authored</label>
                  <p className="text-gray-900">{selectedTask.authoredOn || '-'}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Last Modified</label>
                  <p className="text-gray-900">{selectedTask.lastModified || '-'}</p>
                </div>
              </div>

              {/* Inputs */}
              {selectedTask.input && selectedTask.input.length > 0 && (
                <div className="mt-4">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Inputs</label>
                  {selectedTask.input.map((inp, i) => {
                    const questionnaireResponseUrl = extractQuestionnaireResponseUrl(inp);
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 text-xs font-mono text-gray-700 bg-gray-50 p-2 rounded mb-1"
                      >
                        <span className="truncate">
                          {inp.type?.coding?.[0]?.display || 'Input'}: {inp.valueReference?.reference || inp.valueCanonical || inp.valueString || '-'}
                        </span>
                        {questionnaireResponseUrl && (
                          <button
                            onClick={() => handleViewQuestionnaireResponse(questionnaireResponseUrl)}
                            className="flex-shrink-0 text-xs px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition-colors font-sans"
                          >
                            See Questionnaire Response
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Outputs */}
              {selectedTask.output && selectedTask.output.length > 0 && (
                <div className="mt-4">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Outputs</label>
                  {selectedTask.output.map((out, i) => {
                    const questionnaireUrl = extractQuestionnaireUrl(out);
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 text-xs font-mono text-gray-700 bg-gray-50 p-2 rounded mb-1"
                      >
                        <span className="truncate">
                          {out.type?.coding?.[0]?.display || 'Output'}: {out.valueReference?.reference || out.valueCanonical || out.valueString || '-'}
                        </span>
                        {questionnaireUrl && canFillQuestionnaire && (
                          <button
                            onClick={() => handleFillQuestionnaire(questionnaireUrl, false)}
                            className="flex-shrink-0 text-xs px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition-colors font-sans"
                          >
                            Fill Questionnaire
                          </button>
                        )}
                        {questionnaireUrl && !canFillQuestionnaire && (
                          <button
                            onClick={() => handleFillQuestionnaire(questionnaireUrl, true)}
                            className="flex-shrink-0 text-xs px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition-colors font-sans"
                          >
                            See Questionnaire
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 flex gap-2">
                {canAccept && (
                  <button
                    onClick={() => handleSetTaskStatus('accepted')}
                    disabled={saving}
                    className="btn-secondary disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Accept Task'}
                  </button>
                )}
                {canAccept && (
                  <button
                    onClick={() => handleSetTaskStatus('in-progress')}
                  disabled={saving}
                  className="btn-secondary disabled:opacity-50"
              >
                  {saving ? 'Saving...' : 'Accept Task and Start Work'}
              </button>
                )}
                {canReject && (
                  <button
                    onClick={() => handleSetTaskStatus('rejected')}
                    disabled={saving}
                    className="btn-secondary disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Reject Task'}
                  </button>
                )}
                {canStartWork && (
                  <button
                    onClick={() => handleSetTaskStatus('in-progress')}
                    disabled={saving}
                    className="btn-secondary disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Start work'}
                  </button>
                )}
                {canFail && (
                  <button
                    onClick={() => handleSetTaskStatus('failed')}
                    disabled={saving}
                    className="btn-secondary disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Fail Task'}
                  </button>
                )}
                {canComplete && (
                  <button
                    onClick={() => handleSetTaskStatus('completed')}
                    disabled={saving}
                    className="btn-secondary disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Complete Task'}
                  </button>
                )}
                {isOwnFulfillerTask && isInProgress && (
                  <button
                    onClick={handleMoveToPlacer}
                    disabled={saving}
                    className="btn-secondary disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Assign Task to placer'}
                  </button>
                )}
                {isAssignedToPlacer && isOwnTask && isInProgress && (
                  <button
                    onClick={handleMoveToFulfiller}
                    disabled={saving}
                    className="btn-secondary disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Assign Task to fulfiller'}
                  </button>
                )}
              </div>
            </div>

            <JsonViewer data={selectedTask} title="JSON View" maxHeight="300px" />
          </>
        ) : (
          <div className="card flex items-center justify-center h-64 text-gray-400 text-sm">
            Select a task to view details
          </div>
        )}
      </div>
      {/* ServiceRequest Content Modal */}
      {srModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSrModalOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200">
              <div className="min-w-0 pr-4">
                <h2 className="text-lg font-semibold text-gray-900">ServiceRequest Content</h2>
                <p className="text-xs text-gray-400 font-mono break-all mt-0.5">
                  {selectedTask?.basedOn?.[0]?.reference}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Includes: <span className="font-mono">ServiceRequest:subject</span>
                  {' · '}
                  <span className="font-mono">ServiceRequest:requester</span>
                  {' · '}
                  <span className="font-mono">ServiceRequest:supporting-info</span>
                </p>
              </div>
              <button
                onClick={() => setSrModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none flex-shrink-0"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {srModalLoading && (
                <LoadingSpinner message="Fetching ServiceRequest…" />
              )}
              {srModalError && (
                <div className="p-4 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg">
                  {srModalError}
                </div>
              )}
              {srModalData && !srModalLoading && (
                <JsonViewer
                  data={srModalData as object}
                  title="Bundle (ServiceRequest + includes)"
                  maxHeight="calc(90vh - 160px)"
                />
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default TaskList;
