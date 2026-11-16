-- =====================================================================
--  KelasHub — KONSEP BARU: kelas & mata kuliah dikelola ADMIN
-- =====================================================================

-- 0. Cabut policy lama
drop policy if exists profiles_select on public.profiles;
drop policy if exists classes_select  on public.classes;
drop policy if exists classes_insert  on public.classes;
drop policy if exists classes_update  on public.classes;
drop policy if exists classes_delete  on public.classes;
drop policy if exists members_select  on public.class_members;
drop policy if exists members_delete  on public.class_members;
drop policy if exists courses_select  on public.courses;
drop policy if exists courses_insert  on public.courses;
drop policy if exists courses_update  on public.courses;
drop policy if exists courses_delete  on public.courses;
drop policy if exists tasks_select    on public.tasks;
drop policy if exists tasks_insert    on public.tasks;
drop policy if exists tasks_update    on public.tasks;
drop policy if exists tasks_delete    on public.tasks;
drop policy if exists subs_select     on public.submissions;
drop policy if exists subs_insert     on public.submissions;
drop policy if exists subs_update     on public.submissions;
drop policy if exists subs_delete     on public.submissions;
drop policy if exists mats_select     on public.materials;
drop policy if exists mats_insert     on public.materials;
drop policy if exists mats_delete     on public.materials;
drop policy if exists files_select    on storage.objects;
drop policy if exists files_insert    on storage.objects;
drop policy if exists files_delete    on storage.objects;

-- 1. SKEMA
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'dosen', 'mahasiswa'));

alter table public.courses
  add column if not exists dosen_id uuid references public.profiles(id) on delete set null;
create index if not exists courses_dosen_idx on public.courses (dosen_id);

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'classes' and column_name = 'owner_id') then
    update public.courses c set dosen_id = cl.owner_id
      from public.classes cl where cl.id = c.class_id and c.dosen_id is null;
  end if;
end $$;

drop trigger  if exists on_class_created on public.classes;
drop function if exists private.add_owner_member();
alter table public.classes drop column if exists owner_id;

update public.classes set name = left(name, 31) || ' (' || code || ')'
where id in (
  select id from (
    select id, row_number() over (partition by lower(name) order by created_at, id) rn
    from public.classes) x
  where rn > 1);
create unique index if not exists classes_name_uq on public.classes (lower(name));

-- 2. FUNGSI BANTU (schema private)
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

create or replace function private.is_mahasiswa() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'mahasiswa');
$$;

create or replace function private.teaches(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.courses where class_id = cid and dosen_id = (select auth.uid()));
$$;

create or replace function private.teaches_course(coid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.courses where id = coid and dosen_id = (select auth.uid()));
$$;

create or replace function private.teaches_task(tid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t join public.courses c on c.id = t.course_id
    where t.id = tid and c.dosen_id = (select auth.uid()));
$$;

revoke all on function private.is_admin(), private.is_mahasiswa(), private.teaches(uuid),
                       private.teaches_course(uuid), private.teaches_task(uuid) from public, anon;
grant execute on function private.is_admin(), private.is_mahasiswa(), private.teaches(uuid),
                          private.teaches_course(uuid), private.teaches_task(uuid) to authenticated;

-- 3. TRIGGER: penunjukan pengampu
create or replace function private.courses_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.dosen_id is not null then
    if not exists (select 1 from public.profiles where id = new.dosen_id and role = 'dosen') then
      raise exception 'Pengampu harus berupa akun dosen';
    end if;
    insert into public.class_members (class_id, user_id) values (new.class_id, new.dosen_id)
      on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function private.courses_guard() from public, anon, authenticated;

drop trigger if exists courses_guard on public.courses;
create trigger courses_guard before insert or update of dosen_id, class_id on public.courses
  for each row execute function private.courses_guard();

-- 4. GABUNG KELAS DENGAN KODE — untuk mahasiswa DAN dosen
create or replace function public.join_class(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  c   public.classes;
begin
  if uid is null then raise exception 'Silakan masuk dulu'; end if;
  if not exists (select 1 from public.profiles where id = uid and role in ('mahasiswa', 'dosen')) then
    raise exception 'Akun admin tidak perlu bergabung ke kelas';
  end if;
  select * into c from public.classes where code = upper(trim(p_code));
  if not found then raise exception 'Kode kelas tidak ditemukan'; end if;
  insert into public.class_members (class_id, user_id) values (c.id, uid) on conflict do nothing;
  return jsonb_build_object('id', c.id, 'name', c.name);
end $$;
revoke all on function public.join_class(text) from public, anon;
grant execute on function public.join_class(text) to authenticated;

-- 5. ROW LEVEL SECURITY (versi baru)
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_class(id) or private.is_admin());

create policy classes_select on public.classes for select to authenticated
  using (private.is_member(id) or private.is_admin());
create policy classes_insert on public.classes for insert to authenticated
  with check (private.is_admin());
create policy classes_update on public.classes for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy classes_delete on public.classes for delete to authenticated
  using (private.is_admin());

create policy members_select on public.class_members for select to authenticated
  using (private.is_member(class_id) or private.is_admin());
create policy members_delete on public.class_members for delete to authenticated
  using ((user_id = (select auth.uid()) and not private.teaches(class_id)) or private.is_admin());

create policy courses_select on public.courses for select to authenticated
  using (private.is_member(class_id) or private.is_admin());
create policy courses_insert on public.courses for insert to authenticated
  with check (private.is_admin());
create policy courses_update on public.courses for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy courses_delete on public.courses for delete to authenticated
  using (private.is_admin());

create policy tasks_select on public.tasks for select to authenticated
  using (private.is_member(class_id) or private.is_admin());
create policy tasks_insert on public.tasks for insert to authenticated
  with check (by_id = (select auth.uid()) and private.is_dosen()
    and exists (select 1 from public.courses c
                where c.id = tasks.course_id and c.class_id = tasks.class_id
                  and c.dosen_id = (select auth.uid())));
create policy tasks_update on public.tasks for update to authenticated
  using (private.teaches_course(course_id))
  with check (private.teaches_course(course_id)
    and exists (select 1 from public.courses c where c.id = tasks.course_id and c.class_id = tasks.class_id));
create policy tasks_delete on public.tasks for delete to authenticated
  using (private.teaches_course(course_id));

create policy subs_select on public.submissions for select to authenticated
  using (user_id = (select auth.uid()) or private.teaches_task(task_id) or private.is_admin());
create policy subs_insert on public.submissions for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_mahasiswa() and private.is_member(class_id)
    and exists (select 1 from public.tasks t where t.id = task_id and t.class_id = submissions.class_id));
create policy subs_update on public.submissions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.is_member(class_id)
    and exists (select 1 from public.tasks t where t.id = task_id and t.class_id = submissions.class_id));
create policy subs_delete on public.submissions for delete to authenticated
  using (user_id = (select auth.uid()) or private.teaches_task(task_id));

create policy mats_select on public.materials for select to authenticated
  using (private.is_member(class_id) or private.is_admin());
create policy mats_insert on public.materials for insert to authenticated
  with check (private.is_member(class_id) and author_id = (select auth.uid())
    and exists (select 1 from public.courses c
                where c.id = materials.course_id and c.class_id = materials.class_id
                  and (private.is_mahasiswa() or c.dosen_id = (select auth.uid()))));
create policy mats_delete on public.materials for delete to authenticated
  using (author_id = (select auth.uid()) or private.teaches_course(course_id));

-- 6. STORAGE (bucket "files")
create policy files_select on storage.objects for select to authenticated
  using (bucket_id = 'files' and (
    private.is_admin()
    or (private.is_member(private.path_class(name))
        and (split_part(name, '/', 2) <> 'subs'
             or split_part(name, '/', 3) = (select auth.uid())::text
             or exists (select 1 from public.submissions s
                        where s.file_path = objects.name and private.teaches_task(s.task_id))))));

create policy files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and private.is_member(private.path_class(name))
    and (   (split_part(name, '/', 2) = 'subs'  and split_part(name, '/', 3) = (select auth.uid())::text
             and private.is_mahasiswa())
         or (split_part(name, '/', 2) = 'tasks' and private.teaches(private.path_class(name)))
         or  split_part(name, '/', 2) = 'mats'));

create policy files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (
    owner_id = (select auth.uid())::text
    or private.is_admin()
    or (split_part(name, '/', 2) in ('subs', 'mats') and private.teaches(private.path_class(name)))));

-- 7. Bersihkan fungsi lama
drop function if exists private.is_owner(uuid);
