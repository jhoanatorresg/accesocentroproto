"use client";

import { useState, useEffect } from 'react';
import { ShieldCheck, UserPlus, Fingerprint, Activity, Terminal, ShieldAlert, CheckCircle2, Loader2, Zap, Settings, Shield, Cpu, RefreshCw, Trash2, Download, Calendar, AlertTriangle, Save } from 'lucide-react';
import { io } from "socket.io-client";
import { API_URL } from '@/lib/config';

const DEVICE_ID = "esp32c6_centro_01";

type EnrollStep = 'idle' | 'obtener_id' | 'despertar_sensor' | 'primera_lectura' | 'segunda_lectura' | 'completado' | 'error';

export default function AdminPage() {
  type Plan = { id: number; nombre: string };
  const [formData, setFormData] = useState({ nombre: '', cedula: '', telefono: '', huella_id: '', fecha_registro: new Date().toISOString().split('T')[0], plan_id: '3' });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error', message: string }>({ type: 'idle', message: '' });
  const [huellaCapturada, setHuellaCapturada] = useState(false);
  const [enrollStep, setEnrollStep] = useState<EnrollStep>('idle');
  const [enrollError, setEnrollError] = useState('');
  const [enrollMsg, setEnrollMsg] = useState('');

  useEffect(() => {
    fetch(`${API_URL}/api/plans`)
      .then(r => r.json())
      .then(data => setPlans(Array.isArray(data) ? data : []))
      .catch(() => setPlans([{ id: 1, nombre: 'Semanal' }, { id: 2, nombre: 'Quincenal' }, { id: 3, nombre: 'Mensual' }]));
  }, []);

  const resetForm = () => {
    setFormData({ nombre: '', cedula: '', telefono: '', huella_id: '', fecha_registro: new Date().toISOString().split('T')[0], plan_id: '3' });
    setHuellaCapturada(false);
    setEnrollStep('idle');
    setEnrollError('');
    setEnrollMsg('');
    fetchNextId();
  };

  const fetchNextId = () => {
    fetch(`${API_URL}/api/next-huella-id`)
      .then(r => r.json())
      .then(data => {
        setFormData(f => ({ ...f, huella_id: data.huella_id.toString() }));
      });
  };

  useEffect(() => { fetchNextId(); }, []);

  useEffect(() => {
    const socket = io(API_URL);
    socket.on("enroll_progress", (data: any) => {
      if (data.lectura === 1) {
        setEnrollStep('primera_lectura');
        setEnrollMsg("Primera lectura exitosa. Mantén el dedo firme...");
      }
      if (data.lectura === 2) {
        setEnrollStep('segunda_lectura');
        setEnrollMsg("Retira el dedo y vuelve a colocarlo para la segunda verificación.");
      }
    });
    socket.on("enroll_result", (data: any) => {
      if (data.resultado === "exito") {
        setEnrollStep('completado');
        setHuellaCapturada(true);
        setEnrollMsg("Huella capturada correctamente (2 verificaciones).");
        setFormData(f => ({ ...f, huella_id: data.huella_id?.toString() || f.huella_id }));
        setEnrollError('');
      } else {
        setEnrollStep('error');
        const msgs: Record<string, string> = {
          timeout: "Tiempo de espera agotado. El sensor no detectó el dedo.",
          error_coincidencia: "Las dos lecturas no coinciden. Intenta de nuevo.",
          error_guardado: "Error interno guardando la huella en el sensor.",
          memoria_llena: "La memoria del sensor está llena.",
        };
        setEnrollError(msgs[data.resultado] || "Error desconocido en el sensor biométrico.");
        setHuellaCapturada(false);
      }
    });
    return () => { socket.disconnect(); };
  }, []);

  const capturarHuella = async () => {
    if (!formData.nombre) {
      setEnrollError("Primero ingresa el nombre del usuario.");
      return;
    }
    setEnrollStep('obtener_id');
    setEnrollError('');
    setHuellaCapturada(false);
    setEnrollMsg("Obteniendo ID de huella disponible...");
    setStatus({ type: 'idle', message: '' });

    try {
      const idRes = await fetch(`${API_URL}/api/next-huella-id`);
      const idData = await idRes.json();
      const nextId = idData.huella_id;
      if (!nextId) throw new Error("No se pudo obtener un ID de huella.");

      setFormData(f => ({ ...f, huella_id: nextId.toString() }));
      setEnrollStep('despertar_sensor');
      setEnrollMsg("Despertando sensor biométrico...");

      const res = await fetch(`${API_URL}/api/devices/${DEVICE_ID}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ huella_id: nextId }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "No se pudo activar el sensor");
      }
      setEnrollMsg("Coloca el dedo en el sensor para la primera lectura...");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error conectando con el servidor";
      setEnrollError(msg);
      setEnrollStep('error');
    }
  };

  const handleSave = async () => {
    if (!formData.nombre || !formData.huella_id || !huellaCapturada) {
      setStatus({ type: 'error', message: 'Debes capturar la huella y completar todos los datos.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Guardando registro en la base de datos...' });

    try {
      const { fecha_registro, plan_id, ...rest } = formData;
      const memberRes = await fetch(`${API_URL}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rest, fecha_registro, plan_id: Number(plan_id) }),
      });

      if (!memberRes.ok) throw new Error('Error al guardar datos del usuario');

      setStatus({ type: 'success', message: '¡Usuario registrado exitosamente en la base de datos!' });
      resetForm();
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message });
    }
  };

  const canSave = huellaCapturada && formData.nombre && formData.cedula;

  return (
    <div className="space-y-10 animate-slide-up">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-[0.2em] mb-2">
            <Settings size={14} className="fill-cyan-400" />
            System Administration
          </div>
          <h2 className="text-4xl font-black text-white tracking-tight">Administración Central</h2>
          <p className="text-slate-400 mt-2 font-medium">Configura dispositivos y gestiona el registro maestro</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-10">
        <div className="xl:col-span-3 space-y-8">
          <div className="relative p-1 rounded-[3rem] overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 via-transparent to-indigo-500/20" />
            <div className="relative bg-[#0d121b] border border-white/5 p-10 rounded-[2.9rem]">
              <div className="flex items-center gap-4 mb-10">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                  <UserPlus size={24} />
                </div>
                <h3 className="text-2xl font-black text-white">Nuevo Personal</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">Nombre Completo</label>
                  <input
                    type="text" value={formData.nombre} onChange={e => setFormData({ ...formData, nombre: e.target.value })}
                    className="w-full bg-white/5 border border-white/5 rounded-2xl py-4 px-6 text-white outline-none focus:border-cyan-500/30 transition-all font-medium"
                    placeholder="Ej: Juan Pérez"
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">Cédula / ID</label>
                  <input
                    type="text" value={formData.cedula} onChange={e => setFormData({ ...formData, cedula: e.target.value })}
                    className="w-full bg-white/5 border border-white/5 rounded-2xl py-4 px-6 text-white outline-none focus:border-cyan-500/30 transition-all font-medium"
                    placeholder="12345678"
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">Teléfono</label>
                  <input
                    type="text" value={formData.telefono} onChange={e => setFormData({ ...formData, telefono: e.target.value })}
                    className="w-full bg-white/5 border border-white/5 rounded-2xl py-4 px-6 text-white outline-none focus:border-cyan-500/30 transition-all font-medium"
                    placeholder="+57 300..."
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">Fecha de Ingreso</label>
                  <div className="relative">
                    <input
                      type="date" value={formData.fecha_registro} onChange={e => setFormData({ ...formData, fecha_registro: e.target.value })}
                      className="w-full bg-white/5 border border-white/5 rounded-2xl py-4 px-6 text-white outline-none focus:border-cyan-500/30 transition-all font-medium [color-scheme:dark]"
                    />
                    <Calendar className="absolute right-5 top-1/2 -translate-y-1/2 text-cyan-400/50 pointer-events-none" size={20} />
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">Plan de Acceso</label>
                  <select
                    value={formData.plan_id} onChange={e => setFormData({ ...formData, plan_id: e.target.value })}
                    className="w-full bg-white/5 border border-white/5 rounded-2xl py-4 px-6 text-white outline-none focus:border-cyan-500/30 transition-all font-medium appearance-none cursor-pointer"
                  >
                    {plans.map(p => (
                      <option key={p.id} value={p.id} className="bg-[#0d121b]">{p.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">ID Huella (Automático)</label>
                  <div className="relative">
                    <input
                      type="number" value={formData.huella_id} readOnly
                      className="w-full bg-cyan-500/5 border border-cyan-500/10 rounded-2xl py-4 px-6 text-cyan-400 font-black outline-none"
                    />
                    <Fingerprint className="absolute right-5 top-1/2 -translate-y-1/2 text-cyan-400/50" size={20} />
                  </div>
                </div>
              </div>

              {/* Estado del enrolamiento */}
              <div className="mt-8 p-6 bg-white/5 rounded-3xl border border-white/5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-white font-black flex items-center gap-2">
                    <Fingerprint size={18} className="text-cyan-400" />
                    Captura Biométrica
                  </h4>
                  <div className="flex gap-2">
                    {[1, 2].map(step => (
                      <div key={step} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black ${
                        enrollStep === 'completado' ? 'bg-emerald-500/20 text-emerald-400' :
                        (enrollStep === 'primera_lectura' && step === 1) || (enrollStep === 'segunda_lectura' && step === 2) ? 'bg-cyan-500/20 text-cyan-400' :
                        'bg-slate-800 text-slate-500'
                      }`}>
                        {enrollStep === 'completado' && step <= 2 ? <CheckCircle2 size={14} /> : step}
                      </div>
                    ))}
                  </div>
                </div>

                {enrollMsg && (
                  <div className="text-sm text-slate-400 mb-4 font-medium">{enrollMsg}</div>
                )}

                {enrollError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-3 rounded-xl mb-4 text-sm font-medium">
                    {enrollError}
                  </div>
                )}

                <button
                  onClick={capturarHuella}
                  disabled={enrollStep === 'primera_lectura' || enrollStep === 'segunda_lectura' || enrollStep === 'despertar_sensor' || huellaCapturada}
                  className={`w-full py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-3 transition-all ${
                    huellaCapturada
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : enrollStep === 'primera_lectura' || enrollStep === 'segunda_lectura' || enrollStep === 'despertar_sensor'
                      ? 'bg-blue-500/20 text-blue-400 cursor-wait animate-pulse'
                      : 'bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20'
                  }`}
                >
                  {huellaCapturada ? (
                    <><CheckCircle2 size={18} /> Huella Capturada</>
                  ) : enrollStep === 'primera_lectura' || enrollStep === 'segunda_lectura' ? (
                    <><Loader2 size={18} className="animate-spin" /> Verificando... ({enrollStep === 'primera_lectura' ? '1/2' : '2/2'})</>
                  ) : enrollStep === 'despertar_sensor' ? (
                    <><Loader2 size={18} className="animate-spin" /> Despertando sensor...</>
                  ) : (
                    <><Fingerprint size={18} /> Capturar Huella (2 verificaciones)</>
                  )}
                </button>

                {huellaCapturada && (
                  <button
                    onClick={() => { setHuellaCapturada(false); setEnrollStep('idle'); setEnrollMsg(''); setEnrollError(''); }}
                    className="mt-3 text-xs text-slate-500 hover:text-white transition-colors underline"
                  >
                    Volver a capturar
                  </button>
                )}
              </div>

              {/* Botón Guardar */}
              <div className="mt-6">
                <button
                  onClick={handleSave}
                  disabled={!canSave}
                  className={`w-full py-5 rounded-[1.8rem] font-black text-white shadow-xl flex items-center justify-center gap-4 transition-all ${
                    canSave
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 shadow-cyan-500/20 hover:scale-[1.01]'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {status.type === 'loading' ? <Loader2 className="animate-spin" /> : <Save size={22} />}
                  {status.type === 'loading' ? 'Guardando...' : 'Guardar Registro'}
                </button>
                {!canSave && (
                  <p className="text-[10px] text-slate-500 text-center mt-3 font-bold uppercase tracking-widest">
                    {!formData.nombre ? 'Completa el nombre' : !formData.cedula ? 'Completa la cédula' : !huellaCapturada ? 'Captura la huella primero' : ''}
                  </p>
                )}
              </div>

              {status.message && (
                <div className={`mt-8 p-6 rounded-3xl border flex items-start gap-4 animate-in ${
                  status.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                  status.type === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
                  'bg-blue-500/10 border-blue-500/20 text-blue-400'
                }`}>
                  {status.type === 'success' ? <CheckCircle2 size={22} /> : status.type === 'error' ? <ShieldAlert size={22} /> : <Activity size={22} className="animate-pulse" />}
                  <div className="flex-1">
                    <p className="font-bold text-sm uppercase tracking-widest">{status.type === 'loading' ? 'Guardando' : status.type === 'success' ? 'Exito' : 'Aviso'}</p>
                    <p className="text-sm mt-1 font-medium opacity-80">{status.message}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 space-y-8">
          {/* Estado del Terminal */}
          <div className="bg-[#0d121b] border border-white/5 rounded-[3rem] p-10 relative overflow-hidden">
            <Terminal className="absolute -right-4 -bottom-4 text-white/5" size={150} />
            <h3 className="text-white font-black mb-8 flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              Terminal Status
            </h3>
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-bold">Protocolo MQTT</p>
                  <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">HiveMQ Secure Tunnel</p>
                </div>
                <Shield className="text-cyan-400" size={24} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-bold">Database Engine</p>
                  <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">SQLite Local Persistence</p>
                </div>
                <Cpu className="text-indigo-400" size={24} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-bold">API Status</p>
                  <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Node.js Express v18.0</p>
                </div>
                <RefreshCw className="text-emerald-400" size={24} />
              </div>
            </div>
          </div>

          {/* Data Retention Section */}
          <DataRetentionPanel />
        </div>
      </div>
    </div>
  );
}

function DataRetentionPanel() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [action, setAction] = useState<'idle' | 'exporting' | 'deleting' | 'done'>('idle');
  const [retentionType, setRetentionType] = useState<'15d' | 'monthly'>('15d');
  const [exportChoice, setExportChoice] = useState<'drive' | 'local' | null>(null);

  const getOldestDate = (): Date => {
    const now = new Date();
    if (retentionType === '15d') {
      now.setDate(now.getDate() - 15);
    } else {
      now.setMonth(now.getMonth() - 1);
    }
    return now;
  };

  const handleExportAndCleanup = async (choice: 'drive' | 'local') => {
    setExportChoice(choice);
    setAction('exporting');

    try {
      const oldest = getOldestDate();
      const res = await fetch(`${API_URL}/api/accesses/export?before=${oldest.toISOString()}`);
      const data = await res.json();

      if (data.accesses && data.accesses.length > 0) {
        const csv = dataToCSV(data.accesses);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

        if (choice === 'local') {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `accesos_${retentionType}_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        } else {
          const linkRes = await fetch(`${API_URL}/api/accesses/upload-drive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csv, filename: `accesos_${retentionType}_${new Date().toISOString().split('T')[0]}.csv` }),
          });
          const linkData = await linkRes.json();
          if (linkData.url) {
            window.open(linkData.url, '_blank');
          }
        }
      }

      await fetch(`${API_URL}/api/accesses/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ before: oldest.toISOString() }),
      });

      setAction('done');
      setTimeout(() => { setShowConfirm(false); setAction('idle'); setExportChoice(null); }, 2000);
    } catch (err) {
      console.error(err);
      setAction('idle');
    }
  };

  const handleDeleteWithoutBackup = async () => {
    setAction('deleting');
    try {
      const oldest = getOldestDate();
      await fetch(`${API_URL}/api/accesses/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ before: oldest.toISOString() }),
      });
      setAction('done');
      setTimeout(() => { setShowConfirm(false); setAction('idle'); }, 2000);
    } catch (err) {
      console.error(err);
      setAction('idle');
    }
  };

  return (
    <div className="bg-[#0d121b] border border-white/5 rounded-[3rem] p-10 relative overflow-hidden">
      <Calendar className="absolute -right-4 -bottom-4 text-white/5" size={150} />
      <h3 className="text-white font-black mb-2 flex items-center gap-3">
        <Download size={18} className="text-indigo-400" />
        Retención de Datos
      </h3>
      <p className="text-slate-500 text-xs font-medium mb-6">Limpieza automática de accesos antiguos</p>

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setRetentionType('15d')}
          className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
            retentionType === '15d' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-white/5 text-slate-500 border border-white/5'
          }`}
        >
          15 Días
        </button>
        <button
          onClick={() => setRetentionType('monthly')}
          className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
            retentionType === 'monthly' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-white/5 text-slate-500 border border-white/5'
          }`}
        >
          Mensual
        </button>
      </div>

      {!showConfirm ? (
        <button
          onClick={() => setShowConfirm(true)}
          className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl font-black text-white text-sm flex items-center justify-center gap-3 shadow-lg shadow-indigo-500/20 hover:scale-[1.01] transition-all"
        >
          <Trash2 size={16} />
          Limpiar Accesos Antiguos
        </button>
      ) : (
        <div className="space-y-3 animate-in">
          <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-4 py-3 rounded-xl text-xs font-medium flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>Hay registros de acceso anteriores al período seleccionado. ¿Deseas descargarlos antes de eliminar?</span>
          </div>

          {action === 'done' ? (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-4 rounded-xl text-sm font-bold flex items-center gap-3">
              <CheckCircle2 size={18} />
              Listo
            </div>
          ) : action === 'exporting' || action === 'deleting' ? (
            <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-4 py-4 rounded-xl text-sm font-bold flex items-center gap-3">
              <Loader2 size={18} className="animate-spin" />
              {action === 'exporting' ? 'Exportando...' : 'Eliminando...'}
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => handleExportAndCleanup('local')}
                className="flex-1 py-3 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-cyan-500/30 transition-all"
              >
                Descargar (PC)
              </button>
              <button
                onClick={() => handleExportAndCleanup('drive')}
                className="flex-1 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-500/30 transition-all"
              >
                Subir a Drive
              </button>
              <button
                onClick={handleDeleteWithoutBackup}
                className="flex-1 py-3 bg-rose-500/20 border border-rose-500/30 text-rose-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-rose-500/30 transition-all"
              >
                No, Borrar
              </button>
            </div>
          )}

          <button
            onClick={() => { setShowConfirm(false); setAction('idle'); }}
            className="w-full text-xs text-slate-500 hover:text-white transition-colors underline"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

function dataToCSV(accesses: any[]): string {
  const headers = ['ID', 'Miembro', 'Cédula', 'Resultado', 'Confianza', 'Dispositivo', 'Fecha'];
  const rows = accesses.map((a: any) => [
    a.id,
    a.miembro?.nombre || 'Desconocido',
    a.miembro?.cedula || '',
    a.resultado,
    a.confianza,
    a.dispositivo_id,
    new Date(a.timestamp).toLocaleString('es-CO'),
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
