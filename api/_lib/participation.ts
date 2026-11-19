import { sb } from './postgres.js';

type ParticipantRow = { email: string; participant_name: string | null; sequence_number: number };
type AttemptRow = {
  id: string; normalized_email: string; status: 'in_progress' | 'submitted' | 'auto_submitted';
  form_no?: number | null;
  started_at: string; submitted_at: string | null; deadline_at: string; submit_reason: string | null;
};

export type ParticipationSnapshot = {
  refreshedAt: string;
  participants: {
    sequenceNumber: number; name: string | null; email: string; attemptId: string | null;
    formNo: number | null;
    status: 'not_started' | 'in_progress' | 'overdue' | 'submitted' | 'auto_submitted';
    startedAt: string | null; submittedAt: string | null; submitReason: string | null;
  }[];
};

export function buildParticipationSnapshot(participants: ParticipantRow[], attempts: AttemptRow[], now: number): ParticipationSnapshot {
  const attemptsByEmail = new Map(attempts.map((attempt) => [attempt.normalized_email, attempt]));
  return {
    refreshedAt: new Date(now).toISOString(),
    participants: participants.map((participant) => {
      const attempt = attemptsByEmail.get(participant.email);
      const status = !attempt ? 'not_started'
        : attempt.status === 'in_progress'
          ? Date.parse(attempt.deadline_at) <= now ? 'overdue' : 'in_progress'
          : attempt.status;
      return {
        sequenceNumber: participant.sequence_number,
        name: participant.participant_name,
        email: participant.email,
        attemptId: attempt?.id ?? null,
        formNo: attempt?.form_no ?? null,
        status,
        startedAt: attempt?.started_at ?? null,
        submittedAt: attempt?.submitted_at ?? null,
        submitReason: attempt?.submit_reason ?? null,
      };
    }),
  };
}

export async function loadParticipationSnapshot(): Promise<ParticipationSnapshot> {
  const { data: participants, error: participantsError } = await sb.from('participant_email_allowlist')
    .select('email,participant_name,sequence_number').order('sequence_number');
  if (participantsError) throw participantsError;

  const emails = (participants as ParticipantRow[]).map((participant) => participant.email);
  const { data: attempts, error: attemptsError } = emails.length
    ? await sb.from('exam_attempts')
      .select('id,normalized_email,status,started_at,submitted_at,deadline_at,submit_reason,form_no')
      .in('normalized_email', emails)
    : { data: [], error: null };
  if (attemptsError) throw attemptsError;

  return buildParticipationSnapshot(participants as ParticipantRow[], attempts as AttemptRow[], Date.now());
}
