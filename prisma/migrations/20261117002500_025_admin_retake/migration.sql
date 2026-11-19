-- Ported from 025_admin_retake.sql; original transaction logic is unchanged.
-- Keep a complete audit snapshot before freeing an email for one new attempt.
create table exam_retake_archives (
  id uuid primary key default gen_random_uuid(),
  original_attempt_id uuid not null unique,
  normalized_email text not null,
  reason text not null,
  archived_at timestamptz not null default now(),
  attempt_snapshot jsonb not null,
  answers_snapshot jsonb not null,
  events_snapshot jsonb not null,
  questions_snapshot jsonb not null
);

create index exam_retake_archives_email_idx on exam_retake_archives (normalized_email, archived_at desc);

create function authorize_exam_retake(p_email text, p_expected_attempt uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(p_email));
  v_attempt exam_attempts;
begin
  if length(btrim(coalesce(p_reason, ''))) < 10 or length(p_reason) > 500 then
    raise exception 'retake_invalid_reason';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));
  select * into v_attempt from exam_attempts
  where normalized_email = v_email and id = p_expected_attempt for update;
  if not found then raise exception 'retake_not_found'; end if;
  if not exists (select 1 from participant_email_allowlist where email = v_email) then
    raise exception 'retake_not_allowed';
  end if;

  insert into exam_retake_archives (
    original_attempt_id, normalized_email, reason, attempt_snapshot,
    answers_snapshot, events_snapshot, questions_snapshot
  ) values (
    v_attempt.id, v_email, btrim(p_reason), to_jsonb(v_attempt) - 'token_hash',
    coalesce((select jsonb_agg(to_jsonb(a) order by a.question_id)
      from exam_answers a where a.attempt_id = v_attempt.id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(e) order by e.id)
      from exam_events e where e.attempt_id = v_attempt.id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(q) || jsonb_build_object('answer_key', to_jsonb(k)) order by selected.ordinality)
      from unnest(v_attempt.question_order) with ordinality as selected(id, ordinality)
      join exam_questions q on q.id = selected.id
      left join question_keys k on k.question_id = q.id), '[]'::jsonb)
  );
  delete from exam_attempts where id = v_attempt.id;
  return v_attempt.id;
end $$;
