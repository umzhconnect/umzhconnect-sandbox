import { useQuery } from '@tanstack/react-query';
import { useFhirClient, useRegistryClient, usePartnerClient } from './useFhirClient';
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
 * The fan-out is now done client-side (no internal-gateway action endpoint):
 *   * local  — this party's own partition, via the internal gateway (user token)
 *   * remote — the partner's external gateway /fhir/Task, with an in-browser
 *              M2M token (Task list is not fhirContext-gated, so no fhirContext).
 * Registry role has no partner; remote resolves to an empty bundle.
 */
export function useAllTasks(params?: Record<string, string>) {
  const client = useFhirClient();
  const getPartnerClient = usePartnerClient();
  const { activeRole } = useRole();

  return useQuery<AllTasksResponse>({
    queryKey: ['all-tasks', activeRole, params],
    queryFn: async () => {
      const localPromise = client.search('Task', params).catch(() => EMPTY_BUNDLE);

      const remotePromise =
        activeRole === 'registry'
          ? Promise.resolve(EMPTY_BUNDLE)
          : getPartnerClient()
              .then((partner) => partner.search('Task', params))
              .catch(() => EMPTY_BUNDLE);

      const [local, remote] = await Promise.all([localPromise, remotePromise]);
      return { local, remote };
    },
  });
}
