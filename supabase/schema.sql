-- Ejecutar una sola vez en el SQL editor de Supabase al crear un nuevo proyecto (este repo no tiene un runner de migraciones automatizado). Ver docs/superpowers/plans/2026-08-21-mejoras-plataforma.md, Track C, Task C1.

create table if not exists kv_store (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table kv_store enable row level security;

grant select, insert, update, delete on public.kv_store to authenticated;
revoke all on public.kv_store from anon;

drop policy if exists "allow anon read/write kv_store" on kv_store;
drop policy if exists "allow authenticated read/write kv_store" on kv_store;

create policy "allow authenticated read/write kv_store"
  on kv_store for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------
-- Roles y permisos
-- ---------------------------------------------------------------------
-- Ejecutar esta sección una sola vez (agregada en una fase posterior a la
-- creación inicial de kv_store, ver arriba). Requiere que el proveedor de
-- autenticación "Email" esté habilitado en Authentication > Providers.
--
-- Cada fila de auth.users obtiene automáticamente una fila en
-- public.profiles con role='usuario' (via trigger). Para promover a alguien
-- a administrador, correr a mano:
--   update public.profiles set role = 'admin' where email = 'tu-mail@ejemplo.com';

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'usuario' check (role in ('admin', 'usuario')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Función helper "security definer": corre con privilegios del dueño
-- (postgres), que no está sujeto a RLS, así que evita la recursión infinita
-- que se produce si una policy de profiles vuelve a consultar profiles
-- directamente (error 42P17).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

drop policy if exists "profiles: select own or admin" on public.profiles;
create policy "profiles: select own or admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: admin updates role" on public.profiles;
create policy "profiles: admin updates role"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

grant select, update on public.profiles to authenticated;

-- Crea el perfil automáticamente cuando se registra un usuario nuevo
-- (signup o alta manual desde Authentication > Users en el dashboard).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
