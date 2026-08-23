import { Car, Bike, Truck } from "lucide-react";

export const STORAGE_KEY = "estacionamiento-datos";

export const DEFAULT_CONFIG = {
  nombre: "Mi Estacionamiento",
  totalEspacios: 40,
  rates: {
    mediaHora: 1500,
    hora: 2500,
    mediaEstadia: 8000,
    estadiaCompleta: 14000,
    semanal: 70000,
    mensual: 220000,
  },
  umbrales: {
    mediaEstadiaHoras: 6,
    estadiaCompletaHoras: 24,
  },
};

export const DEFAULT_DATA = { config: DEFAULT_CONFIG, vehicles: [] };

export const TIPOS = [
  { id: "auto", label: "Auto", Icon: Car },
  { id: "moto", label: "Moto", Icon: Bike },
  { id: "camioneta", label: "Camioneta", Icon: Truck },
];
