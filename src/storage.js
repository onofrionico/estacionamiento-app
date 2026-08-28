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

function flattenVehicle(visita, vehiculo, egreso) {
  return {
    id: visita.id,
    patente: vehiculo.patente,
    tipo: vehiculo.tipo_id,
    horaIngreso: new Date(visita.hora_ingreso).getTime(),
    horaSalida: egreso ? new Date(egreso.hora_salida).getTime() : null,
    monto: egreso ? Number(egreso.monto) : null,
    estado: visita.estado,
  };
}

function configFromRows(configRow, tarifaRows) {
  const rates = {};
  for (const t of tarifaRows) {
    if (!rates[t.tipo_id]) rates[t.tipo_id] = {};
    rates[t.tipo_id][t.concepto] = Number(t.monto);
  }
  return {
    totalEspacios: configRow.total_espacios,
    rates,
    umbrales: {
      mediaEstadiaHoras: configRow.umbral_media_estadia_horas,
      estadiaCompletaHoras: configRow.umbral_estadia_completa_horas,
    },
  };
}

async function getVehicleById(id) {
  const { data: visita, error: eV } = await supabase.from("visitas").select("*").eq("id", id).single();
  if (eV) throw eV;
  const [{ data: vehiculo, error: eA }, { data: egreso, error: eE }] = await Promise.all([
    supabase.from("vehiculos").select("*").eq("patente", visita.vehiculo_id).single(),
    supabase.from("egresos").select("*").eq("visita_id", id).maybeSingle(),
  ]);
  if (eA) throw eA;
  if (eE) throw eE;
  return flattenVehicle(visita, vehiculo, egreso);
}

export const storage = {
  async getVehicles() {
    const [{ data: visitas, error: eV }, { data: vehiculos, error: eA }, { data: egresos, error: eE }] =
      await Promise.all([
        supabase.from("visitas").select("*").order("created_at", { ascending: false }),
        supabase.from("vehiculos").select("*"),
        supabase.from("egresos").select("*"),
      ]);
    if (eV) throw eV;
    if (eA) throw eA;
    if (eE) throw eE;

    const vehiculoByPatente = new Map(vehiculos.map((v) => [v.patente, v]));
    const egresoByVisitaId = new Map(egresos.map((e) => [e.visita_id, e]));

    return visitas.map((visita) =>
      flattenVehicle(visita, vehiculoByPatente.get(visita.vehiculo_id), egresoByVisitaId.get(visita.id))
    );
  },

  async insertVehicle(vehicle) {
    const { error: upsertError } = await supabase
      .from("vehiculos")
      .upsert({ patente: vehicle.patente, tipo_id: vehicle.tipo }, { onConflict: "patente" });
    if (upsertError) throw upsertError;

    const { error } = await supabase.from("visitas").insert({
      id: vehicle.id,
      vehiculo_id: vehicle.patente,
      hora_ingreso: new Date(vehicle.horaIngreso).toISOString(),
      estado: "dentro",
    });
    if (error) {
      if (error.code === "23505") {
        const dupError = new Error(`${vehicle.patente} ya está registrado dentro`);
        dupError.code = "DUPLICATE_PATENTE";
        throw dupError;
      }
      throw error;
    }
    return vehicle;
  },

  async updateVehicle(id, patch) {
    const { error } = await supabase.rpc("cerrar_visita", {
      p_visita_id: id,
      p_hora_salida: new Date(patch.horaSalida).toISOString(),
      p_monto: patch.monto,
    });
    if (error) throw error;
  },

  async deleteAllVehicles() {
    const { error } = await supabase.from("visitas").delete().neq("id", "");
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
      total_espacios: config.totalEspacios,
      umbral_media_estadia_horas: config.umbrales.mediaEstadiaHoras,
      umbral_estadia_completa_horas: config.umbrales.estadiaCompletaHoras,
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

  subscribeToChanges({ onVehicleChange, onConfigChange }) {
    const refreshConfig = async () => {
      const config = await storage.getConfig();
      if (config) onConfigChange(config);
    };

    const channel = supabase
      .channel("parking-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "visitas" }, (payload) => {
        if (payload.eventType === "DELETE") {
          onVehicleChange({ eventType: "DELETE", vehicle: { id: payload.old.id } });
          return;
        }
        getVehicleById(payload.new.id).then((vehicle) =>
          onVehicleChange({ eventType: payload.eventType, vehicle })
        );
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "egresos" }, (payload) => {
        getVehicleById(payload.new.visita_id).then((vehicle) =>
          onVehicleChange({ eventType: "UPDATE", vehicle })
        );
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "config" }, () => {
        refreshConfig();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tarifas_por_tipo" }, () => {
        refreshConfig();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  },
};
