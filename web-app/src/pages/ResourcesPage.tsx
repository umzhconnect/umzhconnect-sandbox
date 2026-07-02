import React from 'react';
import { useRole } from '../contexts/RoleContext';
import { useFhirSearch, useRegistrySearch } from '../hooks/useFhirSearch';
import ResourceList from '../components/fhir/ResourceList';

const ResourcesPage: React.FC = () => {
  const { activeRole, partyLabel } = useRole();
  const isRegistry = activeRole === 'registry';

  const { data: patients }        = useFhirSearch('Patient',        {}, !isRegistry);
  const { data: serviceRequests } = useFhirSearch('ServiceRequest', {}, !isRegistry);
  const { data: tasks }           = useFhirSearch('Task',           {}, !isRegistry);
  const { data: conditions }      = useFhirSearch('Condition',      {}, !isRegistry);

  const { data: organizations }      = useRegistrySearch('Organization',      {}, isRegistry);
  const { data: fhirEndpoints }      = useRegistrySearch('Endpoint',          {}, isRegistry);
  const { data: healthcareServices } = useRegistrySearch('HealthcareService', {}, isRegistry);

  const stats = isRegistry
    ? [
        { label: 'Organizations',      count: organizations?.total     ?? organizations?.entry?.length     ?? 0, path: '/resources', color: 'bg-purple-50 text-purple-700' },
        { label: 'Endpoints',          count: fhirEndpoints?.total     ?? fhirEndpoints?.entry?.length     ?? 0, path: '/resources', color: 'bg-indigo-50 text-indigo-700' },
        { label: 'Healthcare Services',count: healthcareServices?.total ?? healthcareServices?.entry?.length ?? 0, path: '/resources', color: 'bg-teal-50 text-teal-700' },
      ]
    : [
        { label: 'Patients',          count: patients?.total        ?? patients?.entry?.length        ?? 0, path: '/resources', color: 'bg-blue-50 text-blue-700' },
        { label: 'Service Requests',  count: serviceRequests?.total ?? serviceRequests?.entry?.length ?? 0, path: '/resources', color: 'bg-purple-50 text-purple-700' },
        { label: 'Tasks',             count: tasks?.total           ?? tasks?.entry?.length           ?? 0, path: '/tasks',     color: 'bg-yellow-50 text-yellow-700' },
        { label: 'Conditions',        count: conditions?.total      ?? conditions?.entry?.length      ?? 0, path: '/resources', color: 'bg-green-50 text-green-700' },
      ];

  return (
    <div className="space-y-6">
      <div className="flex gap-6 items-start">
        {/* Left: page title */}
        <div className="w-1/2">
          <h2 className="text-2xl font-bold text-gray-900">FHIR Resources</h2>
          <p className="text-gray-500 mt-1">
            {isRegistry
              ? <>Shared mCSD directory — <strong>Organization</strong> and <strong>Endpoint</strong> resources (public, no auth)</>
              : <>Browse and manage FHIR resources for <strong>{partyLabel}</strong></>
            }
          </p>
        </div>

        {/* Right: resource summary list */}
        <div className="w-1/2 border border-gray-200 rounded-lg bg-white overflow-hidden">
          <div className="grid grid-cols-2 border-b border-gray-200 bg-gray-50 px-4 py-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Resource type</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide text-right"># Resources</span>
          </div>
          {stats.filter((s) => s.count > 0).map((s, i, arr) => (
            <div
              key={s.label}
              className={`grid grid-cols-2 px-4 py-2.5 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}
            >
              <span className="text-sm text-gray-700">{s.label}</span>
              <span className="text-sm font-semibold text-gray-900 text-right">{s.count}</span>
            </div>
          ))}
          {stats.every((s) => s.count === 0) && (
            <div className="px-4 py-4 text-sm text-gray-400 italic text-center">No resources found</div>
          )}
        </div>
      </div>

      <ResourceList defaultType={isRegistry ? 'Organization' : 'Patient'} />
    </div>
  );
};

export default ResourcesPage;
