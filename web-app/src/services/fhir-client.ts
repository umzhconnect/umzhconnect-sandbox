// =============================================================================
// FHIR Client Service
// =============================================================================
// Handles all FHIR API interactions with logging support.
// Routes requests through the APISIX API gateway.
// =============================================================================

import type { Bundle, FhirResource, LogEntry } from '../types/fhir';

type LogCallback = (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;

export class FhirClient {
  private basePath: string;
  private token?: string;
  private onLog?: LogCallback;

  constructor(basePath: string, token?: string, onLog?: LogCallback) {
    this.basePath = basePath;
    this.token = token;
    this.onLog = onLog;
  }

  setToken(token: string | undefined) {
    this.token = token;
  }

  private log(entry: Omit<LogEntry, 'id' | 'timestamp'>) {
    if (entry.url?.startsWith('/')) {
      entry = { ...entry, url: `${window.location.origin}${entry.url}` };
    }
    this.onLog?.(entry);
  }

  private getHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    // Merge extra last so callers can override any default, including Authorization.
    return { ...headers, ...extra };
  }

  // ---------------------------------------------------------------------------
  // Read a single resource
  // ---------------------------------------------------------------------------
  async read<T extends FhirResource>(
    resourceType: string,
    id: string
  ): Promise<T> {
    const url = `${this.basePath}/${resourceType}/${id}`;
    const headers = this.getHeaders();

    this.log({
      type: 'request',
      method: 'GET',
      url,
      headers,
    });

    const start = Date.now();
    try {
      const response = await fetch(url, { headers });
      const body = await response.json();
      const duration = Date.now() - start;

      this.log({
        type: response.ok ? 'response' : 'error',
        method: 'GET',
        url,
        status: response.status,
        body,
        duration,
      });

      if (!response.ok) {
        throw new Error(`FHIR read failed: ${response.status} ${response.statusText}`);
      }

      return body as T;
    } catch (error) {
      this.log({
        type: 'error',
        method: 'GET',
        url,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Search resources
  // ---------------------------------------------------------------------------
  async search<T extends FhirResource>(
    resourceType: string,
    params?: Record<string, string>
  ): Promise<Bundle> {
    const searchParams = new URLSearchParams(params);
    const url = `${this.basePath}/${resourceType}?${searchParams.toString()}`;
    const headers = this.getHeaders();

    this.log({
      type: 'request',
      method: 'GET',
      url,
      headers,
    });

    const start = Date.now();
    try {
      const response = await fetch(url, { headers });
      const body = await response.json();
      const duration = Date.now() - start;

      this.log({
        type: response.ok ? 'response' : 'error',
        method: 'GET',
        url,
        status: response.status,
        body,
        duration,
      });

      if (!response.ok) {
        throw new Error(`FHIR search failed: ${response.status}`);
      }

      return body as Bundle;
    } catch (error) {
      this.log({
        type: 'error',
        method: 'GET',
        url,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Create a resource
  // ---------------------------------------------------------------------------
  async create<T extends FhirResource>(resource: T): Promise<T> {
    const url = `${this.basePath}/${resource.resourceType}`;
    const headers = this.getHeaders();

    this.log({
      type: 'request',
      method: 'POST',
      url,
      headers,
      body: resource,
    });

    const start = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(resource),
      });
      const body = await response.json();
      const duration = Date.now() - start;

      this.log({
        type: response.ok ? 'response' : 'error',
        method: 'POST',
        url,
        status: response.status,
        body,
        duration,
      });

      if (!response.ok) {
        throw new Error(`FHIR create failed: ${response.status}`);
      }

      return body as T;
    } catch (error) {
      this.log({
        type: 'error',
        method: 'POST',
        url,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Update a resource
  // ---------------------------------------------------------------------------
  async update<T extends FhirResource>(resource: T): Promise<T> {
    const url = `${this.basePath}/${resource.resourceType}/${resource.id}`;
    const headers = this.getHeaders();

    this.log({
      type: 'request',
      method: 'PUT',
      url,
      headers,
      body: resource,
    });

    const start = Date.now();
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(resource),
      });
      const body = await response.json();
      const duration = Date.now() - start;

      this.log({
        type: response.ok ? 'response' : 'error',
        method: 'PUT',
        url,
        status: response.status,
        body,
        duration,
      });

      if (!response.ok) {
        throw new Error(`FHIR update failed: ${response.status}`);
      }

      return body as T;
    } catch (error) {
      this.log({
        type: 'error',
        method: 'PUT',
        url,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Patch a resource (RFC 6902 JSON Patch)
  // ---------------------------------------------------------------------------
  async patch<T extends FhirResource>(
    resourceType: string,
    id: string,
    ops: Array<{ op: string; path: string; value?: unknown }>
  ): Promise<T> {
    const url = `${this.basePath}/${resourceType}/${id}`;
    const headers = this.getHeaders({ 'Content-Type': 'application/json-patch+json' });

    this.log({ type: 'request', method: 'PATCH', url, headers, body: ops });

    const start = Date.now();
    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(ops),
      });
      const body = await response.json();
      const duration = Date.now() - start;

      this.log({
        type: response.ok ? 'response' : 'error',
        method: 'PATCH',
        url,
        status: response.status,
        body,
        duration,
      });

      if (!response.ok) {
        throw new Error(`FHIR patch failed: ${response.status}`);
      }

      return body as T;
    } catch (error) {
      this.log({
        type: 'error',
        method: 'PATCH',
        url,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

}
