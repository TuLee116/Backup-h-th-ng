import { describe, expect, it } from 'vitest';
import { buildParticipationSnapshot } from './participation';

const participants = [
  { email: 'a@tanminhnhan.com.vn', participant_name: 'A', sequence_number: 1 },
  { email: 'b@tanminhnhan.com.vn', participant_name: null, sequence_number: 2 },
];
const startedAt = '2026-11-17T08:00:00.000Z';
const deadlineAt = '2026-11-17T09:00:00.000Z';

describe('buildParticipationSnapshot', () => {
  it('keeps allowlist order and marks an unfinished attempt overdue when its deadline passes', () => {
    const attempts = [{
      id: 'attempt-a', normalized_email: participants[0].email, status: 'in_progress' as const,
      form_no: 1,
      started_at: startedAt, submitted_at: null, deadline_at: deadlineAt, submit_reason: null,
    }];
    const before = buildParticipationSnapshot(participants, attempts, Date.parse(deadlineAt) - 1);
    const after = buildParticipationSnapshot(participants, attempts, Date.parse(deadlineAt));

    expect(before.participants.map((item) => item.status)).toEqual(['in_progress', 'not_started']);
    expect(after.participants.map((item) => item.status)).toEqual(['overdue', 'not_started']);
    expect(after.participants[0].attemptId).toBe('attempt-a');
    expect(after.participants[0].formNo).toBe(1);
    expect(after.participants[1].attemptId).toBeNull();
  });

  it('preserves the automatic submission reason for the admin display', () => {
    const attempts = [{
      id: 'attempt-a', normalized_email: participants[0].email, status: 'auto_submitted' as const,
      started_at: startedAt, submitted_at: deadlineAt, deadline_at: deadlineAt, submit_reason: 'deadline',
    }];
    const snapshot = buildParticipationSnapshot(participants, attempts, Date.parse(deadlineAt) + 1000);

    expect(snapshot.participants[0]).toMatchObject({ status: 'auto_submitted', submitReason: 'deadline' });
  });
});
