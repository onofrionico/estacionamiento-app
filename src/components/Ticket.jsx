import React from "react";
import { TIPOS } from "../constants";
import { fmtMoney, fmtDur, fmtDateTime, tramoLabel } from "../lib/format";

export default function Ticket({ config, job }) {
  if (!job) return null;
  const { tipo, vehicle } = job;
  const tipoLabel = TIPOS.find((t) => t.id === vehicle.tipo)?.label || vehicle.tipo;
  const minutos = tipo === "egreso" ? (vehicle.horaSalida - vehicle.horaIngreso) / 60000 : null;

  return (
    <div style={{ fontFamily: "monospace", color: "#000", background: "#fff", width: "80mm", padding: "4mm", fontSize: "12px" }}>
      <div style={{ textAlign: "center", marginBottom: "2mm" }}>
        {config.logoUrl && (
          <img src={config.logoUrl} alt="" style={{ maxWidth: "40mm", maxHeight: "20mm", margin: "0 auto 2mm" }} />
        )}
        <p style={{ fontWeight: "bold", fontSize: "14px" }}>{config.nombre}</p>
        {config.direccion && <p>{config.direccion}</p>}
        {config.telefono && <p>{config.telefono}</p>}
      </div>

      <hr style={{ border: "none", borderTop: "1px dashed #000", margin: "2mm 0" }} />

      <p style={{ textAlign: "center", fontWeight: "bold" }}>
        {tipo === "ingreso" ? "INGRESO" : "COMPROBANTE DE SALIDA"}
      </p>
      <p>N&deg; Ticket: {vehicle.numeroTicket}</p>
      <p>Patente: {vehicle.patente}</p>
      <p>Tipo: {tipoLabel}</p>
      <p>Ingreso: {fmtDateTime(vehicle.horaIngreso)}</p>

      {tipo === "egreso" && (
        <>
          <p>Salida: {fmtDateTime(vehicle.horaSalida)}</p>
          <p>Duración: {fmtDur(minutos)}</p>
          <p>Tramo: {tramoLabel(minutos, config.umbrales)}</p>
          <hr style={{ border: "none", borderTop: "1px dashed #000", margin: "2mm 0" }} />
          <p style={{ fontWeight: "bold", fontSize: "14px", textAlign: "center" }}>Total: {fmtMoney(vehicle.monto)}</p>
        </>
      )}

      <hr style={{ border: "none", borderTop: "1px dashed #000", margin: "2mm 0" }} />
      <p style={{ textAlign: "center", fontSize: "10px" }}>Impreso: {fmtDateTime(Date.now())}</p>
    </div>
  );
}
