import React, { useState } from 'react';
import { useFhirSearch } from '../../hooks/useFhirSearch';
import { RESOURCE_TYPES } from '../../types/fhir';
import type { FhirResource } from '../../types/fhir';
import LoadingSpinner from '../common/LoadingSpinner';
import StatusBadge from '../common/StatusBadge';

// =============================================================================
// Resource label helper (reusable across the app)
// =============================================================================

export const getResourceLabel = (resource: FhirResource): string => {
  const r = resource as unknown as Record<string, unknown>;
  if (r.name && Array.isArray(r.name) && r.name[0]) {
    const n = r.name[0] as Record<string, unknown>;
    return `${(n.given as string[])?.join(' ') ?? ''} ${n.family ?? ''}`.trim();
  }
  if (typeof r.name === 'string') return r.name;
  if (r.description && typeof r.description === 'string') return r.description;
  if (r.code) {
    const c = r.code as Record<string, unknown>;
    if (c.text) return c.text as string;
    if (c.coding && Array.isArray(c.coding) && c.coding[0]) {
      return ((c.coding[0] as Record<string, unknown>).display as string) || '';
    }
  }
  if (r.title && typeof r.title === 'string') return r.title;
  return resource.id ?? 'Unknown';
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

// =============================================================================
// ResourcePickerModal
// =============================================================================

interface ResourcePickerModalProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  /** Called with the selected resource. The modal does NOT close itself — the
   *  caller is responsible for closing it (e.g. inside the onSelect handler). */
  onSelect: (resource: FhirResource) => void;
}

const ResourcePickerModal: React.FC<ResourcePickerModalProps> = ({
  open,
  title = 'Select Resource',
  onClose,
  onSelect,
}) => {
  const [selectedType, setSelectedType] = useState<string>('DiagnosticReport');

  const { data: bundle, isLoading } = useFhirSearch(selectedType, {}, open);
  const resources =
    (bundle?.entry?.map((e) => e.resource).filter(Boolean) as FhirResource[]) ?? [];

  if (!open) return null;

  return (
    /* z-[60] so it sits above the parent edit-form modal (z-50) */
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Type selector */}
        <div className="px-6 pt-4 pb-3 border-b border-gray-100">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Resource type
          </label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {RESOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        {/* Resource list */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <LoadingSpinner message="Loading…" />
          ) : resources.length === 0 ? (
            <p className="text-sm text-gray-400 italic text-center py-8">
              No {selectedType} resources found.
            </p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              {resources.map((resource) => (
                <button
                  key={`${resource.resourceType}/${resource.id}`}
                  onClick={() => onSelect(resource)}
                  className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-blue-50 active:bg-blue-100 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-xs font-mono text-gray-400">
                        {resource.resourceType}/{resource.id}
                      </span>
                      <p className="text-sm font-medium text-gray-900 mt-0.5 truncate">
                        {getResourceLabel(resource)}
                      </p>
                    </div>
                    {getResourceStatus(resource) && (
                      <StatusBadge status={getResourceStatus(resource)!} />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResourcePickerModal;
