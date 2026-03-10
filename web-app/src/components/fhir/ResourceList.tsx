import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFhirSearch } from '../../hooks/useFhirSearch';
import { useRole } from '../../contexts/RoleContext';
import { RESOURCE_TYPES } from '../../types/fhir';
import type { FhirResource, Bundle } from '../../types/fhir';
import StatusBadge from '../common/StatusBadge';
import JsonViewer from '../common/JsonViewer';
import LoadingSpinner from '../common/LoadingSpinner';
import ResourceEditForm, { SUPPORTED_EDIT_TYPES } from './ResourceEditForm';
import CreateResourceModal from './CreateResourceModal';

interface ResourceListProps {
  onSelectResource?: (resource: FhirResource) => void;
}

const ResourceList: React.FC<ResourceListProps> = ({ onSelectResource }) => {
  const { activeRole } = useRole();
  const queryClient = useQueryClient();

  const [selectedType, setSelectedType] = useState<string>('Patient');
  const [patientFilter, setPatientFilter] = useState('');
  const [selectedResource, setSelectedResource] = useState<FhirResource | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const searchParams: Record<string, string> = {};
  if (
    patientFilter &&
    selectedType !== 'Patient' &&
    selectedType !== 'Organization' &&
    selectedType !== 'Practitioner' &&
    selectedType !== 'PractitionerRole'
  ) {
    searchParams['patient'] = patientFilter;
  }

  const { data: bundle, isLoading, error } = useFhirSearch(selectedType, searchParams);

  const resources =
    (bundle?.entry?.map((e) => e.resource).filter(Boolean) as FhirResource[]) || [];

  const handleSelect = (resource: FhirResource) => {
    setSelectedResource(resource);
    onSelectResource?.(resource);
  };

  const handleSaved = () => {
    // Refresh the right-panel view with the latest version from the server
    queryClient.invalidateQueries({ queryKey: ['fhir', activeRole, selectedType] });
  };

  const handleCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['fhir', activeRole, selectedType] });
  };

  const handleTypeChange = (type: string) => {
    setSelectedType(type);
    setSelectedResource(null);
  };

  const canCreate = SUPPORTED_EDIT_TYPES.includes(selectedType);

  const getResourceSummary = (resource: FhirResource): string => {
    const r = resource as unknown as Record<string, unknown>;
    if (r.name && Array.isArray(r.name) && r.name[0]) {
      const name = r.name[0] as Record<string, unknown>;
      return `${(name.given as string[])?.join(' ') || ''} ${name.family || ''}`.trim();
    }
    if (typeof r.name === 'string') return r.name;
    if (r.description && typeof r.description === 'string') return r.description;
    if (r.code) {
      const code = r.code as Record<string, unknown>;
      if (code.text) return code.text as string;
      if (code.coding && Array.isArray(code.coding) && code.coding[0]) {
        return (code.coding[0] as Record<string, unknown>).display as string || '';
      }
    }
    if (r.title && typeof r.title === 'string') return r.title;
    return resource.id || 'Unknown';
  };

  const getResourceStatus = (resource: FhirResource): string | undefined => {
    const r = resource as unknown as Record<string, unknown>;
    if (typeof r.status === 'string') return r.status;
    if (r.clinicalStatus && typeof r.clinicalStatus === 'object') {
      const cs = r.clinicalStatus as Record<string, unknown>;
      if (cs.coding && Array.isArray(cs.coding) && cs.coding[0]) {
        return (cs.coding[0] as Record<string, unknown>).code as string;
      }
    }
    return undefined;
  };

  return (
    <>
      <div className="flex gap-4 h-full">
        {/* Left: List */}
        <div className="w-1/2 flex flex-col">
          {/* Filters + Create button */}
          <div className="flex gap-2 mb-4">
            <select
              value={selectedType}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {RESOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Filter by Patient ID..."
              value={patientFilter}
              onChange={(e) => setPatientFilter(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={() => setCreateModalOpen(true)}
              disabled={!canCreate}
              title={
                canCreate
                  ? `Create new ${selectedType}`
                  : `Creating ${selectedType} is not supported`
              }
              className="btn-primary text-sm px-3 py-2 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Create New
            </button>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-auto border border-gray-200 rounded-lg">
            {isLoading && <LoadingSpinner message="Searching..." />}
            {error && (
              <div className="p-4 text-red-600 text-sm">
                Error: {error instanceof Error ? error.message : 'Failed to load resources'}
              </div>
            )}
            {!isLoading && resources.length === 0 && (
              <div className="p-8 text-center text-gray-500 text-sm">
                No {selectedType} resources found.
              </div>
            )}
            {resources.map((resource) => (
              <button
                key={`${resource.resourceType}/${resource.id}`}
                onClick={() => handleSelect(resource)}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  selectedResource?.id === resource.id
                    ? 'bg-blue-50 border-l-4 border-l-blue-500'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-mono text-gray-400">
                      {resource.resourceType}/{resource.id}
                    </span>
                    <p className="text-sm font-medium text-gray-900 mt-0.5">
                      {getResourceSummary(resource)}
                    </p>
                  </div>
                  {getResourceStatus(resource) && (
                    <StatusBadge status={getResourceStatus(resource)!} />
                  )}
                </div>
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs text-gray-500">
            {bundle?.total !== undefined
              ? `${bundle.total} total`
              : `${resources.length} results`}
          </div>
        </div>

        {/* Right: Detail */}
        <div className="w-1/2 flex flex-col overflow-y-auto">
          {selectedResource ? (
            <div className="space-y-4">
              <div className="card">
                <ResourceEditForm
                  resource={selectedResource}
                  onSaved={handleSaved}
                />
              </div>
              <JsonViewer data={selectedResource} title="JSON View" maxHeight="300px" />
            </div>
          ) : (
            <div className="card flex items-center justify-center h-64 text-gray-400 text-sm">
              Select a resource to view and edit its details
            </div>
          )}
        </div>
      </div>

      {/* Create New modal */}
      <CreateResourceModal
        open={createModalOpen}
        resourceType={selectedType}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={handleCreated}
      />
    </>
  );
};

export default ResourceList;
