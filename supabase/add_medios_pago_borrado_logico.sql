-- Ejecutar una sola vez en el SQL editor de Supabase, en proyectos que ya
-- corrieron schema.sql antes de que existieran medios de pago / borrado
-- lógico / colisión de patente. Requiere que la sección "Roles y permisos"
-- de schema.sql (tabla public.profiles) ya haya sido ejecutada.

create table medios_pago (
  id text primary key,
  nombre text not null,
  activo boolean not null default true
);

insert into medios_pago (id, nombre) values
  ('efectivo', 'Efectivo'),
  ('tarjeta', 'Tarjeta'),
  ('transferencia', 'Transferencia'),
  ('qr', 'QR / Mercado Pago');

alter table egresos add column medio_pago_id text references medios_pago (id);

alter table medios_pago enable row level security;

grant select, insert, update on public.medios_pago to authenticated;
revoke all on public.medios_pago from anon;

drop policy if exists "allow authenticated read/write medios_pago" on medios_pago;
create policy "allow authenticated read/write medios_pago"
  on medios_pago for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop function if exists public.cerrar_visita(text, timestamptz, numeric);

create or replace function public.cerrar_visita(
  p_visita_id text,
  p_hora_salida timestamptz,
  p_monto numeric,
  p_medio_pago_id text
)
returns void
language plpgsql
security invoker
as $$
begin
  insert into public.egresos (visita_id, hora_salida, monto, medio_pago_id)
  values (p_visita_id, p_hora_salida, p_monto, p_medio_pago_id);

  update public.visitas
  set estado = 'afuera'
  where id = p_visita_id
    and estado = 'dentro';

  if not found then
    raise exception 'visita % no está dentro (ya salió o no existe)', p_visita_id;
  end if;
end;
$$;

grant execute on function public.cerrar_visita(text, timestamptz, numeric, text) to authenticated;

alter table visitas add column deleted_at timestamptz;
alter table visitas add column deleted_by uuid references public.profiles (id);

create or replace function public.soft_delete_visita(p_visita_id text)
returns void
language plpgsql
security invoker
as $$
begin
  update public.visitas
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_visita_id
    and deleted_at is null;

  if not found then
    raise exception 'visita % no existe o ya fue borrada', p_visita_id;
  end if;
end;
$$;

grant execute on function public.soft_delete_visita(text) to authenticated;

alter publication supabase_realtime add table medios_pago;
