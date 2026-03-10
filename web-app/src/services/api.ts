// =============================================================================
// API Service - High-level operations for the Clinical Order Workflow
// =============================================================================

import { FhirClient } from './fhir-client';
import type { Task, ServiceRequest, Consent, LogEntry } from '../types/fhir';

type LogCallback = (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;

/**
 * Create a complete referral workflow:
 * 1. Create/validate ServiceRequest at Placer
 * 2. Create Consent at Placer
 * 3. Create Task at Fulfiller (via external API)
 */
export async function createReferralWorkflow(
  placerClient: FhirClient,
  partnerExternalBaseUrl: string,
  serviceRequest: ServiceRequest,
  consent: Consent,
  task: Task,
  onLog?: LogCallback
): Promise<{ serviceRequest: ServiceRequest; consent: Consent; task: Task }> {
  onLog?.({
    type: 'info',
    message: '--- Starting Referral Workflow ---',
  });

  // Step 1: Create ServiceRequest at Placer
  onLog?.({
    type: 'info',
    message: 'Step 1: Creating ServiceRequest at Placer FHIR server...',
  });
  const createdSR = await placerClient.create(serviceRequest);

  // Step 2: Create Consent at Placer
  onLog?.({
    type: 'info',
    message: 'Step 2: Creating Consent for the ServiceRequest...',
  });
  const createdConsent = await placerClient.create(consent);

  // Step 3: Create Task at Fulfiller (external API via proxy)
  onLog?.({
    type: 'info',
    message: 'Step 3: Creating Task at Fulfiller (cross-organization)...',
  });
  const fulfillerClient = new FhirClient(partnerExternalBaseUrl, undefined, onLog);
  const createdTask = await fulfillerClient.create(task);

  onLog?.({
    type: 'info',
    message: '--- Referral Workflow Complete ---',
  });

  return {
    serviceRequest: createdSR,
    consent: createdConsent,
    task: createdTask,
  };
}

/**
 * Update task status and owner (Task state machine transition)
 */
export async function updateTaskStatus(
  client: FhirClient,
  task: Task,
  newStatus: string,
  newOwner?: string,
  onLog?: LogCallback
): Promise<Task> {
  onLog?.({
    type: 'info',
    message: `Updating Task/${task.id}: status=${newStatus}${newOwner ? `, owner=${newOwner}` : ''}`,
  });

  const updatedTask: Task = {
    ...task,
    status: newStatus,
    lastModified: new Date().toISOString(),
  };

  if (newOwner) {
    updatedTask.owner = { reference: newOwner };
  }

  return client.update(updatedTask);
}
