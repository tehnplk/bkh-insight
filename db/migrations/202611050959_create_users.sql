create table users (
  id bigint generated always as identity primary key,
  provider_id text not null unique,
  pname text,
  fname text not null,
  lname text not null,
  role text not null default 'user',
  permission jsonb not null default '{}'::jsonb,
  is_approve boolean not null default false,
  log jsonb not null default '[]'::jsonb
);
