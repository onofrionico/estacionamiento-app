-- Correr UNA SOLA VEZ en el SQL editor de Supabase, en proyectos que ya
-- tienen las tablas `config` y `visitas` del esquema relacional (ver
-- supabase/schema.sql). Agrega los datos de identidad del negocio (nombre,
-- dirección, teléfono, logo) y los flags de impresión automática a
-- `config`, numeración secuencial de ticket a `visitas`, y un bucket de
-- Storage público para los logos. Ver
-- docs/superpowers/specs/2026-08-31-impresion-tickets-design.md.
--
-- Importante: correr esto ANTES de deployar el código que empieza a leer y
-- escribir estas columnas (la app hace `select("*")` así que tolera leer
-- antes de que existan, pero `setConfig`/`insertVehicle` van a fallar al
-- intentar escribirlas si todavía no existen).

alter table config add column if not exists nombre text not null default 'Mi Estacionamiento';
alter table config add column if not exists direccion text;
alter table config add column if not exists telefono text;
alter table config add column if not exists logo_url text;
alter table config add column if not exists imprimir_ingreso boolean not null default false;
alter table config add column if not exists imprimir_egreso boolean not null default false;

alter table visitas add column if not exists numero_ticket int generated always as identity;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'visitas_numero_ticket_unique'
  ) then
    alter table visitas add constraint visitas_numero_ticket_unique unique (numero_ticket);
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

drop policy if exists "authenticated write logos" on storage.objects;
create policy "authenticated write logos" on storage.objects for all
  using (bucket_id = 'logos' and auth.role() = 'authenticated')
  with check (bucket_id = 'logos' and auth.role() = 'authenticated');

drop policy if exists "public read logos" on storage.objects;
create policy "public read logos" on storage.objects for select using (bucket_id = 'logos');
