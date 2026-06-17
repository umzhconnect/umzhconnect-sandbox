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
  partnerM2mToken: string,
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

  // Step 3: Create Task at Fulfiller — direct call to the partner's external
  // gateway, authenticated with an M2M token the caller minted in-browser.
  onLog?.({
    type: 'info',
    message: 'Step 3: Creating Task at Fulfiller (cross-organization)...',
  });
  const fulfillerClient = new FhirClient(partnerExternalBaseUrl, partnerM2mToken, onLog);
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
