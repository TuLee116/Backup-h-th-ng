// Run against an isolated staging deployment only.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const vus = Number(__ENV.VUS || 171);
const syncLeadSeconds = Number(__ENV.SYNC_LEAD_SECONDS || 10);
const submitAfterSeconds = Number(__ENV.SUBMIT_AFTER_SECONDS || 30);
const emails = __ENV.EMAIL_FILE
  ? open(__ENV.EMAIL_FILE).split(/\r?\n/).map((email) => email.trim()).filter(Boolean)
  : [];

if (!Number.isInteger(vus) || vus < 1 || vus > 199)
  throw new Error('VUS must be an integer between 1 and 199');
if (!Number.isFinite(syncLeadSeconds) || syncLeadSeconds < 0)
  throw new Error('SYNC_LEAD_SECONDS must be zero or greater');
if (!Number.isFinite(submitAfterSeconds) || submitAfterSeconds <= 0)
  throw new Error('SUBMIT_AFTER_SECONDS must be greater than zero');
if (!__ENV.BASE || !__ENV.ORIGIN || !__ENV.PROJECT)
  throw new Error('Set BASE, ORIGIN, and PROJECT to the staging deployment');
if (!__ENV.EMAIL_FILE || emails.length < vus)
  throw new Error(`EMAIL_FILE must contain at least ${vus} unused, allowlisted emails`);
if (new Set(emails).size !== emails.length)
  throw new Error('EMAIL_FILE contains duplicate email addresses');
if (emails.some((email) => !/^[^\s@]+@tanminhnhan\.com\.vn$/i.test(email)))
  throw new Error('EMAIL_FILE contains an invalid company email');

const startRequestOffset = new Trend('start_request_offset_ms');
const submitRequestOffset = new Trend('submit_request_offset_ms');
const startDuration = new Trend('start_duration_ms');
const stateDuration = new Trend('state_duration_ms');
const submitDuration = new Trend('submit_duration_ms');
const headers = { headers: { 'Content-Type': 'application/json', Origin: __ENV.ORIGIN } };

export const options = {
  scenarios: {
    core_flows: {
      executor: 'per-vu-iterations',
      vus,
      iterations: 1,
      maxDuration: '5m',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    start_duration_ms: ['p(95)<800', 'p(99)<2000'],
    state_duration_ms: ['p(95)<800', 'p(99)<2000'],
    submit_duration_ms: ['p(95)<800', 'p(99)<2000'],
  },
};

const sleepUntil = (timestamp) => {
  const remainingMs = timestamp - Date.now();
  if (remainingMs > 0) sleep(remainingMs / 1000);
};

export function setup() {
  const startAt = Date.now() + syncLeadSeconds * 1000;
  return { startAt, submitAt: startAt + submitAfterSeconds * 1000 };
}

export default function (schedule) {
  sleepUntil(schedule.startAt);
  startRequestOffset.add(Date.now() - schedule.startAt);

  const candidate = {
    fullName: `Core flow load ${__VU}`,
    email: emails[__VU - 1],
    position: 'Load test',
    level: 'Staging',
    mainProject: __ENV.PROJECT,
  };
  const started = http.post(`${__ENV.BASE}/api/exam/start`, JSON.stringify(candidate), headers);
  startDuration.add(started.timings.duration);
  if (!check(started, { started: (response) => response.status === 201 })) return;

  const state = http.get(`${__ENV.BASE}/api/exam/state`);
  stateDuration.add(state.timings.duration);
  if (!check(state, {
    'state loaded': (response) => response.status === 200
      && response.json('status') === 'in_progress',
  })) return;

  sleepUntil(schedule.submitAt);
  submitRequestOffset.add(Date.now() - schedule.submitAt);
  const submitted = http.post(
    `${__ENV.BASE}/api/exam/submit`,
    JSON.stringify({ reason: 'manual' }),
    headers,
  );
  submitDuration.add(submitted.timings.duration);
  check(submitted, { submitted: (response) => response.status === 200 });
}
