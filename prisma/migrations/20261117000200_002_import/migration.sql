-- Ported from 002_import.sql; original transaction logic is unchanged.
-- Atomic question import. Refuses once any attempt exists (the exam must not change mid-event).
create or replace function import_questions(p_mode text, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare it jsonb; qid uuid; n int := 0;
begin
  if exists (select 1 from exam_attempts) then raise exception 'locked'; end if;
  if p_mode = 'replace' then delete from exam_questions; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into exam_questions(question_text, options) values (it->>'text', it->'options') returning id into qid;
    insert into question_keys(question_id, correct_option) values (qid, it->>'correct');
    n := n + 1;
  end loop;
  return n;
end $$;
