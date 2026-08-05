import React, {useEffect, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {QueryClientProvider} from '@tanstack/react-query';
import {
    BaseRenderer,
    RendererThemeProvider,
    useBuildForm,
    useRendererQueryClient,
    getResponse,
} from '@aehrc/smart-forms-renderer';
import {useCrossPartyFetch, useFhirClient, usePartnerClient} from '../hooks/useFhirClient';
import {useRole} from '../contexts/RoleContext';
import type {FhirResource, Questionnaire, QuestionnaireResponse, Reference, Task} from '../types/fhir';
import LoadingSpinner from '../components/common/LoadingSpinner';

// Navigation state passed by TaskList, either when the user clicks "Fill
// Questionnaire" on a Task output (questionnaireUrl set, readOnly reflects
// whether the viewer may edit it) or "See Questionnaire Response" on a Task
// input (questionnaireResponseUrl set instead — always rendered read-only).
export interface QuestionnaireNavState {
    questionnaireUrl?: string;
    questionnaireResponseUrl?: string;
    task: Task;
    patientRef: Reference;
    readOnly?: boolean;
}

const extractIdFromUrl = (url: string): string => url.substring(url.lastIndexOf('/') + 1);

const QuestionnaireFiller: React.FC<{
    questionnaire: Questionnaire;
    existingResponse?: QuestionnaireResponse | null;
    onSubmit: (response: FhirResource) => void;
    submitting: boolean;
    readOnly: boolean;
}> = ({questionnaire, existingResponse, onSubmit, submitting, readOnly}) => {
    // The renderer needs a query client to make API calls
    const queryClient = useRendererQueryClient();

    // This hook builds the form based on the questionnaire
    // We don't make it read-only here because it disables the form entirely, e.g. preventing to open the dropdowns.
    // Instead, we remove the "submit" button
    const isBuilding = useBuildForm({
        questionnaire,
        questionnaireResponse: existingResponse ?? undefined,
    });

    if (isBuilding) {
        return <LoadingSpinner message="Building form…"/>;
    }

    return (
        <RendererThemeProvider>
            <QueryClientProvider client={queryClient}>
                <BaseRenderer/>
            </QueryClientProvider>
            {!readOnly &&
                <div className="mt-4 flex justify-end">
                    <button
                        onClick={() => onSubmit(getResponse() as unknown as FhirResource)}
                        disabled={submitting}
                        className="btn-primary disabled:opacity-50"
                    >
                        {submitting ? 'Submitting…' : 'Submit'}
                    </button>
                </div>
            }
        </RendererThemeProvider>
    );
};

const QuestionnairePage: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const crossPartyFetch = useCrossPartyFetch();
    const client = useFhirClient();
    const getPartnerClient = usePartnerClient();
    const {activeRole, ownExternalBaseUrl} = useRole();

    const navState = location.state as QuestionnaireNavState | null;

    const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
    const [existingResponse, setExistingResponse] = useState<QuestionnaireResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitted, setSubmitted] = useState(false);

    // Both reads are scope-gated only (Rules 2 & 3 in the OPA policy — no
    // fhirContext/consent needed), so the own client works when this party is
    // the resource's home partition, and the partner client otherwise.
    const getClientFor = (party: 'placer' | 'fulfiller') =>
        activeRole === party ? Promise.resolve(client) : getPartnerClient();

    useEffect(() => {
        if (navState?.questionnaireResponseUrl) {
            setLoading(true);
            setLoadError(null);
            (async () => {
                try {
                    // The QuestionnaireResponse is always created by the placer
                    // (see handleSubmit below), so it always lives in the placer's
                    // partition regardless of who is viewing it here.
                    const placerClient = await getClientFor('placer');
                    const qr = await placerClient.read<QuestionnaireResponse>(
                        'QuestionnaireResponse',
                        extractIdFromUrl(navState.questionnaireResponseUrl!)
                    );
                    if (!qr.questionnaire) {
                        throw new Error('QuestionnaireResponse has no questionnaire reference');
                    }
                    // The Questionnaire itself is the one the fulfiller offered as a
                    // Task output, so it lives in the fulfiller's partition.
                    // NOTE: in this sandbox, we can't save Questionnaires in a partition, so it lives in the
                    // DEFAULT partition.
                    const q = await crossPartyFetch<Questionnaire>(qr.questionnaire)
                    setExistingResponse(qr);
                    setQuestionnaire(q);
                } catch (err) {
                    setLoadError(err instanceof Error ? err.message : 'Failed to load questionnaire response');
                } finally {
                    setLoading(false);
                }
            })();
            return;
        }

        if (!navState?.questionnaireUrl) return;
        setLoading(true);
        setLoadError(null);
        // Questionnaire reads are scope-gated only (no fhirContext required), so
        // this works whether the Questionnaire lives on our own or the partner's
        // external gateway.
        crossPartyFetch<Questionnaire>(navState.questionnaireUrl)
            .then(setQuestionnaire)
            .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load questionnaire'))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navState?.questionnaireUrl, navState?.questionnaireResponseUrl]);

    const readOnly = navState?.readOnly ?? true;

    const handleSubmit = async (rawResponse: FhirResource) => {
        setSubmitting(true);
        setSubmitError(null);
        try {
            const response: QuestionnaireResponse = {
                ...(rawResponse as unknown as QuestionnaireResponse),
                status: 'completed',
                questionnaire: questionnaire?.url ?? navState?.questionnaireUrl,
                subject: navState?.patientRef,
                authored: new Date().toISOString(),
            };
            const [_, questionnaireResponseId] = await client.create(response);

            const serviceRequestRef = navState!.task!.basedOn?.[0].reference!
            const serviceRequestId = serviceRequestRef.split('/').pop()!

            // The placer adds a reference to this QuestionnaireResponse in their ServiceRequest
            // Otherwise the fulfiller won't have access to it
            await client.patch('ServiceRequest', serviceRequestId, [
                {
                    op: 'add',
                    path: '/supportingInfo/-',
                    value: { reference: `QuestionnaireResponse/${questionnaireResponseId}` }
                }
            ])

            const partnerClient = await getPartnerClient()
            await partnerClient.patch('Task', navState!.task!.id!, [
                {
                    op: 'add',
                    path: '/input/-',
                    value: [
                        {
                            "type" : {
                                "coding" : [
                                    {
                                        "system" : "http://snomed.info/sct",
                                        "code" : "273510007",
                                        "display" : "Health assessment questionnaire"
                                    }
                                ]
                            },
                            "valueReference": {
                                // Absolute reference using our own external gateway address — the
                                // QuestionnaireResponse lives on our server, so the partner (who
                                // owns the Task) must be able to dereference it from theirs.
                                "reference": `${ownExternalBaseUrl}/QuestionnaireResponse/${questionnaireResponseId}`
                            }
                        }
                    ]
                }
            ])

            setSubmitted(true);
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Failed to submit questionnaire response');
        } finally {
            setSubmitting(false);
        }
    };

    if (!navState?.questionnaireUrl && !navState?.questionnaireResponseUrl) {
        return (
            <div className="card text-sm text-gray-500">
                No questionnaire selected. Open a Task with a Questionnaire output and click "Fill Questionnaire",
                or a Task input and click "See Questionnaire Response".
            </div>
        );
    }

    return (
        <div className="space-y-4 w-full">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                        {questionnaire?.title ?? questionnaire?.name ?? 'Questionnaire'}
                    </h2>
                    <p className="text-xs text-gray-400 font-mono break-all">
                        {navState.questionnaireUrl ?? navState.questionnaireResponseUrl}
                    </p>
                </div>
                <button onClick={() => navigate(-1)} className="btn-secondary text-sm py-1 px-3">
                    Back
                </button>
            </div>

            {loading && <LoadingSpinner message="Loading questionnaire…"/>}
            {loadError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{loadError}</p>
            )}
            {submitError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{submitError}</p>
            )}

            {submitted ? (
                <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                    QuestionnaireResponse submitted, ServiceRequest and Task updated successfully.
                </p>
            ) : (
                questionnaire && (
                    <div className="card">
                        <QuestionnaireFiller questionnaire={questionnaire} existingResponse={existingResponse}
                                             onSubmit={handleSubmit} submitting={submitting} readOnly={readOnly}/>
                    </div>
                )
            )}
        </div>
    );
};

export default QuestionnairePage;
