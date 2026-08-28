/**
 * Capa de almacenamiento sobre Supabase (tablas vehicles + config).
 * Traduce entre las filas de Postgres (snake_case, timestamptz) y los
 * objetos que usa la UI (camelCase, timestamps numéricos en ms).
 */
import { supabase } from "./supabaseClient";

function vehicleFromRow(row) {
  return {
    id: row.id,
    patente: row.patente,
    tipo: row.tipo,
    horaIngreso: new Date(row.hora_ingreso).getTime(),
    horaSalida: row.hora_salida ? new Date(row.hora_salida).getTime() : null,
    monto: row.monto === null ? null : Number(row.monto),
    estado: row.estado,
  };
}

function vehicleToRow(vehicle) {
  return {
    id: vehicle.id,
    patente: vehicle.patente,
    tipo: vehicle.tipo,
    hora_ingreso: new Date(vehicle.horaIngreso).toISOString(),
    hora_salida: vehicle.horaSalida ? new Date(vehicle.horaSalida).toISOString() : null,
    monto: vehicle.monto,
    estado: vehicle.estado,
  };
}

function vehiclePatchToRow(patch) {
  const row = {};
  if ("horaSalida" in patch) {
    row.hora_salida = patch.horaSalida ? new Date(patch.horaSalida).toISOString() : null;
  }
  if ("monto" in patch) row.monto = patch.monto;
  if ("estado" in patch) row.estado = patch.estado;
  return row;
}

function configFromRow(row) {
  return { totalEspacios: row.total_espacios, rates: row.rates, umbrales: row.umbrales };
}

function configToRow(config) {
  return { id: 1, total_espacios: config.totalEspacios, rates: config.rates, umbrales: config.umbrales };
}

export const storage = {
  async getVehicles() {
    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data.map(vehicleFromRow);
  },

  async insertVehicle(vehicle) {
    const { error } = await supabase.from("vehicles").insert(vehicleToRow(vehicle));
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
    const { error } = await supabase.from("vehicles").update(vehiclePatchToRow(patch)).eq("id", id);
    if (error) throw error;
  },

  async deleteAllVehicles() {
    const { error } = await supabase.from("vehicles").delete().neq("id", "");
    if (error) throw error;
  },

  async getConfig() {
    const { data, error } = await supabase.from("config").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    return data ? configFromRow(data) : null;
  },

  async setConfig(config) {
    const { error } = await supabase.from("config").upsert(configToRow(config));
    if (error) throw error;
  },

  subscribeToChanges({ onVehicleChange, onConfigChange }) {
    const channel = supabase
      .channel("parking-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, (payload) => {
        if (payload.eventType === "DELETE") {
          onVehicleChange({ eventType: "DELETE", vehicle: vehicleFromRow(payload.old) });
        } else {
          onVehicleChange({ eventType: payload.eventType, vehicle: vehicleFromRow(payload.new) });
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "config" }, (payload) => {
        if (payload.eventType !== "DELETE") {
          onConfigChange(configFromRow(payload.new));
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  },
};
