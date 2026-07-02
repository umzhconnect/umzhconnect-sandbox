// =============================================================================
// HTTP helpers — safe response-body reading for the protocol log
// =============================================================================
// Gateways and reverse proxies (APISIX, nginx) return HTML error pages for
// failures like 403/404/502/504. Calling `response.json()` on those throws a
// SyntaxError ("Unexpected token '<'…"), which surfaces in the protocol log as
// a cryptic parse error instead of the real problem — and dumping the raw HTML
// into the log is worse. This reads the body once and returns something safe to
// display: parsed JSON when the payload is JSON (e.g. a FHIR OperationOutcome),
// otherwise a concise one-line summary of the error page.
// =============================================================================

// Collapse an HTML/plain-text error page into a short, log-friendly message.
// Prefers the <title>, falls back to the first stretch of visible text.
function summariseNonJson(text: string, status: number, statusText: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.trim();
  const stripped = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const snippet = (title || stripped).slice(0, 200);
  const statusPart = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
  return snippet ? `${statusPart} — ${snippet}` : statusPart;
}

/**
 * Read a fetch Response body for display in the protocol log.
 *
 * Returns the parsed object when the body is JSON. For a non-JSON error page it
 * returns `{ error: "<concise summary>" }` rather than the raw markup, so the
 * log never tries to render an HTML error payload. Never throws.
 */
export async function readBodyForLog(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (!text) return undefined;

  // Try JSON regardless of Content-Type — some gateways mislabel JSON bodies.
  try {
    return JSON.parse(text);
  } catch {
    return { error: summariseNonJson(text, response.status, response.statusText) };
  }
}
