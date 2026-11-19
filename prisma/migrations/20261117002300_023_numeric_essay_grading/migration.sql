-- Ported from 023_numeric_essay_grading.sql; original transaction logic is unchanged.
alter table exam_answers
  add column if not exists essay_score numeric(10, 2);

update exam_answers ea
set essay_score = case
  when ea.essay_passed is not null then
    case when ea.essay_passed then a.essay_points_per_question else 0 end
  else least(greatest(ea.essay_score, 0), a.essay_points_per_question)
end
from exam_attempts a, exam_questions q
where ea.attempt_id = a.id
  and q.id = ea.question_id
  and q.question_type = 'essay'
  and (ea.essay_passed is not null or ea.essay_score is not null);

update exam_answers ea
set essay_score = 0
from exam_attempts a, exam_questions q
where ea.attempt_id = a.id
  and q.id = ea.question_id
  and q.question_type = 'essay'
  and a.submit_reason = 'tab_switch';

insert into exam_answers(
  
  attempt_id, question_id, selected_option, selected_options, essay_response, essay_score
)
select a.id, q.id, '', '[]'::jsonb, null, 0
from exam_attempts a
cross join unnest(a.question_order) selected(id)
join exam_questions q on q.id = selected.id and q.question_type = 'essay'
where a.status <> 'in_progress' and a.submit_reason = 'tab_switch'
on conflict (attempt_id, question_id) do update
  set essay_score = 0, updated_at = now();

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
    count(*) filter (where q.question_type = 'essay' and ea.essay_score is null)::integer,
    count(*) filter (where q.question_type <> 'essay'
      and jsonb_array_length(coalesce(ea.selected_options, '[]'::jsonb)) = jsonb_array_length(coalesce(k.correct_options, '[]'::jsonb))
      and not exists (
        select 1 from jsonb_array_elements_text(coalesce(ea.selected_options, '[]'::jsonb)) selected
        where not coalesce(k.correct_options, '[]'::jsonb) @> jsonb_build_array(selected.value)
      ))::integer,
    coalesce(sum(case
      when q.question_type = 'essay' then ea.essay_score
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

create or replace function grade_essay_attempt(p_attempt uuid, p_grades jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts;
  v_essay_count integer;
  v_result jsonb;
begin
  if p_grades is null or jsonb_typeof(p_grades) <> 'array' then
    raise exception 'invalid_grade';
  end if;
  select * into a from exam_attempts where id = p_attempt for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.status = 'in_progress' then raise exception 'attempt_not_submitted'; end if;

  select count(*)::integer into v_essay_count
  from unnest(a.question_order) selected(id)
  join exam_questions q on q.id = selected.id and q.question_type = 'essay';

  if jsonb_array_length(p_grades) <> v_essay_count
    or exists (
      select 1 from jsonb_array_elements(p_grades) grade
      where jsonb_typeof(grade.value) <> 'object'
        or coalesce(jsonb_typeof(grade.value -> 'questionId'), '') <> 'string'
        or coalesce(jsonb_typeof(grade.value -> 'points'), '') <> 'number'
    )
    or (select count(distinct grade.value ->> 'questionId') from jsonb_array_elements(p_grades) grade) <> v_essay_count
    or exists (
      select 1 from jsonb_array_elements(p_grades) grade
      where not exists (
        select 1 from unnest(a.question_order) selected(id)
        join exam_questions q on q.id = selected.id and q.question_type = 'essay'
        where q.id::text = grade.value ->> 'questionId'
      )
    ) then
    raise exception 'invalid_grade';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_grades) grade
    where (grade.value ->> 'points')::numeric < 0
      or (grade.value ->> 'points')::numeric > a.essay_points_per_question
      or (grade.value ->> 'points')::numeric <> round((grade.value ->> 'points')::numeric, 2)
  ) then
    raise exception 'invalid_grade';
  end if;

  insert into exam_answers(
    attempt_id, question_id, selected_option, selected_options, essay_response, essay_score
  )
  select a.id, q.id, '', '[]'::jsonb, null, (grade.value ->> 'points')::numeric
  from jsonb_array_elements(p_grades) grade
  join unnest(a.question_order) selected(id) on true
  join exam_questions q on q.id = selected.id
    and q.question_type = 'essay'
    and q.id::text = grade.value ->> 'questionId'
  on conflict (attempt_id, question_id) do update
    set essay_score = excluded.essay_score,
        updated_at = now();

  v_result := refresh_attempt_score(a.id);
  return v_result;
end $$;


do $$
declare
  item record;
begin
  for item in select id from exam_attempts where status <> 'in_progress' loop
    perform refresh_attempt_score(item.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
