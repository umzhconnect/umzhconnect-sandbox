// =============================================================================
// FHIR Client Service
// =============================================================================
// Handles all FHIR API interactions with logging support.
// Routes requests through the KrakenD API gateway.
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
    // Merge extra last so callers can override any default, including Authorization
    // (used by fetchAbsoluteWithConsent to inject a scoped service-account token)
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
  // POST to a non-standard action endpoint (e.g. /api/actions/create-task)
  // Path is resolved relative to the gateway origin (not the FHIR base path).
  // ---------------------------------------------------------------------------
  async postAction<T>(path: string, body: unknown): Promise<T> {
    const origin = new URL(this.basePath).origin;
    const url = `${origin}${path}`;
    const headers = this.getHeaders();

    this.log({ type: 'request', method: 'POST', url, headers, body });

    const start = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const responseBody = await response.json();
      const duration = Date.now() - start;

      this.log({
        type: response.ok ? 'response' : 'error',
        method: 'POST',
        url,
        status: response.status,
        body: responseBody,
        duration,
      });

      if (!response.ok) {
        throw new Error(`Action post failed: ${response.status}`);
      }

      return responseBody as T;
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
  // Fetch a non-standard action endpoint (e.g. /api/actions/all-tasks)
  // Path is resolved relative to the gateway origin (not the FHIR base path).
  // ---------------------------------------------------------------------------
  async fetchAction<T>(path: string, params?: Record<string, string>): Promise<T> {
    const origin = new URL(this.basePath).origin;
    const searchParams = params && Object.keys(params).length > 0
      ? `?${new URLSearchParams(params)}`
      : '';
    const url = `${origin}${path}${searchParams}`;
    const headers = this.getHeaders();

    this.log({ type: 'request', method: 'GET', url, headers });

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
        throw new Error(`Action fetch failed: ${response.status}`);
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
  // Fetch resource by absolute URL (for cross-organization references)
  // ---------------------------------------------------------------------------
  async fetchAbsolute<T extends FhirResource>(absoluteUrl: string, extra?: Record<string, string>): Promise<T> {
    // If the reference points to a different KrakenD origin, route it through
    // this client's own /proxy/fhir endpoint.
    const ownOrigin = new URL(this.basePath).origin;
    const targetOrigin = new URL(absoluteUrl).origin;

    let url = absoluteUrl;
    if (targetOrigin !== ownOrigin) {
      // Strip everything up to and including the first /fhir/ segment,
      // then prefix with this gateway's proxy endpoint.
      const resourcePath = absoluteUrl.replace(/^.*?\/fhir\//, '');
      url = `${ownOrigin}/proxy/fhir/${resourcePath}`;
    }

    const headers = this.getHeaders(extra);

    this.log({
      type: 'request',
      method: 'GET',
      url,
      headers,
      message: `Cross-org fetch: ${absoluteUrl} → ${url}`,
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
        throw new Error(`Cross-org fetch failed: ${response.status}`);
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

}
