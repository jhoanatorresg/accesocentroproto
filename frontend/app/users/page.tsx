"use client";

import { useEffect, useState, Suspense } from "react";
import { Users, Search, Trash2, ShieldCheck, X, Loader2, CheckCircle2, XCircle, Filter, ChevronRight, UserPlus, Fingerprint, Calendar, Clock } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { io } from "socket.io-client";
import { API_URL } from "@/lib/config";

type User = {
  id: number;
  cedula: string | null;
  nombre: string;
  telefono: string | null;
  huella_id: number;
  estado: string;
  rol: string;
  fecha_registro: string | null;
  membership_end_date: string | null;
  plan: { nombre: string } | null;
};

export default function UsersPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24 text-slate-500 font-bold uppercase tracking-widest text-xs animate-pulse">Cargando Core...</div>}>
      <UsersContent />
    </Suspense>
  );
}

function UsersContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [users,     setUsers]     = useState<User[]>([]);
  const [selected,    setSelected]    = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [message,     setMessage]     = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchUsers = () => {
    const filter = searchParams.get("filter");
    const hour   = searchParams.get("hour");
    let url = `${API_URL}/api/users`;
    const params = new URLSearchParams();
    if (filter) params.append("filter", filter);
    if (hour)   params.append("hour",   hour);
    if (params.toString()) url += `?${params.toString()}`;
    fetch(url)
      .then(r => r.json())
      .then(data => setUsers(Array.isArray(data) ? data : []))
      .catch(err => console.error("Error cargando usuarios:", err));
  };

  useEffect(() => { fetchUsers(); }, [searchParams]);

  useEffect(() => {
    const socket = io(API_URL);
    socket.on('member_deleted_confirm', () => {
      fetchUsers();
    });
    socket.on('enroll_result', () => {
      fetchUsers();
    });
    return () => { socket.disconnect(); };
  }, [searchParams]);

  const deleteUser = async (id: number) => {
    if (!confirm("¿Eliminar este usuario? Se enviará el comando al sensor y se esperará confirmación.")) return;
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      const res  = await fetch(`${API_URL}/api/users/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setMessage("⏳ Esperando confirmación del sensor biométrico...");
      } else {
        alert("Error: " + data.error);
        setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      }
    } catch {
      alert("Error conectando con el servidor");
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const filteredUsers = users.filter(u => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return u.nombre.toLowerCase().includes(q) ||
             (u.cedula && u.cedula.includes(q)) ||
             u.huella_id.toString().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-10 animate-slide-up">
      
      {/* Header Premium */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-[0.2em] mb-2">
            <Users size={14} className="fill-cyan-400" />
            Database Management
          </div>
          <h2 className="text-4xl font-black text-white tracking-tight">Gestión de Usuarios</h2>
          <p className="text-slate-400 mt-2 font-medium">Administra el acceso de los usuarios registrados</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="bg-[#0d121b] border border-white/5 px-6 py-3 rounded-2xl flex items-center gap-4">
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Registrados</p>
              <p className="text-xl font-black text-white leading-none">{users.length}</p>
            </div>
            <div className="w-[1px] h-8 bg-white/5" />
            <Users className="text-cyan-400" size={24} />
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:max-w-md group">
          <div className="absolute inset-0 bg-cyan-500/5 blur-xl group-focus-within:bg-cyan-500/10 transition-all" />
          <div className="relative bg-[#0d121b] border border-white/5 rounded-2xl flex items-center px-5 focus-within:border-cyan-500/30 transition-all">
            <Search className="text-slate-500" size={20} />
            <input
              type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-transparent border-none py-4 px-4 text-white placeholder-slate-500 outline-none text-sm font-medium"
              placeholder="Buscar por nombre, ID o identificación..."
            />
          </div>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button className="flex-1 md:flex-none px-6 py-4 bg-white/5 border border-white/5 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-3 hover:bg-white/10 transition-all">
            <Filter size={18} />
            Filtros
          </button>
        </div>
      </div>

      {message && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-6 py-4 rounded-2xl text-sm font-bold flex items-center gap-3 animate-in">
          <CheckCircle2 size={20} />
          {message}
        </div>
      )}

      {/* Grid de Usuarios */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredUsers.length === 0 ? (
          <div className="col-span-full py-32 flex flex-col items-center justify-center text-slate-600 bg-[#0d121b] border border-white/5 rounded-[3rem]">
            <Search size={48} className="mb-4 opacity-20" />
            <p className="font-bold tracking-widest text-xs uppercase">No se encontraron resultados</p>
          </div>
        ) : (
          filteredUsers.map(u => {
            const isActive = u.estado === 'activo';
            return (
              <div key={u.id} className="group relative p-[1px] rounded-[2.5rem] overflow-hidden hover:scale-[1.02] transition-all duration-500">
                <div className={`absolute inset-0 bg-gradient-to-br ${isActive ? 'from-cyan-500/20 to-blue-600/20' : 'from-rose-500/20 to-red-600/20'} opacity-0 group-hover:opacity-100 transition-opacity`} />
                <div className="relative bg-[#0d121b] border border-white/5 p-8 rounded-[2.45rem] h-full flex flex-col">
                  
                  <div className="flex items-start justify-between mb-6">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black ${isActive ? 'bg-cyan-500/10 text-cyan-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {u.nombre.charAt(0)}
                    </div>
                    <div className="flex flex-col items-end">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                            {isActive ? 'Permitido' : 'Restringido'}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-tighter">ID Huella: #{u.huella_id}</span>
                    </div>
                  </div>

                  <div className="flex-1">
                    <h3 className="text-xl font-black text-white group-hover:text-cyan-400 transition-colors line-clamp-1">{u.nombre}</h3>
                    <p className="text-slate-400 text-sm font-medium mt-1">{u.rol || 'Personal'}</p>
                    
                    <div className="mt-6 space-y-3">
                        <div className="flex items-center gap-3 text-slate-500">
                            <ShieldCheck size={14} className="text-slate-600" />
                            <span className="text-xs font-bold">{u.cedula || 'Sin Identificación'}</span>
                        </div>
                        <div className="flex items-center gap-3 text-slate-500">
                            <Fingerprint size={14} className="text-slate-600" />
                            <span className="text-xs font-bold">Biometría Registrada</span>
                        </div>
                        {u.fecha_registro && (
                          <div className="flex items-center gap-3 text-slate-500">
                            <Calendar size={14} className="text-slate-600" />
                            <span className="text-xs font-bold">Ingreso: {new Date(u.fecha_registro).toLocaleDateString('es-CO')}</span>
                          </div>
                        )}
                        {u.membership_end_date && (
                          <div className="flex items-center gap-3 text-slate-500">
                            <Clock size={14} className="text-slate-600" />
                            <span className="text-xs font-bold">Vence: {new Date(u.membership_end_date).toLocaleDateString('es-CO')}</span>
                          </div>
                        )}
                        {u.plan && (
                          <div className="flex items-center gap-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                              u.estado === 'activo' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                            }`}>
                              {u.plan.nombre}
                            </span>
                          </div>
                        )}
                    </div>
                  </div>

                  <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
                    <button 
                        onClick={() => deleteUser(u.id)}
                        disabled={deletingIds.has(u.id)}
                        className={`p-3 rounded-xl transition-all ${deletingIds.has(u.id) ? 'bg-orange-500/20 text-orange-400 animate-pulse' : 'bg-white/5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400'}`}
                    >
                        {deletingIds.has(u.id) ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                    </button>
                    
                    <button className="flex items-center gap-2 text-xs font-black text-slate-400 hover:text-white transition-colors uppercase tracking-widest">
                        Ver Detalles
                        <ChevronRight size={14} />
                    </button>
                  </div>

                </div>
              </div>
            );
          })
        )}
        
        {/* Botón de Añadir (Diseño de Slot) */}
        <button 
            onClick={() => router.push('/admin')}
            className="group p-[1px] rounded-[2.5rem] overflow-hidden border border-white/5 bg-white/[0.02] border-dashed hover:border-cyan-500/50 hover:bg-cyan-500/[0.02] transition-all duration-500 min-h-[300px] flex flex-col items-center justify-center"
        >
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-slate-500 group-hover:bg-cyan-500 group-hover:text-white transition-all duration-500 shadow-xl shadow-cyan-500/0 group-hover:shadow-cyan-500/20">
                <UserPlus size={28} />
            </div>
            <p className="text-white font-bold mt-4">Registrar Usuario</p>
            <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mt-1">Acceso Biométrico</p>
        </button>
      </div>

    </div>
  );
}
