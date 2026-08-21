/**
 * Capa de almacenamiento local.
 *
 * IMPORTANTE: esto guarda los datos en el localStorage del navegador,
 * es decir, SOLO en el dispositivo donde se usa. Si dos empleados abren
 * la app desde celulares distintos, cada uno va a ver su propia copia
 * de los datos — no están sincronizados entre sí.
 *
 * Para uso productivo con varios empleados/dispositivos, esta capa debería
 * reemplazarse por un backend real (Supabase, Firebase, API propia). La
 * interfaz (get/set/delete) está pensada para que ese cambio no requiera
 * tocar App.jsx: solo reimplementar estas tres funciones.
 */

export const storage = {
  async get(key) {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      throw new Error(`Storage key not found: ${key}`);
    }
    return { key, value: raw, shared: false };
  },

  async set(key, value) {
    window.localStorage.setItem(key, value);
    return { key, value, shared: false };
  },

  async delete(key) {
    window.localStorage.removeItem(key);
    return { key, deleted: true, shared: false };
  },
};
