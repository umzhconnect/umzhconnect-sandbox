import { useQuery } from '@tanstack/react-query';
import { useFhirClient, useProxyClient } from './useFhirClient';
import type { Bundle, FhirResource } from '../types/fhir';
import { useRole } from '../contexts/RoleContext';

export interface AllTasksResponse {
  local: Bundle;
  remote: Bundle;
}

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
 * Hook to fetch a resource from the partner's server (via proxy).
 */
export function useProxyRead<T extends FhirResource>(
  resourceType: string,
  id: string | undefined,
  enabled = true
) {
  const client = useProxyClient();
  const { activeRole } = useRole();

  return useQuery<T>({
    queryKey: ['proxy', activeRole, resourceType, id],
    queryFn: () => client.read<T>(resourceType, id!),
    enabled: enabled && !!id,
  });
}

/**
 * Hook to fetch a resource by absolute URL (cross-organization).
 */
export function useFhirAbsolute<T extends FhirResource>(
  absoluteUrl: string | undefined,
  enabled = true
) {
  const client = useFhirClient();

  return useQuery<T>({
    queryKey: ['fhir-absolute', absoluteUrl],
    queryFn: () => client.fetchAbsolute<T>(absoluteUrl!),
    enabled: enabled && !!absoluteUrl,
  });
}

/**
 * Hook to fetch all tasks from both the local partition and the partner's
 * external endpoint, returning them grouped as { local, remote }.
 */
export function useAllTasks(params?: Record<string, string>) {
  const client = useFhirClient();
  const { activeRole } = useRole();

  return useQuery<AllTasksResponse>({
    queryKey: ['all-tasks', activeRole, params],
    queryFn: () => client.fetchAction<AllTasksResponse>('/api/actions/all-tasks', params),
  });
}
