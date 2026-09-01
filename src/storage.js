/**
 * Capa de almacenamiento sobre Supabase (tablas tipos_vehiculo, vehiculos,
 * visitas, egresos, tarifas_por_tipo, config). Arma en JS el objeto plano
 * que consume la UI —un vehículo: {id, patente, tipo, horaIngreso,
 * horaSalida, monto, estado}; una config: {totalEspacios, rates, umbrales}—
 * a partir de varias tablas relacionales, así que el resto de la app no
 * necesita saber que el dato está normalizado. El cliente de Supabase ya
 * adjunta el JWT de la sesión activa en cada request, así que las policies
 * RLS "authenticated" del esquema se aplican solas.
 */
import { supabase } from "./supabaseClient";

function flattenVehicle(visita, vehiculo, egreso, medioPago) {
  if (!vehiculo) {
    console.error(`storage: visita ${visita.id} referencia un vehiculo inexistente (${visita.vehiculo_id})`);
    return null;
  }
  return {
    id: visita.id,
    patente: vehiculo.patente,
    tipo: vehiculo.tipo_id,
    horaIngreso: new Date(visita.hora_ingreso).getTime(),
    horaSalida: egreso ? new Date(egreso.hora_salida).getTime() : null,
    monto: egreso ? Number(egreso.monto) : null,
    medioPagoId: egreso ? egreso.medio_pago_id : null,
    medioPago: medioPago ? medioPago.nombre : null,
    estado: visita.estado,
    numeroTicket: visita.numero_ticket,
  };
}

function configFromRows(configRow, tarifaRows) {
  const rates = {};
  for (const t of tarifaRows) {
    if (!rates[t.tipo_id]) rates[t.tipo_id] = {};
    rates[t.tipo_id][t.concepto] = Number(t.monto);
  }
  return {
    nombre: configRow.nombre,
    direccion: configRow.direccion || "",
    telefono: configRow.telefono || "",
    logoUrl: configRow.logo_url || "",
    imprimirIngreso: !!configRow.imprimir_ingreso,
    imprimirEgreso: !!configRow.imprimir_egreso,
    totalEspacios: configRow.total_espacios,
    rates,
    umbrales: {
      mediaEstadiaHoras: configRow.umbral_media_estadia_horas,
      estadiaCompletaHoras: configRow.umbral_estadia_completa_horas,
      ...(configRow.umbral_tolerancia_min != null ? { toleranciaMin: configRow.umbral_tolerancia_min } : {}),
    },
  };
}

async function getVehicleById(id) {
  const { data: visita, error: eV } = await supabase
    .from("visitas")
    .select("*")
    .is("deleted_at", null)
    .eq("id", id)
    .maybeSingle();
  if (eV) throw eV;
  if (!visita) return null;
  const [{ data: vehiculo, error: eA }, { data: egreso, error: eE }] = await Promise.all([
    supabase.from("vehiculos").select("*").eq("patente", visita.vehiculo_id).single(),
    supabase.from("egresos").select("*").eq("visita_id", id).maybeSingle(),
  ]);
  if (eA) throw eA;
  if (eE) throw eE;
  let medioPago = null;
  if (egreso?.medio_pago_id) {
    const { data, error: eM } = await supabase
      .from("medios_pago")
      .select("*")
      .eq("id", egreso.medio_pago_id)
      .maybeSingle();
    if (eM) throw eM;
    medioPago = data;
  }
  return flattenVehicle(visita, vehiculo, egreso, medioPago);
}

export const storage = {
  async getVehicles() {
    const { data: visitas, error: eV } = await supabase
      .from("visitas")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (eV) throw eV;

    const patentes = [...new Set(visitas.map((v) => v.vehiculo_id))];
    const visitaIds = visitas.map((v) => v.id);

    const [
      { data: vehiculos, error: eA },
      { data: egresos, error: eE },
      { data: mediosPago, error: eM },
    ] = await Promise.all([
      supabase.from("vehiculos").select("*").in("patente", patentes),
      supabase.from("egresos").select("*").in("visita_id", visitaIds),
      supabase.from("medios_pago").select("*"),
    ]);
    if (eA) throw eA;
    if (eE) throw eE;
    if (eM) throw eM;

    const vehiculoByPatente = new Map(vehiculos.map((v) => [v.patente, v]));
    const egresoByVisitaId = new Map(egresos.map((e) => [e.visita_id, e]));
    const medioPagoById = new Map(mediosPago.map((m) => [m.id, m]));

    return visitas
      .map((visita) => {
        const egreso = egresoByVisitaId.get(visita.id);
        const medioPago = egreso?.medio_pago_id ? medioPagoById.get(egreso.medio_pago_id) : null;
        return flattenVehicle(visita, vehiculoByPatente.get(visita.vehiculo_id), egreso, medioPago);
      })
      .filter(Boolean);
  },

  async insertVehicle(vehicle) {
    const { error: upsertError } = await supabase
      .from("vehiculos")
      .upsert({ patente: vehicle.patente, tipo_id: vehicle.tipo }, { onConflict: "patente" });
    if (upsertError) throw upsertError;

    const { data, error } = await supabase
      .from("visitas")
      .insert({
        id: vehicle.id,
        vehiculo_id: vehicle.patente,
        hora_ingreso: new Date(vehicle.horaIngreso).toISOString(),
        estado: "dentro",
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        const dupError = new Error(`${vehicle.patente} ya está registrado dentro`);
        dupError.code = "DUPLICATE_PATENTE";
        throw dupError;
      }
      throw error;
    }
    return { ...vehicle, numeroTicket: data.numero_ticket };
  },

  async updateVehicle(id, patch) {
    const { error } = await supabase.rpc("cerrar_visita", {
      p_visita_id: id,
      p_hora_salida: new Date(patch.horaSalida).toISOString(),
      p_monto: patch.monto,
      p_medio_pago_id: patch.medioPagoId,
    });
    if (error) throw error;
  },

  async deleteAllVehicles() {
    const { error } = await supabase.from("visitas").delete().neq("id", "");
    if (error) throw error;
  },

  async deleteVehicle(id) {
    const { error } = await supabase.rpc("soft_delete_visita", { p_visita_id: id });
    if (error) throw error;
  },

  async getMediosPago() {
    const { data, error } = await supabase.from("medios_pago").select("*").order("nombre");
    if (error) throw error;
    return data;
  },

  async upsertMedioPago(medio) {
    const { error } = await supabase
      .from("medios_pago")
      .upsert({ id: medio.id, nombre: medio.nombre, activo: medio.activo });
    if (error) throw error;
  },

  async getConfig() {
    const { data: configRow, error: eC } = await supabase.from("config").select("*").eq("id", 1).maybeSingle();
    if (eC) throw eC;
    if (!configRow) return null;
    const { data: tarifas, error: eT } = await supabase.from("tarifas_vigentes").select("*");
    if (eT) throw eT;
    return configFromRows(configRow, tarifas);
  },

  async setConfig(config) {
    const { error: eC } = await supabase.from("config").upsert({
      id: 1,
      nombre: config.nombre,
      direccion: config.direccion || null,
      telefono: config.telefono || null,
      logo_url: config.logoUrl || null,
      imprimir_ingreso: !!config.imprimirIngreso,
      imprimir_egreso: !!config.imprimirEgreso,
      total_espacios: config.totalEspacios,
      umbral_media_estadia_horas: config.umbrales.mediaEstadiaHoras,
      umbral_estadia_completa_horas: config.umbrales.estadiaCompletaHoras,
      umbral_tolerancia_min: config.umbrales.toleranciaMin,
    });
    if (eC) throw eC;

    const vigenteDesde = new Date().toISOString();
    const tarifaRows = Object.entries(config.rates).flatMap(([tipoId, conceptos]) =>
      Object.entries(conceptos).map(([concepto, monto]) => ({
        tipo_id: tipoId,
        concepto,
        monto,
        vigente_desde: vigenteDesde,
      }))
    );
    const { error: eT } = await supabase.from("tarifas_por_tipo").insert(tarifaRows);
    if (eT) throw eT;
  },

  async uploadLogo(file) {
    const ext = file.name.split(".").pop();
    const path = `logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
    if (error) throw error;
    return supabase.storage.from("logos").getPublicUrl(path).data.publicUrl;
  },

  subscribeToChanges({ onVehicleChange, onConfigChange, onMediosPagoChange }) {
    const refreshConfig = async () => {
      const config = await storage.getConfig();
      if (config) onConfigChange(config);
    };

    const refreshMediosPago = async () => {
      const mediosPago = await storage.getMediosPago();
      onMediosPagoChange(mediosPago);
    };

    const channel = supabase
      .channel("parking-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "visitas" }, (payload) => {
        if (payload.eventType === "DELETE") {
          onVehicleChange({ eventType: "DELETE", vehicle: { id: payload.old.id } });
          return;
        }
        if (payload.eventType === "UPDATE" && payload.new.deleted_at) {
          onVehicleChange({ eventType: "DELETE", vehicle: { id: payload.new.id } });
          return;
        }
        getVehicleById(payload.new.id)
          .then((vehicle) => {
            if (vehicle) onVehicleChange({ eventType: payload.eventType, vehicle });
          })
          .catch((err) => console.error("storage: error procesando cambio de visita en tiempo real", err));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "egresos" }, (payload) => {
        getVehicleById(payload.new.visita_id)
          .then((vehicle) => {
            if (vehicle) onVehicleChange({ eventType: "UPDATE", vehicle });
          })
          .catch((err) => console.error("storage: error procesando cambio de egreso en tiempo real", err));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "config" }, () => {
        refreshConfig().catch((err) => console.error("storage: error refrescando config en tiempo real", err));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tarifas_por_tipo" }, () => {
        refreshConfig().catch((err) => console.error("storage: error refrescando config en tiempo real", err));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "medios_pago" }, () => {
        refreshMediosPago().catch((err) => console.error("storage: error refrescando medios de pago en tiempo real", err));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  },
};
