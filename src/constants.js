import { Car, Bike, Truck } from "lucide-react";

export const DEFAULT_CONFIG = {
  nombre: "Mi Estacionamiento",
  totalEspacios: 40,
  rates: {
    auto: {
      mediaHora: 1500,
      hora: 2500,
      mediaEstadia: 8000,
      estadiaCompleta: 14000,
      semanal: 70000,
      mensual: 220000,
    },
    moto: {
      mediaHora: 800,
      hora: 1300,
      mediaEstadia: 4500,
      estadiaCompleta: 8000,
      semanal: 40000,
      mensual: 130000,
    },
    camioneta: {
      mediaHora: 2000,
      hora: 3200,
      mediaEstadia: 10500,
      estadiaCompleta: 18000,
      semanal: 90000,
      mensual: 280000,
    },
  },
  umbrales: {
    mediaEstadiaHoras: 6,
    estadiaCompletaHoras: 24,
    toleranciaMin: 15,
  },
};

export const TIPOS = [
  { id: "auto", label: "Auto", Icon: Car },
  { id: "moto", label: "Moto", Icon: Bike },
  { id: "camioneta", label: "Camioneta", Icon: Truck },
];
