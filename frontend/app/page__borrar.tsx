"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  UserPlus, Fingerprint, Activity, Terminal, ShieldAlert, CheckCircle2,
  Loader2, Settings, Shield, Cpu, RefreshCw, Trash2, Download,
  Calendar, AlertTriangle, Save, Search, X, User, Phone, CreditCard,
  Clock, Wifi, WifiOff, ChevronRight
} from "lucide-react";
import { io } from "socket.io-client";
import { API_URL } from "@/lib/config";

const DEVICE_ID = "esp32c6_centro_01";

type Plan = { id: number; nombre: string };
type Postura = "centro" | "derecho" | "izquierdo";

type EnrollProgress = {
  paso: number;
  verificacion: number;
  postura: Postura | null;
  mensaje: string;
};

type Usuario = {
  id: number;
  nombre: string;
  cedula: string;
  telefono?: string | null;
  huella_id: number;
  estado?: string;
  rol?: string;
  fecha_registro?: string;
  accesos?: Acceso[];
  total_accesos?: number;
};

type Acceso = {
  id: number;
  timestamp: string;
  resultado: string;
  confianza: number;
  dispositivo_id: string;
  dispositivo?: {
    id: string;
    nombre?: string;
    estado?: string;
    ultimo_ping?: string;
  };
};

const PASOS: { paso: number; verificacion: number; postura: Postura; titulo: string; texto: string }[] = [
  { paso: 1, verificacion: 1, postura: "centro", titulo: "Centro", texto: "Coloca el centro de tu dedo sobre el sensor." },
  { paso: 2, verificacion: 1, postura: "derecho", titulo: "Lado derecho", texto: "Inclina ligeramente el dedo hacia el lado derecho." },
  { paso: 3, verificacion: 1, postura: "izquierdo", titulo: "Lado izquierdo", texto: "Inclina ligeramente el dedo hacia el lado izquierdo." },
  { paso: 4, verificacion: 2, postura: "centro", titulo: "Centro — segunda verificación", texto: "Retira el dedo y vuelve a colocarlo centrado." },
  { paso: 5, verificacion: 2, postura: "derecho", titulo: "Lado derecho — segunda verificación", texto: "Inclina ligeramente el dedo hacia el lado derecho." },
  { paso: 6, verificacion: 2, postura: "izquierdo", titulo: "Lado izquierdo — segunda verificación", texto: "Inclina ligeramente el dedo hacia el lado izquierdo." },
];

function authHeaders(json = false): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function apiFetch(path: string, options: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(options.body !== undefined),
      ...(options.headers || {}),
    },
  });
}

export default function AdminPage() {
  const [formData, setFormData] = useState({
    nombre: "",
    cedula: "",
    telefono: "",
    huella_id: "",
    fecha_registro: new Date().toISOString().split("T")[0],
    plan_id: "3",
  });

  const [plans, setPlans] = useState<Plan[]>([
    { id: 1, nombre: "Semanal" },
    { id: 2, nombre: "Quincenal" },
    { id: 3, nombre: "Mensual" },
  ]);

  const [status, setStatus] = useState<{ type: "idle" | "loading" | "success" | "error"; message: string }>({
    type: "idle",
    message: "",
  });

  const [huellaCapturada, setHuellaCapturada] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState("");
  const [enrollProgress, setEnrollProgress] = useState<EnrollProgress>({
    paso: 0, verificacion: 0, postura: null, mensaje: "",
  });
  const [hardwareOnline, setHardwareOnline] = useState(false);

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<Usuario | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter(u =>
      [u.nombre, u.cedula, u.telefono || "", String(u.huella_id)]
        .some(v => v.toLowerCase().includes(q))
    );
  }, [usuarios, search]);

  const fetchNextId = async () => {
    try {
      const res = await apiFetch("/api/next-huella-id");
      if (!res.ok) throw new Error("No se pudo obtener el ID de huella.");
      const data = await res.json();
      setFormData(f => ({ ...f, huella_id: String(data.huella_id) }));
    } catch (e: any) {
      setEnrollError(e.message || "No se pudo obtener el siguiente ID.");
    }
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await apiFetch("/api/users");
      if (!res.ok) throw new Error("No se pudieron cargar los usuarios.");
      const data = await res.json();
      setUsuarios(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadDetails = async (id: number) => {
    setLoadingDetails(true);
    try {
      const res = await apiFetch(`/api/users/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar los detalles.");
      setSelectedUser(data);
    } catch (e: any) {
      setStatus({ type: "error", message: e.message });
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    if (!localStorage.getItem("adminToken")) {
      window.location.href = "/settings";
      return;
    }

    fetchNextId();
    loadUsers();

    apiFetch("/api/plans")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length) setPlans(data);
      })
      .catch(() => {});

    const socket = io(API_URL, { transports: ["websocket", "polling"] });

    socket.on("device_status", (data: any) => {
      if (data) {
        setHardwareOnline(
          data.sensor_conectado !== undefined
            ? Boolean(data.sensor_conectado)
            : Boolean(data.online)
        );
      }
    });

    socket.on("enroll_progress", (data: any) => {
      const paso = Number(data.paso || data.lectura || 0);
      setEnrolling(true);
      setEnrollError("");
      setEnrollProgress({
        paso,
        verificacion: Number(data.verificacion || (paso > 3 ? 2 : 1)),
        postura: data.postura || null,
        mensaje: data.mensaje || "Sigue las instrucciones del sensor.",
      });
    });

    socket.on("enroll_result", (data: any) => {
      if (data.resultado === "exito") {
        setHuellaCapturada(true);
        setEnrolling(false);
        setEnrollProgress({
          paso: 6, verificacion: 2, postura: "izquierdo",
          mensaje: "Huella 360 capturada correctamente: 2 verificaciones completas.",
        });
        setFormData(f => ({
          ...f,
          huella_id: String(data.huella_id ?? f.huella_id),
        }));
        setEnrollError("");
      } else {
        setEnrolling(false);
        const msgs: Record<string, string> = {
          timeout: "Tiempo de espera agotado. El sensor no detectó correctamente el dedo.",
          error_coincidencia: "Las lecturas no coinciden. Intenta nuevamente.",
          error_guardado: "El sensor no pudo guardar la huella.",
          memoria_llena: "La memoria del sensor está llena.",
          sensor_desconectado: "El sensor físico SFM-V1.7 no responde.",
          enrolamiento_ocupado: "Ya hay otro enrolamiento en curso.",
        };
        setEnrollError(msgs[data.resultado] || data.mensaje || "Error desconocido en el sensor.");
      }
    });

    return () => socket.disconnect();
  }, []);

  const capturarHuella = async () => {
    if (!formData.nombre.trim()) {
      setEnrollError("Primero ingresa el nombre del usuario.");
      return;
    }

    setEnrollError("");
    setHuellaCapturada(false);
    setEnrolling(true);
    setEnrollProgress({
      paso: 0, verificacion: 0, postura: null,
      mensaje: "Preparando enrolamiento 360...",
    });

    try {
      const idRes = await apiFetch("/api/next-huella-id");
      const idData = await idRes.json();
      if (!idRes.ok || !idData.huella_id) {
        throw new Error(idData.error || "No se pudo obtener un ID de huella.");
      }

      const nextId = Number(idData.huella_id);
      setFormData(f => ({ ...f, huella_id: String(nextId) }));

      const res = await apiFetch(`/api/devices/${DEVICE_ID}/enroll`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ huella_id: nextId }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "No se pudo iniciar el enrolamiento.");
      }
    } catch (e: any) {
      setEnrolling(false);
      setEnrollError(e.message || "Error conectando con el servidor.");
    }
  };

  const handleSave = async () => {
    if (!formData.nombre.trim() || !formData.cedula.trim() || !formData.huella_id || !huellaCapturada) {
      setStatus({
        type: "error",
        message: "Completa nombre, cédula y captura primero la huella 360.",
      });
      return;
    }

    setStatus({ type: "loading", message: "Guardando registro en la base de datos..." });

    try {
      const res = await apiFetch("/api/users", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          nombre: formData.nombre.trim(),
          cedula: formData.cedula.trim(),
          telefono: formData.telefono.trim(),
          huella_id: Number(formData.huella_id),
          fecha_registro: formData.fecha_registro,
          plan_id: Number(formData.plan_id),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al guardar datos del usuario.");

      setStatus({ type: "success", message: "¡Usuario registrado exitosamente!" });
      await loadUsers();
      resetForm();
    } catch (e: any) {
      setStatus({ type: "error", message: e.message || "No se pudo guardar el usuario." });
    }
  };

  const resetForm = () => {
    setFormData({
      nombre: "", cedula: "", telefono: "",
      huella_id: "", fecha_registro: new Date().toISOString().split("T")[0],
      plan_id: "3",
    });
    setHuellaCapturada(false);
    setEnrolling(false);
    setEnrollError("");
    setEnrollProgress({ paso: 0, verificacion: 0, postura: null, mensaje: "" });
    setStatus({ type: "idle", message: "" });
    fetchNextId();
  };

  const canSave = Boolean(huellaCapturada && formData.nombre && formData.cedula);

  return (
    <div className="space-y-10 animate-slide-up">
      <div>
        <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-[0.2em] mb-2">
          <Settings size={14} className="fill-cyan-400" />
          System Administration
        </div>
        <h2 className="text-4xl font-black text-white tracking-tight">Administración Central</h2>
        <p className="text-slate-400 mt-2 font-medium">
          Registro permanente de personal y control biométrico SFM-V1.7
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-10">
        <div className="xl:col-span-3 space-y-8">
          <section className="relative p-1 rounded-[3rem] overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 via-transparent to-indigo-500/20" />
            <div className="relative bg-[#0d121b] border border-white/5 p-10 rounded-[2.9rem]">
              <div className="flex items-center gap-4 mb-10">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                  <UserPlus size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white">Nuevo Personal</h3>
                  <p className="text-xs text-slate-500 mt-1">El usuario permanece hasta eliminación manual.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Field label="Nombre Completo">
                  <input value={formData.nombre} onChange={e => setFormData({ ...formData, nombre: e.target.value })}
                    className={inputClass} placeholder="Ej: Juan Pérez" />
                </Field>

                <Field label="Cédula / ID">
                  <input value={formData.cedula} onChange={e => setFormData({ ...formData, cedula: e.target.value })}
                    className={inputClass} placeholder="12345678" />
                </Field>

                <Field label="Teléfono">
                  <input value={formData.telefono} onChange={e => setFormData({ ...formData, telefono: e.target.value })}
                    className={inputClass} placeholder="+57 300..." />
                </Field>

                <Field label="Fecha de Ingreso">
                  <div className="relative">
                    <input type="date" value={formData.fecha_registro}
                      onChange={e => setFormData({ ...formData, fecha_registro: e.target.value })}
                      className={`${inputClass} [color-scheme:dark]`} />
                    <Calendar className="absolute right-5 top-1/2 -translate-y-1/2 text-cyan-400/50 pointer-events-none" size={20} />
                  </div>
                </Field>

                <Field label="Plan de Acceso">
                  <select value={formData.plan_id}
                    onChange={e => setFormData({ ...formData, plan_id: e.target.value })}
                    className={`${inputClass} appearance-none cursor-pointer`}>
                    {plans.map(p => <option key={p.id} value={p.id} className="bg-[#0d121b]">{p.nombre}</option>)}
                  </select>
                </Field>

                <Field label="ID Huella Automático">
                  <div className="relative">
                    <input type="number" value={formData.huella_id} readOnly className={`${inputClass} text-cyan-400 font-black bg-cyan-500/5`} />
                    <Fingerprint className="absolute right-5 top-1/2 -translate-y-1/2 text-cyan-400/50" size={20} />
                  </div>
                </Field>
              </div>

              <div className="mt-8 p-6 bg-white/5 rounded-3xl border border-white/5">
                <div className="flex items-center justify-between mb-5">
                  <h4 className="text-white font-black flex items-center gap-2">
                    <Fingerprint size={18} className="text-cyan-400" />
                    Captura Biométrica 360°
                  </h4>
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                    <span className={`w-2 h-2 rounded-full ${hardwareOnline ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`} />
                    <span className={hardwareOnline ? "text-emerald-400" : "text-rose-500"}>
                      {hardwareOnline ? "Sensor conectado" : "Sensor desconectado"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-6 gap-2 mb-6">
                  {PASOS.map(p => (
                    <div key={p.paso} className="text-center">
                      <div className={`h-2 rounded-full transition-all ${
                        enrollProgress.paso >= p.paso
                          ? "bg-cyan-400"
                          : enrollProgress.paso === p.paso - 1
                            ? "bg-cyan-400/30"
                            : "bg-slate-800"
                      }`} />
                      <span className="text-[9px] text-slate-600 mt-1 block">{p.paso}</span>
                    </div>
                  ))}
                </div>

                {enrolling && (
                  <div className="p-6 rounded-2xl bg-cyan-500/5 border border-cyan-500/20 mb-4">
                    <div className="flex items-center gap-3 mb-3">
                      <Loader2 size={20} className="animate-spin text-cyan-400" />
                      <span className="text-cyan-400 text-xs font-black uppercase tracking-widest">
                        {enrollProgress.verificacion
                          ? `Verificación ${enrollProgress.verificacion}/2 · Paso ${enrollProgress.paso}/6`
                          : "Preparando"}
                      </span>
                    </div>

                    {enrollProgress.paso > 0 && PASOS[enrollProgress.paso - 1] && (
                      <>
                        <h3 className="text-2xl text-white font-black">
                          {PASOS[enrollProgress.paso - 1].titulo}
                        </h3>
                        <p className="text-slate-400 mt-2 text-sm">
                          {enrollProgress.mensaje || PASOS[enrollProgress.paso - 1].texto}
                        </p>
                      </>
                    )}
                  </div>
                )}

                {!enrolling && huellaCapturada && (
                  <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-3">
                    <CheckCircle2 />
                    <div>
                      <p className="font-black">Huella 360 capturada</p>
                      <p className="text-xs opacity-70">2 verificaciones × 3 posiciones completadas.</p>
                    </div>
                  </div>
                )}

                {enrollError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-3 rounded-xl mb-4 text-sm font-medium flex gap-2">
                    <ShieldAlert size={18} className="shrink-0" />
                    {enrollError}
                  </div>
                )}

                <button onClick={capturarHuella} disabled={enrolling || huellaCapturada}
                  className={`w-full py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-3 transition-all ${
                    huellaCapturada
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : enrolling
                        ? "bg-blue-500/20 text-blue-400 cursor-wait"
                        : "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20"
                  }`}>
                  {huellaCapturada
                    ? <><CheckCircle2 size={18} /> Huella 360 Capturada</>
                    : enrolling
                      ? <><Loader2 size={18} className="animate-spin" /> Capturando 360...</>
                      : <><Fingerprint size={18} /> Capturar Huella 360</>}
                </button>

                {huellaCapturada && (
                  <button onClick={() => {
                    setHuellaCapturada(false);
                    setEnrollProgress({ paso: 0, verificacion: 0, postura: null, mensaje: "" });
                    setEnrollError("");
                  }} className="mt-3 text-xs text-slate-500 hover:text-white underline">
                    Volver a capturar
                  </button>
                )}
              </div>

              <button onClick={handleSave} disabled={!canSave}
                className={`w-full mt-6 py-5 rounded-[1.8rem] font-black text-white shadow-xl flex items-center justify-center gap-4 transition-all ${
                  canSave ? "bg-gradient-to-r from-cyan-500 to-blue-600 hover:scale-[1.01]" : "bg-slate-800 text-slate-500 cursor-not-allowed"
                }`}>
                {status.type === "loading" ? <Loader2 className="animate-spin" /> : <Save size={22} />}
                {status.type === "loading" ? "Guardando..." : "Guardar Registro"}
              </button>

              {status.message && (
                <div className={`mt-6 p-5 rounded-2xl border flex items-start gap-3 ${
                  status.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    : status.type === "error"
                      ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                      : "bg-blue-500/10 border-blue-500/20 text-blue-400"
                }`}>
                  {status.type === "success" ? <CheckCircle2 /> : status.type === "error" ? <ShieldAlert /> : <Activity className="animate-pulse" />}
                  <div>
                    <p className="font-black text-xs uppercase tracking-widest">{status.type}</p>
                    <p className="text-sm mt-1">{status.message}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="xl:col-span-2 space-y-8">
          <section className="bg-[#0d121b] border border-white/5 rounded-[3rem] p-10 relative overflow-hidden">
            <Terminal className="absolute -right-4 -bottom-4 text-white/5" size={150} />
            <h3 className="text-white font-black mb-8 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full ${hardwareOnline ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`} />
              Terminal Status
            </h3>
            <div className="space-y-7">
              <StatusRow label="Protocolo MQTT" sub="HiveMQ Secure Tunnel" icon={<Shield className="text-cyan-400" size={24} />} />
              <StatusRow label="Database Engine" sub="SQLite / PostgreSQL / Supabase" icon={<Cpu className="text-indigo-400" size={24} />} />
              <StatusRow label="API Status" sub="Node.js Express" icon={<RefreshCw className="text-emerald-400" size={24} />} />
              <StatusRow
                label="SFM-V1.7"
                sub={hardwareOnline ? "Sensor físico conectado" : "Sensor físico desconectado"}
                icon={hardwareOnline ? <Wifi className="text-emerald-400" size={24} /> : <WifiOff className="text-rose-400" size={24} />}
              />
            </div>
          </section>

          <DataRetentionPanel />
        </div>
      </div>

      <section className="bg-[#0d121b] border border-white/5 rounded-[3rem] p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 mb-6">
          <div>
            <h3 className="text-white text-2xl font-black">Personal registrado</h3>
            <p className="text-slate-500 text-sm mt-1">Los registros de acceso se pueden depurar; los usuarios permanecen.</p>
          </div>
          <div className="flex gap-3">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={17} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar nombre, cédula o huella..."
                className="bg-white/5 border border-white/5 rounded-2xl py-3 pl-11 pr-4 text-sm text-white outline-none focus:border-cyan-500/30" />
            </div>
            <button onClick={loadUsers} className="p-3 rounded-2xl bg-white/5 text-slate-400 hover:text-white" title="Actualizar">
              <RefreshCw size={18} className={loadingUsers ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/5 text-[10px] uppercase tracking-widest text-slate-600">
                <th className="py-4 px-3">Usuario</th>
                <th className="py-4 px-3">Cédula</th>
                <th className="py-4 px-3">Huella</th>
                <th className="py-4 px-3">Estado</th>
                <th className="py-4 px-3 text-right">Detalles</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-4 px-3 text-white font-bold">{u.nombre}</td>
                  <td className="py-4 px-3 text-slate-400">{u.cedula}</td>
                  <td className="py-4 px-3 text-cyan-400 font-black">#{u.huella_id}</td>
                  <td className="py-4 px-3">
                    <span className={`text-[10px] font-black uppercase ${u.estado === "activo" ? "text-emerald-400" : "text-rose-400"}`}>
                      {u.estado || "sin estado"}
                    </span>
                  </td>
                  <td className="py-4 px-3 text-right">
                    <button onClick={() => loadDetails(u.id)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 text-xs font-black">
                      Ver detalles <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredUsers.length && (
                <tr><td colSpan={5} className="py-10 text-center text-slate-600">{loadingUsers ? "Cargando..." : "No hay usuarios."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedUser(null)}>
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-[#0d121b] border border-white/10 rounded-[2rem] p-7" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-4 mb-7">
              <div>
                <p className="text-cyan-400 text-[10px] font-black uppercase tracking-[0.2em]">Detalle completo</p>
                <h3 className="text-3xl text-white font-black mt-1">{selectedUser.nombre}</h3>
              </div>
              <button onClick={() => setSelectedUser(null)} className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white"><X /></button>
            </div>

            {loadingDetails ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-cyan-400" /></div> : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <InfoCard icon={<User size={18} />} label="Nombre" value={selectedUser.nombre} />
                  <InfoCard icon={<CreditCard size={18} />} label="Cédula" value={selectedUser.cedula} />
                  <InfoCard icon={<Phone size={18} />} label="Teléfono" value={selectedUser.telefono || "No registrado"} />
                  <InfoCard icon={<Fingerprint size={18} />} label="ID Huella" value={`#${selectedUser.huella_id}`} />
                  <InfoCard icon={<Activity size={18} />} label="Estado" value={selectedUser.estado || "No registrado"} />
                  <InfoCard icon={<Shield size={18} />} label="Rol" value={selectedUser.rol || "No registrado"} />
                  <InfoCard icon={<Calendar size={18} />} label="Registro" value={formatDate(selectedUser.fecha_registro)} />
                  <InfoCard icon={<Activity size={18} />} label="Total accesos" value={String(selectedUser.total_accesos ?? selectedUser.accesos?.length ?? 0)} />
                </div>

                <div className="mt-7">
                  <h4 className="text-white font-black text-lg mb-4">Historial completo de accesos</h4>
                  <div className="overflow-x-auto border border-white/5 rounded-2xl">
                    <table className="w-full text-left">
                      <thead className="bg-white/[0.02] text-[10px] uppercase tracking-widest text-slate-600">
                        <tr>
                          <th className="p-4">Fecha / hora</th>
                          <th className="p-4">Resultado</th>
                          <th className="p-4">Confianza</th>
                          <th className="p-4">Dispositivo</th>
                          <th className="p-4">Estado sensor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedUser.accesos || []).map(a => (
                          <tr key={a.id} className="border-t border-white/5">
                            <td className="p-4 text-slate-400 text-sm">{formatDate(a.timestamp)}</td>
                            <td className="p-4">
                              <span className={a.resultado === "permitido" ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                                {a.resultado}
                              </span>
                            </td>
                            <td className="p-4 text-cyan-400 font-bold">{a.confianza}</td>
                            <td className="p-4 text-slate-400">{a.dispositivo?.nombre || a.dispositivo_id}</td>
                            <td className="p-4 text-slate-500">{a.dispositivo?.estado || "—"}</td>
                          </tr>
                        ))}
                        {!selectedUser.accesos?.length && (
                          <tr><td colSpan={5} className="p-8 text-center text-slate-600">Este usuario no tiene accesos registrados.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const inputClass =
  "w-full bg-white/5 border border-white/5 rounded-2xl py-4 px-6 text-white outline-none focus:border-cyan-500/30 transition-all font-medium";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">{label}</label>
      {children}
    </div>
  );
}

function StatusRow({ label, sub, icon }: { label: string; sub: string; icon: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-white text-sm font-bold">{label}</p>
        <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">{sub}</p>
      </div>
      {icon}
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5">
      <div className="flex items-center gap-2 text-cyan-400 mb-2">{icon}<span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span></div>
      <p className="text-white font-bold break-words">{value}</p>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "No registrado";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("es-CO");
}

function DataRetentionPanel() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [action, setAction] = useState<"idle" | "exporting" | "deleting" | "done">("idle");
  const [retentionType, setRetentionType] = useState<"15d" | "monthly">("15d");

  const oldest = useMemo(() => {
    const now = new Date();
    if (retentionType === "15d") now.setDate(now.getDate() - 15);
    else now.setMonth(now.getMonth() - 1);
    return now;
  }, [retentionType]);

  const handleExportAndCleanup = async (choice: "local" | "drive") => {
    setAction("exporting");
    try {
      const res = await apiFetch(`/api/accesses/export?before=${encodeURIComponent(oldest.toISOString())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo exportar.");

      if (data.accesses?.length) {
        const csv = dataToCSV(data.accesses);
        if (choice === "local") {
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `accesos_${retentionType}_${new Date().toISOString().split("T")[0]}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        } else {
          const linkRes = await apiFetch("/api/accesses/upload-drive", {
            method: "POST",
            headers: authHeaders(true),
            body: JSON.stringify({
              csv,
              filename: `accesos_${retentionType}_${new Date().toISOString().split("T")[0]}.csv`,
            }),
          });
          const linkData = await linkRes.json();
          if (linkData.url) window.open(linkData.url, "_blank");
        }
      }

      const cleanupRes = await apiFetch("/api/accesses/cleanup", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ before: oldest.toISOString() }),
      });
      if (!cleanupRes.ok) {
        const err = await cleanupRes.json();
        throw new Error(err.error || "No se pudo limpiar.");
      }

      setAction("done");
      setTimeout(() => { setShowConfirm(false); setAction("idle"); }, 1600);
    } catch (e) {
      console.error(e);
      setAction("idle");
    }
  };

  const handleDeleteWithoutBackup = async () => {
    setAction("deleting");
    try {
      const res = await apiFetch("/api/accesses/cleanup", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ before: oldest.toISOString() }),
      });
      if (!res.ok) throw new Error("No se pudo limpiar.");
      setAction("done");
      setTimeout(() => { setShowConfirm(false); setAction("idle"); }, 1600);
    } catch (e) {
      console.error(e);
      setAction("idle");
    }
  };

  return (
    <div className="bg-[#0d121b] border border-white/5 rounded-[3rem] p-10 relative overflow-hidden">
      <Calendar className="absolute -right-4 -bottom-4 text-white/5" size={150} />
      <h3 className="text-white font-black mb-2 flex items-center gap-3">
        <Download size={18} className="text-indigo-400" />
        Retención de accesos
      </h3>
      <p className="text-slate-500 text-xs font-medium mb-6">
        Esta limpieza afecta únicamente a los registros de acceso, no a los usuarios.
      </p>

      <div className="flex gap-3 mb-6">
        <button onClick={() => setRetentionType("15d")}
          className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest ${retentionType === "15d" ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-white/5 text-slate-500 border border-white/5"}`}>
          15 días
        </button>
        <button onClick={() => setRetentionType("monthly")}
          className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest ${retentionType === "monthly" ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-white/5 text-slate-500 border border-white/5"}`}>
          Mensual
        </button>
      </div>

      {!showConfirm ? (
        <button onClick={() => setShowConfirm(true)}
          className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl font-black text-white text-sm flex items-center justify-center gap-3">
          <Trash2 size={16} /> Limpiar accesos antiguos
        </button>
      ) : (
        <div className="space-y-3">
          <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-4 py-3 rounded-xl text-xs font-medium flex gap-2">
            <AlertTriangle size={16} />
            Se eliminarán únicamente accesos anteriores al período seleccionado.
          </div>

          {action === "done" ? (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-4 rounded-xl text-sm font-bold flex items-center gap-3">
              <CheckCircle2 size={18} /> Listo
            </div>
          ) : action === "exporting" || action === "deleting" ? (
            <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-4 py-4 rounded-xl text-sm font-bold flex items-center gap-3">
              <Loader2 size={18} className="animate-spin" /> Procesando...
            </div>
          ) : (
            <div className="flex gap-3">
              <button onClick={() => handleExportAndCleanup("local")} className="flex-1 py-3 bg-cyan-500/20 text-cyan-400 rounded-2xl text-xs font-black">Descargar</button>
              <button onClick={() => handleExportAndCleanup("drive")} className="flex-1 py-3 bg-blue-500/20 text-blue-400 rounded-2xl text-xs font-black">Guardar copia</button>
              <button onClick={handleDeleteWithoutBackup} className="flex-1 py-3 bg-rose-500/20 text-rose-400 rounded-2xl text-xs font-black">Borrar</button>
            </div>
          )}

          <button onClick={() => { setShowConfirm(false); setAction("idle"); }} className="w-full text-xs text-slate-500 hover:text-white underline">
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

function dataToCSV(accesses: any[]) {
  const headers = ["ID", "Miembro", "Cédula", "Resultado", "Confianza", "Dispositivo", "Fecha"];
  const rows = accesses.map(a => [
    a.id,
    a.usuario?.nombre || "Desconocido",
    a.usuario?.cedula || "",
    a.resultado,
    a.confianza,
    a.dispositivo_id,
    new Date(a.timestamp).toLocaleString("es-CO"),
  ]);
  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}
