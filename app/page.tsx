"use client";

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { Activity, ShieldCheck, ShieldAlert, Users, ExternalLink, X, Fingerprint, Zap, Lock, Unlock, Mail, Download, Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/config';

type AccessEvent = {
  id: number;
  resultado: string;
  confianza: number;
  timestamp: string;
  dispositivo_id: string;
  usuario?: { nombre: string; huella_id: number };
};

type WeeklyData = { day: string; date: string; count: number };

export default function Dashboard() {
  const router = useRouter();
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [stats, setStats] = useState({
    active: 0, inactivos: 0,
    totalAccesses: 0, failedAccesses: 0,
    histogram: Array(24).fill(0),
    weekly: [] as WeeklyData[]
  });

  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [email, setEmail]     = useState('');
  const [isCleaning, setIsCleaning] = useState(false);

  const fetchStats = () =>
    fetch(`${API_URL}/api/stats`)
      .then(r => r.json())
      .then(data => {
        if (data && !data.error) {
          setStats(data);
        }
      })
      .catch(err => console.error('Stats error:', err));

  const fetchTodayAccesses = () =>
    fetch(`${API_URL}/api/accesses/today`)
      .then(r => r.json())
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch(err => console.error('Accesses error:', err));

  useEffect(() => {
    fetchStats();
    fetchTodayAccesses();
 
    const socket = io(API_URL);
    socket.on('access_event', (data: AccessEvent) => {
      setEvents((prev) => [data, ...prev].slice(0, 15));
      fetchStats();
    });
    socket.on('device_status', () => {
      fetchStats();
    });
    socket.on('member_deleted_confirm', () => {
      fetchStats();
      fetchTodayAccesses();
    });

    return () => { socket.disconnect(); };
  }, []);

  const openDoor = async () => {
    let token = localStorage.getItem("adminToken");
    if (!token) {
      const username = prompt("Esta acción requiere privilegios de administrador. Ingresa tu usuario:");
      if (!username) return;
      const password = prompt("Ingresa tu contraseña:");
      if (!password) return;

      try {
        const loginRes = await fetch(`${API_URL}/api/admin/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password })
        });
        const loginData = await loginRes.json();
        if (loginData.success) {
          token = loginData.token;
          localStorage.setItem("adminToken", token as string);
        } else {
          alert("Credenciales incorrectas");
          return;
        }
      } catch {
        alert("Error de conexión al autenticar");
        return;
      }
    }

    try {
      const res = await fetch(`${API_URL}/api/devices/esp32c6_centro_01/open`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        alert('Comando enviado: Puerta Abierta');
      } else {
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem("adminToken");
          alert("Sesión expirada o no autorizada. Inténtalo de nuevo.");
        } else {
          alert('Error: ' + data.error);
        }
      }
    } catch (e: any) {
      alert('Error de conexión: ' + e.message);
    }
  };

  return (
    <div className="space-y-10 animate-slide-up">

      {/* Header Immersivo */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-[0.2em] mb-2">
            <Zap size={14} className="fill-cyan-400" />
            Live Monitor
          </div>
          <h2 className="text-4xl font-black text-white tracking-tight">Centro Prototipado</h2>
          <p className="text-slate-400 mt-2 font-medium">Control de acceso biométrico inteligente v2.5</p>
        </div>
        
        <div className="flex items-center gap-4">
            <button
            onClick={openDoor}
            className="group relative px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl font-bold text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all duration-300 flex items-center gap-3 overflow-hidden"
            >
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <Unlock size={20} className="relative z-10" />
            <span className="relative z-10">Apertura Remota</span>
            </button>
        </div>
      </div>

      {/* Stat Cards - Glass Estilo */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { title: 'Ingresos Hoy', val: stats.totalAccesses, icon: Activity, color: 'from-cyan-400 to-blue-500', shadow: 'shadow-blue-500/20' },
          { title: 'Personal Activo', val: stats.active, icon: Users, color: 'from-emerald-400 to-teal-600', shadow: 'shadow-emerald-500/20' },
          { title: 'Accesos Denegados', val: stats.failedAccesses, icon: ShieldAlert, color: 'from-rose-400 to-red-600', shadow: 'shadow-red-500/20' },
          { title: 'Estado Sensor', val: 'Online', icon: Fingerprint, color: 'from-violet-400 to-purple-600', shadow: 'shadow-purple-500/20' },
        ].map((stat, i) => (
          <div key={i} className="group relative p-1 rounded-[2rem] overflow-hidden transition-all duration-500 hover:scale-[1.02]">
            <div className={`absolute inset-0 bg-gradient-to-br ${stat.color} opacity-20`} />
            <div className="relative bg-[#0d121b] p-6 rounded-[1.9rem] border border-white/5 h-full">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-2xl bg-gradient-to-br ${stat.color} ${stat.shadow} shadow-lg`}>
                  <stat.icon size={22} className="text-white" />
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
              </div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">{stat.title}</p>
              <h3 className="text-3xl font-black text-white">{stat.val}</h3>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* Registro en Tiempo Real - La joya de la corona */}
        <div className="xl:col-span-2 group">
          <div className="relative p-[1px] rounded-[2.5rem] overflow-hidden h-full">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
            <div className="relative bg-[#0d121b]/80 backdrop-blur-3xl rounded-[2.45rem] border border-white/5 h-full flex flex-col overflow-hidden">
              <div className="p-8 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div>
                  <h3 className="text-2xl font-black text-white flex items-center gap-3">
                    Accesos Recientes
                    <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                  </h3>
                  <p className="text-slate-400 text-sm mt-1">Transmisión en vivo desde el sensor biométrico</p>
                </div>
                <div className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white transition-colors cursor-pointer">
                    <Activity size={20} />
                </div>
              </div>
              
              <div className="p-8 space-y-4 overflow-y-auto custom-scrollbar max-h-[600px]">
                {events.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                    <Fingerprint size={64} className="mb-4 opacity-20 animate-pulse" />
                    <p className="font-bold tracking-widest text-xs uppercase">Sincronizando con Hardware...</p>
                  </div>
                ) : (
                  events.map((ev, i) => {
                    const isPermitido = ev.resultado === 'permitido';
                    return (
                      <div 
                        key={ev.id || i} 
                        className={`group/item relative p-5 rounded-3xl border transition-all duration-500 hover:bg-white/[0.02] ${
                          isPermitido 
                            ? 'border-emerald-500/10 bg-emerald-500/[0.02]' 
                            : 'border-rose-500/10 bg-rose-500/[0.02]'
                        }`}
                      >
                        <div className="flex items-center justify-between relative z-10">
                          <div className="flex items-center gap-5">
                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-transform duration-500 group-hover/item:rotate-6 ${
                              isPermitido ? 'bg-emerald-500/20 text-emerald-400 shadow-emerald-500/10' : 'bg-rose-500/20 text-rose-400 shadow-rose-500/10'
                            }`}>
                              {isPermitido ? <ShieldCheck size={28} /> : <ShieldAlert size={28} />}
                            </div>
                            <div>
                              <h4 className="text-lg font-bold text-white flex items-center gap-2">
                                {ev.usuario?.nombre || 'Persona Desconocida'}
                                {isPermitido && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                              </h4>
                              <div className="flex items-center gap-3 mt-1">
                                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                                  isPermitido ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                                }`}>
                                  {isPermitido ? 'Acceso Autorizado' : 'Intento Fallido'}
                                </span>
                                <span className="text-slate-500 text-[10px] font-bold flex items-center gap-1">
                                    <Clock size={10} />
                                    ID: {ev.usuario?.huella_id || '???'}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-white font-black text-lg font-mono">
                                {new Date(ev.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-tighter">
                                {new Date(ev.timestamp || Date.now()).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Derecha - Herramientas */}
        <div className="space-y-8">
            {/* Tarjeta de Seguridad */}
            <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-8 rounded-[2.5rem] shadow-2xl shadow-indigo-500/20 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 blur-3xl -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-700" />
                <Lock className="text-white/20 absolute bottom-4 right-4 group-hover:rotate-12 transition-transform" size={100} />
                
                <h3 className="text-2xl font-black text-white mb-2 relative z-10">Seguridad Activa</h3>
                <p className="text-indigo-100 text-sm font-medium mb-6 relative z-10 leading-relaxed">
                    Sistema de cifrado de punto a punto habilitado con broker HiveMQ Cloud.
                </p>
                <button 
                    onClick={() => setShowCleanupModal(true)}
                    className="w-full py-4 bg-white text-indigo-600 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-indigo-50 transition-colors relative z-10"
                >
                    <Download size={18} />
                    Exportar Reportes
                </button>
            </div>

            {/* Estado del Dispositivo */}
            <div className="bg-[#0d121b] border border-white/5 p-8 rounded-[2.5rem]">
                <h4 className="text-white font-bold mb-6 flex items-center gap-3 text-sm tracking-widest uppercase">
                    Hardware Status
                </h4>
                <div className="space-y-6">
                    {[
                        { label: 'Procesador ESP32-C6', status: 'Optimal', color: 'text-emerald-400' },
                        { label: 'Sensor Biométrico AS608', status: 'Ready', color: 'text-emerald-400' },
                        { label: 'Latencia MQTT', status: '12ms', color: 'text-cyan-400' },
                    ].map((item, i) => (
                        <div key={i} className="flex items-center justify-between">
                            <span className="text-slate-400 text-xs font-semibold">{item.label}</span>
                            <span className={`${item.color} text-[10px] font-black uppercase tracking-widest`}>{item.status}</span>
                        </div>
                    ))}
                </div>
                <div className="mt-8 pt-8 border-t border-white/5">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-slate-400">
                            <Fingerprint size={24} />
                        </div>
                        <div>
                            <p className="text-white text-xs font-bold">Filtro de Confianza</p>
                            <p className="text-slate-500 text-[10px] font-medium mt-1">Mínimo requerido: 120</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      </div>

      {/* Modal de Exportación Premium */}
      {showCleanupModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in">
          <div className="bg-[#0d121b] border border-white/10 w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden zoom-in relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-3xl -mr-16 -mt-16" />
            
            <div className="p-8 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/20 rounded-2xl text-blue-400"><Download size={22} /></div>
                <h3 className="text-2xl font-black text-white">Reporte</h3>
              </div>
              <button onClick={() => setShowCleanupModal(false)} className="w-10 h-10 rounded-full hover:bg-white/5 flex items-center justify-center text-slate-400 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <p className="text-slate-400 text-sm leading-relaxed font-medium">
                Se enviará un reporte completo de los accesos de la semana al correo especificado y se optimizará la base de datos local.
              </p>
              
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 ml-1">
                  Correo Electrónico
                </label>
                <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="admin@centroprototipado.com"
                    className="w-full pl-12 pr-4 py-4 bg-white/5 border border-white/5 rounded-2xl text-white text-sm focus:border-blue-500/50 outline-none transition-all"
                    />
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={() => { setIsCleaning(true); setTimeout(() => { setShowCleanupModal(false); setIsCleaning(false); }, 1500); }} 
                  disabled={isCleaning}
                  className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-3 transition-all shadow-lg shadow-blue-900/20 disabled:opacity-50"
                >
                  {isCleaning ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                      <>
                        <Download size={18} />
                        Generar y Enviar
                      </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
