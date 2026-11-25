// SPDX-License-Identifier: MIT
// OpenCue run analytics v1. Keep this file identical in consumer repositories.
'use strict';

const { randomUUID } = require('node:crypto');

/** @param {Record<string, string | undefined>} [env] */
function config(env = process.env) {
  if (env.DO_NOT_TRACK === '1' || env.OPENCUE_RUN_ANALYTICS !== '1') return null;
  const key = env.OPENCUE_RUN_ANALYTICS_PROJECT_KEY;
  if (!key || !/^phc_[A-Za-z0-9_-]{5,150}$/.test(key)) return null;
  try {
    const url = new URL(env.OPENCUE_RUN_ANALYTICS_HOST);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/') return null;
    if (url.search || url.hash) return null;
    return { key, url: new URL('/i/v0/e/', url).href };
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} Run
 * @property {string} product
 * @property {number} durationMs
 * @property {boolean} ok
 * @property {string} [provider]
 * @property {number} [inputTokens]
 * @property {number} [outputTokens]
 */

/** @param {Run} run @param {string} key */
function envelope(run, key) {
  if (run.product !== 'gitguardex' && run.product !== 'cue') return null;
  if (typeof run.ok !== 'boolean' || !Number.isSafeInteger(run.durationMs) || run.durationMs < 0) {
    return null;
  }
  const properties = {
    schema_version: 1,
    product: run.product,
    operation: run.product === 'gitguardex' ? 'finish' : 'launch',
    outcome: run.ok ? 'success' : 'failure',
    duration_ms: run.durationMs,
    $process_person_profile: false,
    $geoip_disable: true,
  };
  if (run.provider === 'codex' || run.provider === 'claude') properties.provider = run.provider;
  if (Number.isSafeInteger(run.inputTokens) && run.inputTokens >= 0) {
    properties.input_tokens = run.inputTokens;
  }
  if (Number.isSafeInteger(run.outputTokens) && run.outputTokens >= 0) {
    properties.output_tokens = run.outputTokens;
  }
  return {
    api_key: key,
    event: 'opencue_run_completed',
    distinct_id: randomUUID(),
    properties,
  };
}

/**
 * Best-effort, no retries. Call only for a new run, never for local history.
 * @param {Run} run
 * @param {Record<string, string | undefined>} [env]
 * @param {typeof fetch} [request]
 */
async function sendRun(run, env = process.env, request = globalThis.fetch) {
  const settings = config(env);
  if (!settings) return false;
  try {
    const event = envelope(run, settings.key);
    if (!event) return false;
    const result = await request(settings.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      redirect: 'error',
      signal: AbortSignal.timeout(650),
    });
    if (result.body) await result.body.cancel();
    return result.ok;
  } catch {
    return false;
  }
}

module.exports = { config, sendRun };
