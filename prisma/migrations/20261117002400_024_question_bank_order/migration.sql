-- Ported from 024_question_bank_order.sql; original transaction logic is unchanged.
alter table exam_questions add column bank_order bigint;

with ordered_questions as (
  select id, row_number() over (order by created_at, ctid) as bank_order
  from exam_questions
)
update exam_questions q
set bank_order = ordered_questions.bank_order
from ordered_questions
where ordered_questions.id = q.id;

alter table exam_questions alter column bank_order set not null;
create unique index exam_questions_bank_order_idx on exam_questions(bank_order);

create or replace function import_questions(p_mode text, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  qid uuid;
  n int := 0;
  v_type text;
  v_correct jsonb;
  v_order bigint;
begin
  if exists (select 1 from exam_attempts) then raise exception 'locked'; end if;
  if p_mode not in ('replace', 'append') then raise exception 'invalid_mode'; end if;
  if p_mode = 'replace' then
    delete from exam_questions where true;
    v_order := 0;
  else
    select coalesce(max(bank_order), 0) into v_order from exam_questions;
  end if;

  for it in
    select value
    from jsonb_array_elements(p_items) with ordinality as item(value, ord)
    order by ord
  loop
    v_type := coalesce(it->>'type', 'single');
    v_correct := coalesce(it->'correct', '[]'::jsonb);
    v_order := v_order + 1;
    insert into exam_questions(bank_order, question_text, options, question_type, points)
      values (v_order, it->>'text', coalesce(it->'options', '[]'::jsonb), v_type, coalesce((it->>'points')::numeric, 1))
      returning id into qid;
    insert into question_keys(question_id, correct_option, correct_options, reference_answer)
      values (qid, coalesce(v_correct->>0, ''), v_correct, nullif(it->>'referenceAnswer', ''));
    n := n + 1;
  end loop;
  return n;
end $$;
