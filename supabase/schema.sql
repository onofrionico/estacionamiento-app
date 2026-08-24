-- Ejecutar una sola vez en el SQL editor de Supabase al crear un nuevo proyecto (este repo no tiene un runner de migraciones automatizado). Ver docs/superpowers/plans/2026-08-21-mejoras-plataforma.md, Track C, Task C1.

create table kv_store (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table kv_store enable row level security;

create policy "allow anon read/write kv_store"
  on kv_store for all
  using (true)
  with check (true);

-- La policy RLS de arriba no alcanza por si sola: Postgres exige ademas el
-- GRANT de base sobre la tabla para el rol que hace la consulta. Al crear la
-- tabla por SQL crudo (en vez de la UI de Supabase, que lo hace automatico)
-- hay que otorgarlo a mano.
grant select, insert, update, delete on public.kv_store to anon;
grant select, insert, update, delete on public.kv_store to authenticated;
