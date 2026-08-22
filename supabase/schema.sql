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
