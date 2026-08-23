/**
 * Capa de almacenamiento sobre Supabase (tabla kv_store).
 * Mantiene la misma interfaz que la versión local para no tocar App.jsx:
 * get(key) / set(key, value) / delete(key), todas async.
 */
import { supabase } from "./supabaseClient";

export const storage = {
  async get(key) {
    const { data, error } = await supabase
      .from("kv_store")
      .select("key, value")
      .eq("key", key)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error(`Storage key not found: ${key}`);
    }
    return { key: data.key, value: data.value, shared: true };
  },

  async set(key, value) {
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key, value, updated_at: new Date().toISOString() });

    if (error) throw error;
    return { key, value, shared: true };
  },

  async delete(key) {
    const { error } = await supabase.from("kv_store").delete().eq("key", key);
    if (error) throw error;
    return { key, deleted: true, shared: true };
  },
};
