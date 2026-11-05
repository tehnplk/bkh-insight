alter table users add column profile jsonb not null default '{}'::jsonb;
