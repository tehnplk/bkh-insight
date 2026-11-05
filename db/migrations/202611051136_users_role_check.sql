alter table users add constraint users_role_check check (role in ('user','admin'));
