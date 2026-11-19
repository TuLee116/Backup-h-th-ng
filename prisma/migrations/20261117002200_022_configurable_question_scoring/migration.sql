-- Ported from 022_configurable_question_scoring.sql; original transaction logic is unchanged.
alter table exam_settings
  add column mc_points_per_question numeric(10, 2) not null default 0.5
    check (mc_points_per_question > 0),
  add column essay_points_per_question numeric(10, 2) not null default 0.5
    check (essay_points_per_question > 0),
  add column passing_score numeric(10, 2) not null default 7
    check (passing_score >= 0);

update exam_settings
set question_count = 19,
    mc_question_count = 18,
    essay_question_count = 1,
    passing_score = 7,
    updated_at = now()
where id = 1;

alter table exam_attempts
  add column mc_points_per_question numeric(10, 2),
  add column essay_points_per_question numeric(10, 2),
  add column passing_score numeric(10, 2);

update exam_attempts a
set mc_points_per_question = 0.5,
    essay_points_per_question = 0.5,
    passing_score = round(
      cardinality(a.question_order)::numeric * 0.5 * s.passing_percentage / 100,
      2
    )
from exam_settings s
where s.id = 1;

alter table exam_attempts
  alter column mc_points_per_question set not null,
  alter column essay_points_per_question set not null,
  alter column passing_score set not null,
  add constraint exam_attempts_mc_points_check check (mc_points_per_question > 0),
  add constraint exam_attempts_essay_points_check check (essay_points_per_question > 0),
  add constraint exam_attempts_passing_score_check check (passing_score >= 0);

create or replace function snapshot_attempt_scoring()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s exam_settings;
begin
  select * into s from exam_settings where id = 1;
  new.mc_points_per_question := s.mc_points_per_question;
  new.essay_points_per_question := s.essay_points_per_question;
  new.passing_score := s.passing_score;
  return new;
end $$;

create trigger exam_attempts_snapshot_scoring
before insert on exam_attempts
for each row execute function snapshot_attempt_scoring();

create or replace function start_attempt(
  p_name text,
  p_email text,
  p_position text,
  p_level text,
  p_main_project text,
  p_token_hash text
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  s exam_settings;
  v_order uuid[];
  v_id uuid := gen_random_uuid();
  v_deadline timestamptz;
  v_project exam_projects;
  v_email text := lower(btrim(p_email));
  v_participant_order integer;
  v_participant_name text;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));
  if exists (select 1 from exam_attempts where normalized_email = v_email) then
    raise exception 'email_used';
  end if;
  select sequence_number, participant_name
  into v_participant_order, v_participant_name
  from participant_email_allowlist
  where email = v_email;
  if not found then raise exception 'email_not_allowed'; end if;

  select * into v_project
  from exam_projects
  where lower(btrim(name)) = lower(btrim(p_main_project)) and active
  for share;
  if not found then raise exception 'invalid_project'; end if;

  select * into s from exam_settings where id = 1;
  if not s.active then raise exception 'closed'; end if;
  if now() < s.opening_at then raise exception 'not_open'; end if;
  if now() >= s.closing_at then raise exception 'closed'; end if;
  if s.mc_question_count + s.essay_question_count not between 1 and 1000 then
    raise exception 'invalid_question_count';
  end if;

  with selected_multiple_choice as (
    select id, random() as r
    from exam_questions
    where active and question_type in ('single', 'multiple')
    order by r
    limit s.mc_question_count
  ), selected_essay as (
    select id, random() as r
    from exam_questions
    where active and question_type = 'essay'
    order by r
    limit s.essay_question_count
  ), selected_questions as (
    select id, r, false as is_essay from selected_multiple_choice
    union all
    select id, r, true as is_essay from selected_essay
  )
  select array_agg(id order by is_essay, r) into v_order
  from selected_questions;
  if coalesce(cardinality(v_order), 0) <> s.mc_question_count + s.essay_question_count then
    raise exception 'not_ready';
  end if;

  v_deadline := least(now() + make_interval(mins => s.duration_minutes), s.closing_at);
  insert into exam_attempts(
    id, full_name, normalized_email, position, candidate_level, main_project, project_id,
    token_hash, deadline_at, question_order, participant_order, participant_list_name
  ) values (
    v_id, p_name, v_email, p_position, p_level, v_project.name, v_project.id,
    p_token_hash, v_deadline, v_order, v_participant_order, v_participant_name
  );
  return v_deadline;
end $$;

create or replace function refresh_attempt_score(p_attempt uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts;
  v_mc_count integer;
  v_essay_count integer;
  v_ungraded integer;
  v_correct integer;
  v_incorrect integer;
  v_scored numeric(10, 2);
  v_total numeric(10, 2);
  v_result text;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then return null; end if;
  if a.status = 'in_progress' then raise exception 'attempt_not_submitted'; end if;

  select
    count(*) filter (where q.question_type <> 'essay')::integer,
    count(*) filter (where q.question_type = 'essay')::integer,
    count(*) filter (where q.question_type = 'essay' and ea.essay_passed is null)::integer,
    count(*) filter (where q.question_type <> 'essay'
      and jsonb_array_length(coalesce(ea.selected_options, '[]'::jsonb)) = jsonb_array_length(coalesce(k.correct_options, '[]'::jsonb))
      and not exists (
        select 1 from jsonb_array_elements_text(coalesce(ea.selected_options, '[]'::jsonb)) selected
        where not coalesce(k.correct_options, '[]'::jsonb) @> jsonb_build_array(selected.value)
      ))::integer,
    coalesce(sum(case
      when q.question_type = 'essay' then
        case when ea.essay_passed then a.essay_points_per_question else 0 end
      when jsonb_array_length(coalesce(ea.selected_options, '[]'::jsonb)) = jsonb_array_length(coalesce(k.correct_options, '[]'::jsonb))
        and not exists (
          select 1 from jsonb_array_elements_text(coalesce(ea.selected_options, '[]'::jsonb)) selected
          where not coalesce(k.correct_options, '[]'::jsonb) @> jsonb_build_array(selected.value)
        ) then a.mc_points_per_question
      else 0
    end), 0)
  into v_mc_count, v_essay_count, v_ungraded, v_correct, v_scored
  from unnest(a.question_order) selected(id)
  join exam_questions q on q.id = selected.id
  left join question_keys k on k.question_id = q.id
  left join exam_answers ea on ea.attempt_id = a.id and ea.question_id = q.id;

  v_incorrect := v_mc_count;
  v_total := v_mc_count * a.mc_points_per_question
    + v_essay_count * a.essay_points_per_question;
  v_scored := round(v_scored, 2);
  v_result := case
    when a.submit_reason = 'tab_switch' then 'FAIL'
    when v_ungraded > 0 or v_total <= 0 then null
    when v_scored >= a.passing_score then 'PASS'
    else 'FAIL'
  end;
  update exam_attempts set
    correct_count = v_correct,
    incorrect_count = greatest(v_incorrect - v_correct, 0),
    scored_points = case when v_ungraded = 0 then v_scored else null end,
    total_points = v_total,
    result = v_result,
    updated_at = now()
  where id = a.id;

  return jsonb_build_object(
    'pendingGrade', v_ungraded > 0,
    'correct', v_correct,
    'incorrect', greatest(v_incorrect - v_correct, 0),
    'scoredPoints', case when v_ungraded = 0 then v_scored else null end,
    'totalPoints', v_total,
    'passingScore', a.passing_score,
    'result', v_result
  );
end $$;

create or replace function attempt_state(p_attempt uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts;
  s exam_settings;
  v_has_essay boolean;
  v_total_points numeric(10, 2);
begin
  select * into a from exam_attempts where id = p_attempt;
  if not found then return null; end if;
  if a.status = 'in_progress' and now() >= a.deadline_at then
    perform finalize_attempt(p_attempt, 'deadline');
    select * into a from exam_attempts where id = p_attempt;
  end if;
  select * into s from exam_settings where id = 1;

  if a.status <> 'in_progress' then
    select exists (
      select 1 from unnest(a.question_order) selected(id)
      join exam_questions q on q.id = selected.id and q.question_type = 'essay'
    ) into v_has_essay;
    return jsonb_build_object(
      'status', a.status,
      'serverNow', now(),
      'hasEssay', v_has_essay,
      'pendingGrade', a.result is null and v_has_essay,
      'mcPointsPerQuestion', a.mc_points_per_question,
      'essayPointsPerQuestion', a.essay_points_per_question,
      'passingScore', a.passing_score,
      'result', case when s.show_score and a.scored_points is not null then
        jsonb_build_object(
          'correct', a.correct_count,
          'incorrect', a.incorrect_count,
          'scoredPoints', a.scored_points,
          'totalPoints', a.total_points,
          'passingScore', a.passing_score,
          'result', a.result
        )
        else null end
    );
  end if;

  select coalesce(sum(case
    when q.question_type = 'essay' then a.essay_points_per_question
    else a.mc_points_per_question
  end), 0)
  into v_total_points
  from unnest(a.question_order) selected(id)
  join exam_questions q on q.id = selected.id;

  return jsonb_build_object(
    'status', a.status,
    'serverNow', now(),
    'deadlineAt', a.deadline_at,
    'mcPointsPerQuestion', a.mc_points_per_question,
    'essayPointsPerQuestion', a.essay_points_per_question,
    'passingScore', a.passing_score,
    'totalPoints', v_total_points,
    'candidate', jsonb_build_object(
      'fullName', a.full_name, 'position', a.position,
      'level', a.candidate_level, 'mainProject', a.main_project
    ),
    'questions', (
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'text', q.question_text, 'type', q.question_type, 'points', q.points, 'options', q.options
      ) order by selected.ordinality)
      from unnest(a.question_order) with ordinality selected(id, ordinality)
      join exam_questions q on q.id = selected.id
    ),
    'answers', coalesce((
      select jsonb_object_agg(question_id, jsonb_build_object(
        'options', selected_options, 'essay', essay_response
      )) from exam_answers where attempt_id = a.id
    ), '{}'::jsonb)
  );
end $$;


notify pgrst, 'reload schema';
