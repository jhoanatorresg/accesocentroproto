"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, User, CreditCard, Phone, CheckCircle2, ChevronLeft, Loader2, Activity, Calendar } from "lucide-react";
import { io } from "socket.io-client";
import Link from "next/link";
import { API_URL } from "@/lib/config";

const DEVICE_ID = "esp32c6_centro_01";

export default function NuevoPersonal() {
  const router = useRouter();
  type Plan = { id: number; nombre: string };
  const [cedula,       setCedula]       = useState("");
  const [nombre,       setNombre]       = useState("");
  const [telefono,     setTelefono]     = useState("");
  const [fechaRegistro, setFechaRegistro] = useState(new Date().toISOString().split('T')[0]);
  const [planId,       setPlanId]       = useState("3");
  const [plans,        setPlans]        = useState<Plan[]>([]);

  const [huellaId,      setHuellaId]      = useState<number | null>(null);
  const [isSensorActive, setIsSensorActive] = useState(false);
  const [enrollStatus,  setEnrollStatus]  = useState("Inactivo");
  const [postura360,    setPostura360]    = useState<{ lectura: number; postura: string; mensaje: string } | null>(null);
  const [sensorOnline,  setSensorOnline]  = useState<boolean | null>(null);
  const [error,         setError]         = useState("");
  const [success,       setSuccess]       = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("adminToken")) { router.push("/settings"); return; }

    const socket = io(API_URL);

    socket.on("device_status", (data: any) => {
      if (data && data.sensor_conectado !== undefined) {
        setSensorOnline(data.sensor_conectado);
      }
    });

    socket.on("enroll_progress", (data: any) => {
      setIsSensorActive(true);
      if (data.postura || data.mensaje) {
        setPostura360({
          lectura: data.lectura || 1,
          postura: data.postura || 'centro',
          mensaje: data.mensaje || 'Alinea tu dedo sobre el sensor [SFM-V1.7]'
        });
        setEnrollStatus(data.mensaje);
      } else {
        if (data.lectura === 1) setEnrollStatus("Paso 1/2: Centra tu dedo en el sensor [SFM-V1.7] (Giro 360°)");
        if (data.lectura === 2) setEnrollStatus("Paso 2/2: Retira el dedo y vuelve a colocarlo para consolidar 360°");
      }
    });

    socket.on("enroll_result", (data) => {
      setIsSensorActive(false);
      setPostura360(null);
      if (data.resultado === "exito") {
        setHuellaId(data.huella_id);
        setEnrollStatus("Completado");
        setError("");
      } else {
        setEnrollStatus("Inactivo");
        const msgs: Record<string, string> = {
          sensor_desconectado: "❌ El sensor físico [SFM-V1.7] está DESCONECTADO o no responde en el hardware.",
          timeout:            "Tiempo de espera agotado. El sensor no detectó el dedo.",
          error_coincidencia: "Las dos lecturas 360° no coinciden. Intenta de nuevo.",
          error_guardado:     "Error interno guardando la huella en el sensor [SFM-V1.7].",
          memoria_llena:      "La memoria del sensor está llena.",
        };
        setError(msgs[data.resultado] || "Error desconocido en el sensor biométrico [SFM-V1.7].");
      }
    });

    return () => { socket.disconnect(); };
  }, [router]);

  const capturarHuella = async () => {
    setError(""); setHuellaId(null); setIsSensorActive(true); setEnrollStatus("Obteniendo ID disponible...");
    try {
      const idRes  = await fetch(`${API_URL}/api/next-huella-id`);
      const idData = await idRes.json();
      const nextId = idData.huella_id;
      if (!nextId) throw new Error("No se pudo obtener un ID de huella válido.");

      setEnrollStatus("Despertando sensor...");
      const res  = await fetch(`${API_URL}/api/devices/${DEVICE_ID}/enroll`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ huella_id: nextId }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "No se pudo activar el sensor");
        setIsSensorActive(false); setEnrollStatus("Inactivo");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error conectando con el servidor";
      setError(msg); setIsSensorActive(false); setEnrollStatus("Inactivo");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (huellaId === null) { setError("Debes capturar la huella antes de guardar."); return; }
    try {
      const res  = await fetch(`${API_URL}/api/users`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cedula, nombre, telefono, huella_id: huellaId }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setTimeout(() => { localStorage.removeItem("adminToken"); router.push("/settings"); }, 2500);
      } else { setError(data.error || "Error al registrar personal"); }
    } catch { setError("Error conectando con el servidor"); }
  };

  return (
    <div className="min-h-screen bg-background p-6 md:p-12">
      <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-8">

        {/* Formulario */}
        <div className="flex-1 bg-card border border-border rounded-3xl p-8 shadow-xl">
          <div className="flex items-center gap-4 mb-8">
            <Link href="/settings" className="p-2 hover:bg-slate-800 rounded-full transition-colors">
              <ChevronLeft className="w-6 h-6 text-slate-400" />
            </Link>
            <div>
              <h1 className="text-3xl font-bold">Nuevo Personal</h1>
              <p className="text-muted-foreground mt-1 text-sm">Registra los datos corporativos y captura la huella</p>
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg mb-6 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-emerald-500/10 border border-emerald-500/50 text-emerald-400 px-4 py-4 rounded-xl mb-6 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6" />
              <div>
                <h4 className="font-medium">¡Personal registrado exitosamente!</h4>
                <p className="text-sm opacity-90">Redirigiendo...</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Cédula */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Cédula</label>
              <div className="relative">
                <CreditCard className="absolute left-3 top-3 h-5 w-5 text-slate-500" />
                <input type="text" value={cedula} onChange={e => setCedula(e.target.value)}
                  className="w-full pl-10 pr-3 py-3 border border-slate-700 bg-slate-950 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                  placeholder="1234567890" required />
              </div>
            </div>

            {/* Nombre */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Nombre Completo</label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-5 w-5 text-slate-500" />
                <input type="text" value={nombre} onChange={e => setNombre(e.target.value)}
                  className="w-full pl-10 pr-3 py-3 border border-slate-700 bg-slate-950 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                  placeholder="Juan Pérez" required />
              </div>
            </div>

            {/* Teléfono */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Teléfono (opcional)</label>
              <div className="relative">
                <Phone className="absolute left-3 top-3 h-5 w-5 text-slate-500" />
                <input type="tel" value={telefono} onChange={e => setTelefono(e.target.value)}
                  className="w-full pl-10 pr-3 py-3 border border-slate-700 bg-slate-950 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                  placeholder="3001234567" />
              </div>
            </div>

            {/* Fecha de Ingreso */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Fecha de Ingreso</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-3 h-5 w-5 text-slate-500 pointer-events-none" />
                <input type="date" value={fechaRegistro} onChange={e => setFechaRegistro(e.target.value)}
                  className="w-full pl-10 pr-3 py-3 border border-slate-700 bg-slate-950 rounded-xl text-white focus:ring-2 focus:ring-blue-500 transition-all outline-none [color-scheme:dark]" />
              </div>
            </div>

            {/* Política de Permanencia (Sin Planes de Acceso) */}
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Acceso Permanente</p>
                <p className="text-xs text-slate-400 mt-0.5">El usuario permanecerá activo en la base de datos hasta que sea eliminado manualmente.</p>
              </div>
            </div>

            <button
              type="submit"
              disabled={huellaId === null || isSensorActive || success}
              className={`w-full py-4 rounded-xl font-semibold transition-all ${
                huellaId !== null
                  ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
            >
              Guardar Registro
            </button>
          </form>
        </div>

        {/* Panel sensor de huella */}
        <div className="w-full md:w-80 flex flex-col gap-6">
          <div className="bg-card border border-border rounded-3xl p-8 flex flex-col items-center justify-center min-h-[340px] relative overflow-hidden shadow-xl">

            {isSensorActive && <div className="absolute inset-0 bg-cyan-500/5 animate-pulse" />}

            {isSensorActive && (
              <div className="absolute inset-0 bg-card/95 backdrop-blur-sm z-20 flex flex-col items-center justify-center p-6 text-center">
                <div className="w-20 h-20 bg-cyan-500/20 rounded-full flex items-center justify-center mb-4 animate-pulse">
                  <Fingerprint className="w-10 h-10 text-cyan-400" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400 mb-1">Captura 360° [SFM-V1.7]</span>
                <h3 className="text-xl font-bold mb-2">Toma Biométrico</h3>
                <p className="text-sm text-cyan-300 font-medium">{enrollStatus}</p>
                {postura360 && (
                  <span className="mt-3 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-black uppercase tracking-wider">
                    Posición: {postura360.postura} (Verificación {postura360.lectura}/2)
                  </span>
                )}
              </div>
            )}

            <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 transition-all duration-500 z-10 ${
              huellaId !== null ? "bg-emerald-500/20 text-emerald-400"
              : isSensorActive  ? "bg-cyan-500/20 text-cyan-400 animate-pulse"
              : "bg-slate-800 text-slate-500"
            }`}>
              {huellaId !== null ? <Fingerprint className="w-12 h-12" />
               : isSensorActive  ? <Activity className="w-12 h-12 animate-bounce" />
               : <Fingerprint className="w-12 h-12" />}
            </div>

            <h3 className="text-lg font-bold text-white mb-1 z-10">Sensor [SFM-V1.7]</h3>
            {sensorOnline !== null && (
              <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-3 z-10 ${
                sensorOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
              }`}>
                {sensorOnline ? 'Sensor Conectado' : 'Sensor Desconectado'}
              </span>
            )}

            <div className="text-center mb-6 z-10 min-h-[50px]">
              {huellaId !== null ? (
                <p className="text-emerald-400 font-medium text-sm">¡Huella ID #{huellaId} capturada 360°!</p>
              ) : isSensorActive ? (
                <p className="text-cyan-400 font-medium text-sm">{enrollStatus}</p>
              ) : (
                <p className="text-slate-400 text-xs">2 verificaciones 360°<br />(Centro, Derecho, Izquierdo)</p>
              )}
            </div>

            <button
              onClick={capturarHuella}
              disabled={isSensorActive || huellaId !== null}
              className={`w-full py-3 rounded-xl font-medium border transition-all z-10 flex items-center justify-center gap-2 ${
                isSensorActive  ? "bg-transparent border-primary/50 text-primary cursor-wait"
                : huellaId !== null ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400"
                : "bg-muted border-border text-foreground hover:bg-muted/80"
              }`}
            >
              {isSensorActive ? <><Loader2 className="w-4 h-4 animate-spin" /> Activando...</>
               : huellaId !== null ? "Huella Registrada"
               : "Capturar Huella"}
            </button>

            {huellaId !== null && (
              <button
                onClick={() => { setHuellaId(null); capturarHuella(); }}
                className="mt-4 text-sm text-slate-500 hover:text-white transition-colors underline z-10"
              >
                Volver a capturar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
