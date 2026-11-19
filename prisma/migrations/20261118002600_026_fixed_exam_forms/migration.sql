alter table exam_questions add column form_no smallint check (form_no between 1 and 5);
alter table exam_attempts add column form_no smallint check (form_no between 1 and 5);
alter table exam_settings add column fixed_forms_enabled boolean not null default false;
create index exam_questions_form_order_idx on exam_questions (form_no, bank_order) where active;

create function prevent_exam_mode_change_after_start() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.fixed_forms_enabled is distinct from new.fixed_forms_enabled
    and exists (select 1 from exam_attempts) then
    raise exception 'mode_locked';
  end if;
  return new;
end $$;
create trigger exam_mode_locked_before_update
before update of fixed_forms_enabled on exam_settings
for each row execute function prevent_exam_mode_change_after_start();

create function import_fixed_forms(p_items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  s exam_settings;
  it jsonb;
  qid uuid;
  n integer := 0;
  v_form integer;
  v_type text;
  v_correct jsonb;
begin
  select * into s from exam_settings where id = 1 for update;
  if exists (select 1 from exam_attempts) then raise exception 'locked'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'invalid_forms'; end if;
  for v_form in 1..5 loop
    if (select count(*) from jsonb_array_elements(p_items) as item(value) where (value->>'formNo')::integer = v_form and value->>'type' = 'essay') <> s.essay_question_count
      or (select count(*) from jsonb_array_elements(p_items) as item(value) where (value->>'formNo')::integer = v_form and value->>'type' <> 'essay') <> s.mc_question_count then
      raise exception 'invalid_forms';
    end if;
  end loop;
  if jsonb_array_length(p_items) <> 5 * (s.mc_question_count + s.essay_question_count) then raise exception 'invalid_forms'; end if;
  delete from exam_questions where true;
  for it in select value from jsonb_array_elements(p_items) with ordinality as item(value, ord) order by ord loop
    v_form := (it->>'formNo')::integer;
    if v_form not between 1 and 5 then raise exception 'invalid_forms'; end if;
    v_type := it->>'type';
    v_correct := coalesce(it->'correct', '[]'::jsonb);
    n := n + 1;
    insert into exam_questions(bank_order, form_no, question_text, options, question_type, points)
    values (n, v_form, it->>'text', coalesce(it->'options', '[]'::jsonb), v_type, coalesce((it->>'points')::numeric, 1))
    returning id into qid;
    insert into question_keys(question_id, correct_option, correct_options, reference_answer)
    values (qid, coalesce(v_correct->>0, ''), v_correct, nullif(it->>'referenceAnswer', ''));
  end loop;
  return n;
end $$;

create or replace function start_attempt(
  p_name text, p_email text, p_position text, p_level text,
  p_main_project text, p_token_hash text
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
  v_form integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));
  if exists (select 1 from exam_attempts where normalized_email = v_email) then raise exception 'email_used'; end if;
  select sequence_number, participant_name into v_participant_order, v_participant_name
  from participant_email_allowlist where email = v_email;
  if not found then raise exception 'email_not_allowed'; end if;
  select * into v_project from exam_projects
  where lower(btrim(name)) = lower(btrim(p_main_project)) and active for share;
  if not found then raise exception 'invalid_project'; end if;
  select * into s from exam_settings where id = 1 for share;
  if not s.active then raise exception 'closed'; end if;
  if now() < s.opening_at then raise exception 'not_open'; end if;
  if now() >= s.closing_at then raise exception 'closed'; end if;
  if s.mc_question_count + s.essay_question_count not between 1 and 1000 then raise exception 'invalid_question_count'; end if;
  if s.fixed_forms_enabled then
    v_form := ((v_participant_order - 1) % 5) + 1;
    select array_agg(id order by question_type = 'essay', bank_order) into v_order
    from exam_questions where active and form_no = v_form;
    if (select count(*) from exam_questions where active and form_no = v_form and question_type <> 'essay') <> s.mc_question_count
      or (select count(*) from exam_questions where active and form_no = v_form and question_type = 'essay') <> s.essay_question_count then
      raise exception 'not_ready';
    end if;
  else
    with selected_multiple_choice as (
      select id, random() as r from exam_questions
      where active and question_type in ('single', 'multiple') order by r limit s.mc_question_count
    ), selected_essay as (
      select id, random() as r from exam_questions
      where active and question_type = 'essay' order by r limit s.essay_question_count
    ), selected_questions as (
      select id, r, false as is_essay from selected_multiple_choice
      union all select id, r, true as is_essay from selected_essay
    )
    select array_agg(id order by is_essay, r) into v_order from selected_questions;
  end if;
  if coalesce(cardinality(v_order), 0) <> s.mc_question_count + s.essay_question_count then raise exception 'not_ready'; end if;
  v_deadline := least(now() + make_interval(mins => s.duration_minutes), s.closing_at);
  insert into exam_attempts(
    id, full_name, normalized_email, position, candidate_level, main_project, project_id,
    token_hash, deadline_at, question_order, participant_order, participant_list_name, form_no
  ) values (
    v_id, p_name, v_email, p_position, p_level, v_project.name, v_project.id,
    p_token_hash, v_deadline, v_order, v_participant_order, v_participant_name, v_form
  );
  return v_deadline;
end $$;
