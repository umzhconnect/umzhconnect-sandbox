import { useQuery } from '@tanstack/react-query';
import { useFhirClient, useRegistryClient, useM2mToken } from './useFhirClient';
import { FhirClient } from '../services/fhir-client';
import { useLog } from '../contexts/LogContext';
import type { Bundle, FhirResource } from '../types/fhir';
import { useRole } from '../contexts/RoleContext';

export interface AllTasksResponse {
  local: Bundle;
  remote: Bundle;
}

const EMPTY_BUNDLE: Bundle = { resourceType: 'Bundle', type: 'searchset', entry: [] };

/**
 * Hook to search FHIR resources on the active party's server.
 */
export function useFhirSearch<T extends FhirResource>(
  resourceType: string,
  params?: Record<string, string>,
  enabled = true
) {
  const client = useFhirClient();
  const { activeRole } = useRole();

  return useQuery<Bundle>({
    queryKey: ['fhir', activeRole, resourceType, params],
    queryFn: () => client.search<T>(resourceType, params),
    enabled,
  });
}

/**
 * Hook to search FHIR resources on the public Organization registry (no auth required).
 */
export function useRegistrySearch<T extends FhirResource>(
  resourceType: string,
  params?: Record<string, string>,
  enabled = true
) {
  const client = useRegistryClient();

  return useQuery<Bundle>({
    queryKey: ['registry', resourceType, params],
    queryFn: () => client.search<T>(resourceType, params),
    enabled,
  });
}

/**
 * Hook to read a single FHIR resource from the active party's server.
 */
export function useFhirRead<T extends FhirResource>(
  resourceType: string,
  id: string | undefined,
  enabled = true
) {
  const client = useFhirClient();
  const { activeRole } = useRole();

  return useQuery<T>({
    queryKey: ['fhir', activeRole, resourceType, id],
    queryFn: () => client.read<T>(resourceType, id!),
    enabled: enabled && !!id,
  });
}

/**
 * Hook to fetch all tasks, grouped as { local, remote }.
 *
 * Pass remoteBaseUrl (an Endpoint.address from the registry) to fetch tasks
 * from a specific remote org. When omitted or null, only local tasks are
 * returned — the remote half stays empty until the caller has an org selected.
 */
export function useAllTasks(params?: Record<string, string>, remoteBaseUrl?: string | null) {
  const client = useFhirClient();
  const getM2mToken = useM2mToken();
  const { addLog } = useLog();
  const { activeRole } = useRole();

  return useQuery<AllTasksResponse>({
    queryKey: ['all-tasks', activeRole, params, remoteBaseUrl ?? null],
    queryFn: async () => {
      const localPromise = client.search('Task', params).catch(() => EMPTY_BUNDLE);

      const remotePromise =
        activeRole === 'registry' || !remoteBaseUrl
          ? Promise.resolve(EMPTY_BUNDLE)
          : getM2mToken()
              .then((token) => new FhirClient(remoteBaseUrl, token, addLog).search('Task', params))
              .catch(() => EMPTY_BUNDLE);

      const [local, remote] = await Promise.all([localPromise, remotePromise]);
      return { local, remote };
    },
  });
}
