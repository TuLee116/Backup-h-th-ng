-- Ported from 010_default_logo_png.sql; original transaction logic is unchanged.
alter table exam_settings
  alter column logo_url set default '/logo.png';

update exam_settings
set logo_url = '/logo.png'
where id = 1;
