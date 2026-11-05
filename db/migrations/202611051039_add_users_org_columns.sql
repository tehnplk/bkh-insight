alter table users
  add column job_position text,
  add column organizations jsonb not null default '[]'::jsonb;

update users set
  organizations = case
    when jsonb_typeof(profile->'organizations') = 'array' then profile->'organizations'
    when profile ? 'org_code' or profile ? 'org_name' then jsonb_build_array(jsonb_build_object(
      'org_code', profile->>'org_code',
      'org_name', profile->>'org_name',
      'job_position', profile->>'job_position'))
    else '[]'::jsonb
  end,
  job_position = coalesce(profile->>'job_position', profile->'organizations'->0->>'job_position');
