#!/usr/bin/env node
// =============================================================================
// UMZH Connect Sandbox – Reseed API
// =============================================================================
// POST /reseed  → expunge all FHIR partitions, then reload seed bundles.
// Intended as an internal sandbox utility; CORS is wide-open.
// =============================================================================

'use strict';

const http = require('http');
const fs   = require('fs');

const FHIR_BASE    = process.env.FHIR_BASE_URL        || 'http://hapi-fhir:8080/fhir';
const PLACER_URL   = process.env.PLACER_EXTERNAL_URL   || 'http://localhost:8081';
const FULFILLER_URL= process.env.FULFILLER_EXTERNAL_URL|| 'http://localhost:8083';
const PORT         = 9001;

// ---------------------------------------------------------------------------
// Helper: POST JSON to HAPI FHIR (returns { status, body })
// ---------------------------------------------------------------------------
async function fhirPost(path, body) {
  const res = await fetch(`${FHIR_BASE}${path}`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/fhir+json' },
    body   : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

// ---------------------------------------------------------------------------
// Helper: expunge a single partition
// ---------------------------------------------------------------------------
async function expungePartition(partition, log) {
  const result = await fhirPost(`/${partition}/$expunge`, {
    resourceType: 'Parameters',
    parameter   : [{ name: 'expungeEverything', valueBoolean: true }],
  });
  log(`  Expunge /${partition}: HTTP ${result.status}`);
}

// ---------------------------------------------------------------------------
// Helper: create a HAPI partition (ignores 409 / already-exists)
// ---------------------------------------------------------------------------
async function createPartition(id, name, desc, log) {
  const result = await fhirPost('/DEFAULT/$partition-management-create-partition', {
    resourceType: 'Parameters',
    parameter   : [
      { name: 'id',          valueInteger: id   },
      { name: 'name',        valueCode   : name },
      { name: 'description', valueString : desc },
    ],
  });
  const ok = result.status === 200 || result.status === 201;
  const skip = result.status === 409 ||
               (result.status === 400 && result.body.includes('already defined'));
  log(`  Partition '${name}': HTTP ${result.status}${skip ? ' (already exists — ok)' : ''}`);
  if (!ok && !skip) {
    throw new Error(`Failed to create partition '${name}': HTTP ${result.status}`);
  }
}

// ---------------------------------------------------------------------------
// Main reseed routine
// ---------------------------------------------------------------------------
async function reseed() {
  const lines = [];
  const log   = (msg) => { lines.push(msg); console.log(msg); };

  log('=== RESEED STARTED ===');

  // [1/5] Expunge all three partitions
  log('\n[1/5] Expunging FHIR partitions…');
  await expungePartition('DEFAULT',   log);
  await expungePartition('placer',    log);
  await expungePartition('fulfiller', log);

  // [2/5] Re-create named partitions (may already exist in the DB schema)
  log('\n[2/5] Ensuring FHIR partitions exist…');
  await createPartition(1, 'placer',    'HospitalP (Placer) partition',    log);
  await createPartition(2, 'fulfiller', 'HospitalF (Fulfiller) partition', log);

  // [3/5] Load shared bundle → /fhir/DEFAULT
  log('\n[3/5] Loading shared bundle → /fhir/DEFAULT…');
  const sharedBundle = JSON.parse(fs.readFileSync('/seed/bundles/shared-bundle.json', 'utf8'));
  const sharedResult = await fhirPost('/DEFAULT', sharedBundle);
  log(`  Shared bundle: HTTP ${sharedResult.status}`);
  if (sharedResult.status !== 200 && sharedResult.status !== 201) {
    throw new Error(`Shared bundle failed: HTTP ${sharedResult.status}`);
  }

  // [4/5] Load placer bundle (URL substitution) → /fhir/placer
  log('\n[4/5] Loading placer bundle → /fhir/placer…');
  let placerStr = fs.readFileSync('/seed/bundles/placer-bundle.json', 'utf8');
  placerStr = placerStr
    .replace(/__PLACER_EXTERNAL_URL__/g,    PLACER_URL)
    .replace(/__FULFILLER_EXTERNAL_URL__/g, FULFILLER_URL);
  const placerResult = await fhirPost('/placer', JSON.parse(placerStr));
  log(`  Placer bundle: HTTP ${placerResult.status}`);
  if (placerResult.status !== 200 && placerResult.status !== 201) {
    throw new Error(`Placer bundle failed: HTTP ${placerResult.status}`);
  }

  // [5/5] Load fulfiller bundle (URL substitution) → /fhir/fulfiller
  log('\n[5/5] Loading fulfiller bundle → /fhir/fulfiller…');
  let fulfillerStr = fs.readFileSync('/seed/bundles/fulfiller-bundle.json', 'utf8');
  fulfillerStr = fulfillerStr
    .replace(/__PLACER_EXTERNAL_URL__/g,    PLACER_URL)
    .replace(/__FULFILLER_EXTERNAL_URL__/g, FULFILLER_URL);
  const fulfillerResult = await fhirPost('/fulfiller', JSON.parse(fulfillerStr));
  log(`  Fulfiller bundle: HTTP ${fulfillerResult.status}`);
  if (fulfillerResult.status !== 200 && fulfillerResult.status !== 201) {
    throw new Error(`Fulfiller bundle failed: HTTP ${fulfillerResult.status}`);
  }

  log('\n=== RESEED COMPLETE ===');
  return lines;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // CORS — wide open for sandbox use
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/reseed') {
    console.log('POST /reseed — starting…');
    try {
      const log = await reseed();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, log }));
    } catch (err) {
      console.error('Reseed failed:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Reseed API listening on :${PORT}`);
  console.log(`FHIR_BASE_URL:          ${FHIR_BASE}`);
  console.log(`PLACER_EXTERNAL_URL:    ${PLACER_URL}`);
  console.log(`FULFILLER_EXTERNAL_URL: ${FULFILLER_URL}`);
});
