import { supabase } from "../supabaseClient";

export const ROLES = { ADMIN: "admin", USUARIO: "usuario" };

/** Tabs visibles según rol. El admin tiene acceso total. */
export const TABS_POR_ROL = {
  [ROLES.ADMIN]: ["entrada", "salida", "estado", "reportes", "config"],
  [ROLES.USUARIO]: ["entrada", "salida", "estado"],
};

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchAllProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function updateProfileRole(id, role) {
  const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
  if (error) throw error;
}
