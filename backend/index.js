const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mqtt = require('mqtt');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});
const prisma = new PrismaClient();
const dbSync = require('./db_sync');

// Estado temporal en memoria para enrolamiento (para soportar HTTP Polling)
let currentEnrollStatus = {
  estado: "Inactivo",
  lectura: 0,
  resultado: null,
  huella_id: null,
  timestamp: Date.now()
};

// Middleware de autenticación para administradores
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const secret = process.env.JWT_SECRET || 'secret-secreto-super-acceso-centro';
    const decoded = jwt.verify(token, secret);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token inválido o expirado.' });
  }
};

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────
// 1. MQTT — Conexión al broker LOCAL (Mosquitto)
// ─────────────────────────────────────────────────────
const brokerUrl = process.env.MQTT_BROKER_URL?.trim() || 'mqtt://localhost:1883';
const mqttOptions = {
  clientId: 'backend_acceso_' + Math.random().toString(16).substring(2, 10),
  connectTimeout: 5000,
  reconnectPeriod: 2000,
};

// Solo añadir credenciales si están definidas en .env
if (process.env.MQTT_USERNAME) {
  mqttOptions.username = process.env.MQTT_USERNAME.trim();
  mqttOptions.password = process.env.MQTT_PASSWORD?.trim();
}

console.log(`📡 Intentando conectar a MQTT: ${brokerUrl} con usuario: ${mqttOptions.username}`);

const mqttClient = mqtt.connect(brokerUrl, mqttOptions);

const publishMqtt = (topic, payload) => {
  return new Promise((resolve) => {
    if (mqttClient.connected) {
      mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
        resolve();
      });
    } else {
      const onConnect = () => {
        mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
          resolve();
        });
      };
      mqttClient.once('connect', onConnect);
      setTimeout(() => {
        mqttClient.off('connect', onConnect);
        resolve();
      }, 3000);
    }
  });
};

mqttClient.on('error', (err) => {
  console.error('💥 MQTT Error:', err.message);
});

mqttClient.on('connect', () => {
  console.log(`✅ Conectado a broker MQTT: ${brokerUrl}`);
  mqttClient.subscribe('centro/acceso',      (err) => err && console.error('Sub error acceso:', err));
  mqttClient.subscribe('centro/estado',      (err) => err && console.error('Sub error estado:', err));
  mqttClient.subscribe('centro/enrolamiento',(err) => err && console.error('Sub error enrolamiento:', err));
});

mqttClient.on('reconnect', () => console.log('🔄 Reconectando a MQTT...'));
mqttClient.on('offline',   () => console.warn('⚠️  MQTT offline'));

// ─────────────────────────────────────────────────────
// 2. Procesamiento de mensajes MQTT
// ─────────────────────────────────────────────────────
mqttClient.on('message', async (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());

    // ── Estado del dispositivo / heartbeat / progreso de enrolamiento
    if (topic === 'centro/estado') {
      if (payload.online !== undefined) {
        await prisma.dispositivo.upsert({
          where:  { id: payload.dispositivo },
          update: { estado: payload.online ? 'online' : 'offline', ultimo_ping: new Date() },
          create: { id: payload.dispositivo, nombre: payload.dispositivo, estado: payload.online ? 'online' : 'offline' }
        });
        console.log(`📡 Dispositivo: ${payload.dispositivo} → ${payload.online ? 'online' : 'offline'}`);
        io.emit('device_status', payload);

      } else if (payload.estado === 'esperando_dedo') {
        currentEnrollStatus = {
          estado: "esperando_dedo",
          lectura: payload.lectura || 1,
          resultado: null,
          huella_id: payload.huella_id || null,
          timestamp: Date.now()
        };
        io.emit('enroll_progress', payload);

      } else if (payload.cmd_ejecutado === 'abrir') {
        console.log(`🚪 Dispositivo ${payload.dispositivo} abrió la puerta`);
      }
    }

    // ── Accesos y resultados de enrolamiento
    else if (topic === 'centro/acceso') {

      // Confirmación de borrado de huella desde el sensor
      if (payload.resultado === 'borrado' && (payload.miembro_id || payload.huella_id)) {
        console.log(`✅ Borrado confirmado: huella_id ${payload.huella_id}`);

        const memberId  = payload.miembro_id ? parseInt(payload.miembro_id) : null;
        const huellaId  = parseInt(payload.huella_id);

        const member = await prisma.usuario.findFirst({
          where: memberId ? { id: memberId } : { huella_id: huellaId }
        });

        if (member) {
          await prisma.usuarioEliminado.create({
            data: {
              cedula:         member.cedula,
              nombre:         member.nombre,
              huella_id:      member.huella_id,
              telefono:       member.telefono,
              fecha_eliminacion: new Date(),
            }
          });

          await prisma.huellaDisponible.create({ data: { huella_id: member.huella_id } });
          await prisma.acceso.deleteMany({ where: { usuario_id: member.id } });
          await prisma.usuario.delete({ where: { id: member.id } });

          console.log(`🗑️  Usuario ${member.nombre} eliminado tras confirmación del sensor.`);
          io.emit('member_deleted_confirm', { id: member.id, huella_id: member.huella_id });
        }
        return;
      }

      // Resultados de enrolamiento
      if (['enrolado', 'timeout', 'error_coincidencia', 'error_guardado', 'memoria_llena'].includes(payload.resultado)) {
        console.log(`🔑 Resultado enrolamiento:`, payload.resultado);
        currentEnrollStatus = {
          estado: "completado",
          lectura: 0,
          resultado: payload.resultado === 'enrolado' ? 'exito' : payload.resultado,
          huella_id: payload.huella_id,
          timestamp: Date.now()
        };
        io.emit('enroll_result', {
          resultado: payload.resultado === 'enrolado' ? 'exito' : payload.resultado,
          huella_id: payload.huella_id
        });
        return;
      }

      // Evento de acceso normal
      let finalResult = payload.resultado;
      let member = null;

      if (payload.huella_id !== undefined && payload.huella_id !== null) {
        member = await prisma.usuario.findUnique({
          where:   { huella_id: parseInt(payload.huella_id) }
        });

        if (member) {
          if (member.estado === 'activo') finalResult = 'permitido';
          else                            finalResult = 'denegado_inactivo';
        } else {
          if (finalResult === 'permitido') finalResult = 'denegado';
        }
      }

      // Asegurar que el dispositivo exista en DB
      const dbDevice = await prisma.dispositivo.findUnique({ where: { id: payload.dispositivo } });
      if (!dbDevice) {
        await prisma.dispositivo.create({
          data: { id: payload.dispositivo, nombre: payload.dispositivo, estado: 'online' }
        });
      }

      const log = await prisma.acceso.create({
        data: {
          usuario_id:    member?.id || undefined,
          resultado:     finalResult,
          confianza:     payload.confianza || 0,
          dispositivo_id: payload.dispositivo
        },
        include: { usuario: true }
      });

      console.log(`🔒 Acceso: ${log.usuario?.nombre || 'Desconocido'} → ${finalResult}`);
      io.emit('access_event', log);
    }

    // ── Fallback: topic de enrolamiento antiguo
    else if (topic === 'centro/enrolamiento') {
      console.log(`📥 Enrolamiento (topic antiguo):`, payload);
      currentEnrollStatus = {
        estado: "completado",
        lectura: 0,
        resultado: payload.resultado === 'enrolado' ? 'exito' : payload.resultado,
        huella_id: payload.huella_id,
        timestamp: Date.now()
      };
      io.emit('enroll_result', payload);
    }

  } catch (error) {
    console.error('❌ Error procesando MQTT:', error.message);
  }
});

// Endpoint HTTP Webhook para que el ESP32 reporte accesos y estados sin MQTT en Serverless (Vercel)
app.post('/api/webhook/acceso', async (req, res) => {
  try {
    const payload = req.body;
    console.log(`📥 Webhook HTTP recibido:`, payload);

    if (payload.online !== undefined) {
      const dbDevice = await prisma.dispositivo.upsert({
        where:  { id: payload.dispositivo },
        update: { estado: payload.online ? 'online' : 'offline', ultimo_ping: new Date() },
        create: { id: payload.dispositivo, nombre: payload.dispositivo, estado: payload.online ? 'online' : 'offline' }
      });
      return res.json({ success: true, device: dbDevice });
    }

    // Confirmación de borrado
    if (payload.resultado === 'borrado' && (payload.miembro_id || payload.huella_id)) {
      const memberId  = payload.miembro_id ? parseInt(payload.miembro_id) : null;
      const huellaId  = parseInt(payload.huella_id);

      const member = await prisma.usuario.findFirst({
        where: memberId ? { id: memberId } : { huella_id: huellaId }
      });

      if (member) {
        await prisma.usuarioEliminado.create({
          data: {
            cedula:         member.cedula,
            nombre:         member.nombre,
            huella_id:      member.huella_id,
            telefono:       member.telefono,
            fecha_eliminacion: new Date(),
          }
        });

        await prisma.huellaDisponible.create({ data: { huella_id: member.huella_id } });
        await prisma.acceso.deleteMany({ where: { usuario_id: member.id } });
        await prisma.usuario.delete({ where: { id: member.id } });
        console.log(`🗑️  Usuario ${member.nombre} eliminado por HTTP webhook.`);
      }
      return res.json({ success: true });
    }

    // Enrolamiento esperando dedo
    if (payload.estado === 'esperando_dedo') {
      currentEnrollStatus = {
        estado: "esperando_dedo",
        lectura: payload.lectura || 1,
        resultado: null,
        huella_id: payload.huella_id || null,
        timestamp: Date.now()
      };
      return res.json({ success: true });
    }

    // Enrolamiento completado
    if (['enrolado', 'timeout', 'error_coincidencia', 'error_guardado', 'memoria_llena'].includes(payload.resultado)) {
      currentEnrollStatus = {
        estado: "completado",
        lectura: 0,
        resultado: payload.resultado === 'enrolado' ? 'exito' : payload.resultado,
        huella_id: payload.huella_id,
        timestamp: Date.now()
      };
      return res.json({ success: true });
    }

    // Acceso normal
    let finalResult = payload.resultado;
    let member = null;

    if (payload.huella_id !== undefined && payload.huella_id !== null) {
      member = await prisma.usuario.findUnique({
        where:   { huella_id: parseInt(payload.huella_id) }
      });

      if (member) {
        if (member.estado === 'activo') finalResult = 'permitido';
        else                            finalResult = 'denegado_inactivo';
      } else {
        if (finalResult === 'permitido') finalResult = 'denegado';
      }
    }

    const dbDevice = await prisma.dispositivo.findUnique({ where: { id: payload.dispositivo } });
    if (!dbDevice) {
      await prisma.dispositivo.create({
        data: { id: payload.dispositivo, nombre: payload.dispositivo, estado: 'online' }
      });
    }

    const log = await prisma.acceso.create({
      data: {
        usuario_id:    member?.id || undefined,
        resultado:     finalResult,
        confianza:     payload.confianza || 0,
        dispositivo_id: payload.dispositivo
      },
      include: { usuario: true }
    });

    console.log(`🔒 Acceso HTTP Webhook: ${log.usuario?.nombre || 'Desconocido'} → ${finalResult}`);
    return res.json({ success: true, log });

  } catch (error) {
    console.error('❌ Error webhook HTTP:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────
// 3. API REST
// ─────────────────────────────────────────────────────

// Dashboard stats
app.get('/api/stats', async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const totalAccesses = await prisma.acceso.count({
      where: { timestamp: { gte: todayStart }, resultado: 'permitido' }
    });

    const failedAccesses = await prisma.acceso.count({
      where: { timestamp: { gte: todayStart }, resultado: { in: ['denegado', 'denegado_inactivo'] } }
    });

    const active = await prisma.usuario.count({ where: { estado: 'activo' } });
    const inactivos = await prisma.usuario.count({ where: { estado: 'inactivo' } });

    // Histograma por hora (hoy)
    const todayAccesses = await prisma.acceso.findMany({
      where:  { timestamp: { gte: todayStart } },
      select: { timestamp: true }
    });
    const histogram = Array(24).fill(0);
    todayAccesses.forEach(a => { histogram[new Date(a.timestamp).getHours()]++; });

    // Histograma semanal (últimos 7 días)
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    const weekAccesses = await prisma.acceso.findMany({
      where:  { timestamp: { gte: weekStart } },
      select: { timestamp: true }
    });
    const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const weekly = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
      const nd = new Date(d); nd.setDate(nd.getDate() + 1);
      const count = weekAccesses.filter(a => {
        const t = new Date(a.timestamp);
        return t >= d && t < nd;
      }).length;
      weekly.push({ day: weekDays[d.getDay()], date: d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }), count });
    }

    res.json({ totalAccesses, failedAccesses, active, inactivos, histogram, weekly });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Obtener todos los accesos del día actual (para persistencia en pantalla)
app.get('/api/accesses/today', async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const accesses = await prisma.acceso.findMany({
      where: { timestamp: { gte: todayStart } },
      include: { usuario: true },
      orderBy: { timestamp: 'desc' }
    });
    res.json(accesses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Abrir puerta de forma remota
app.post('/api/devices/:id/open', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  await publishMqtt('centro/comando', JSON.stringify({ cmd: 'abrir', dispositivo: id }));
  console.log(`📤 Comando ABRIR enviado a: ${id}`);
  res.json({ success: true, message: 'Comando de apertura enviado.' });
});

// Lista de usuarios con filtros
app.get('/api/users', async (req, res) => {
  try {
    const { filter, hour } = req.query;

    // Si no tenemos DATABASE_URL configurada o es local (SQLite), usamos el cliente fallback HTTP de Supabase
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
      console.log("⚠️ DATABASE_URL no encontrada o local (SQLite). Usando REST API fallback para Supabase...");
      const fallbackUsers = await dbSync.fetchUsersFallback();
      if (fallbackUsers) {
        let filtered = fallbackUsers;
        if (filter === 'active') {
          filtered = filtered.filter(u => u.estado === 'activo');
        } else if (filter === 'inactive') {
          filtered = filtered.filter(u => u.estado === 'inactivo');
        }
        return res.json(filtered);
      }
    }

    let where = {};
    const now = new Date();

    if (filter === 'active') {
      where = { estado: 'activo' };

    } else if (filter === 'inactive') {
      where = { estado: 'inactivo' };

    } else if (filter === 'today' || filter === 'access_hour') {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      let accessWhere = { timestamp: { gte: start } };

      if (filter === 'access_hour' && hour) {
        const h = parseInt(hour);
        const hStart = new Date(start); hStart.setHours(h);
        const hEnd   = new Date(start); hEnd.setHours(h + 1);
        accessWhere.timestamp = { gte: hStart, lt: hEnd };
      }

      const accesses  = await prisma.acceso.findMany({ where: accessWhere, select: { usuario_id: true } });
      const userIds = [...new Set(accesses.map(a => a.usuario_id).filter(id => id !== null))];
      where = { id: { in: userIds } };
    }

    const users = await prisma.usuario.findMany({
      where,
      orderBy: { nombre: 'asc' }
    });
    res.json(users);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Compatibilidad con frontend (redireccionar /api/members a /api/users)
app.get('/api/members', async (req, res) => {
  res.redirect(307, '/api/users' + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''));
});

// Login de administrador
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const admin = await prisma.admin.findUnique({ where: { username } });
    if (admin) {
      const passwordMatch = await bcrypt.compare(password, admin.password);
      if (passwordMatch) {
        const token = jwt.sign(
          { id: admin.id, username: admin.username },
          process.env.JWT_SECRET || 'secret-secreto-super-acceso-centro',
          { expiresIn: '24h' }
        );

        // Guardar hora de ingreso en Supabase
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
        const dispositivo = req.headers['user-agent'] || null;
        await prisma.sesionAdmin.create({
          data: {
            admin_id:    admin.id,
            username:    admin.username,
            hora_inicio: new Date(),
            ip:          typeof ip === 'string' ? ip.split(',')[0].trim() : null,
            dispositivo: dispositivo ? dispositivo.substring(0, 200) : null
          }
        });

        console.log(`✅ Inicio de sesión: ${admin.username} desde IP: ${ip}`);
        return res.json({ success: true, token });
      }
    }
    res.status(401).json({ error: 'Credenciales inválidas' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Historial de sesiones de administrador
app.get('/api/admin/sessions', authenticateAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const sesiones = await prisma.sesionAdmin.findMany({
      orderBy: { hora_inicio: 'desc' },
      take: limit,
      include: { admin: { select: { username: true } } }
    });
    res.json(sesiones);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Crear usuario
app.post('/api/users', authenticateAdmin, async (req, res) => {
  try {
    const { cedula, nombre, telefono, huella_id } = req.body;

    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
      console.log("⚠️ DATABASE_URL no encontrada o local (SQLite). Registrando usuario via REST fallback...");
      const nuevoUsuario = await dbSync.createUserFallback({
        cedula,
        nombre,
        telefono,
        huella_id: parseInt(huella_id),
        estado: 'activo',
        rol: 'empleado',
        fecha_registro: new Date().toISOString()
      });
      currentEnrollStatus = { estado: "Inactivo", lectura: 0, resultado: null, huella_id: null, timestamp: Date.now() };
      return res.json({ success: true, user: nuevoUsuario });
    }

    const nuevoUsuario = await prisma.usuario.create({
      data: {
        cedula,
        nombre,
        telefono,
        huella_id: parseInt(huella_id),
        estado:    'activo',
        rol:       'empleado'
      }
    });
    // Limpiar estado de enrolamiento al terminar de guardar
    currentEnrollStatus = { estado: "Inactivo", lectura: 0, resultado: null, huella_id: null, timestamp: Date.now() };
    res.json({ success: true, user: nuevoUsuario });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Endpoint para consultar progreso de enrolamiento via HTTP Polling
app.get('/api/admin/enroll-status', authenticateAdmin, (req, res) => {
  res.json(currentEnrollStatus);
});

// Enviar comando de enrolamiento al ESP32
app.post('/api/devices/:id/enroll', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const { huella_id } = req.body;
  await publishMqtt('centro/comando', JSON.stringify({
    cmd:       'enrolar',
    huella_id: parseInt(huella_id),
    dispositivo: id
  }));
  console.log(`📤 Comando ENROLAR huella #${huella_id} enviado a: ${id}`);
  res.json({ success: true, message: 'Comando enrolar enviado.' });
});

// Eliminar usuario (envía comando MQTT al sensor, espera confirmación)
app.delete('/api/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
      console.log("⚠️ DATABASE_URL no encontrada o local (SQLite). Eliminando usuario via REST fallback...");
      await dbSync.deleteUserFallback(parseInt(id));
      return res.json({ success: true, message: 'Usuario eliminado de la base de datos (REST fallback)' });
    }

    const user = await prisma.usuario.findUnique({ where: { id: parseInt(id) } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    await publishMqtt('centro/comando', JSON.stringify({
      cmd:        'borrar',
      huella_id:  user.huella_id,
      miembro_id: user.id
    }));

    console.log(`📤 Comando BORRAR enviado: ${user.nombre} (huella #${user.huella_id})`);
    res.json({ success: true, message: 'Comando de borrado enviado al sensor. Esperando confirmación...' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Compatibilidad con frontend (redireccionar DELETE /api/members/:id a DELETE /api/users/:id)
app.delete('/api/members/:id', authenticateAdmin, async (req, res) => {
  res.redirect(307, `/api/users/${req.params.id}`);
});

// Renovación de usuario
app.post('/api/users/:id/renew', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await prisma.usuario.update({
      where: { id: parseInt(id) },
      data: { estado: 'activo', fecha_registro: new Date() }
    });
    res.json({ success: true, user: updated });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Compatibilidad con frontend (redireccionar POST /api/members/:id/renew a POST /api/users/:id/renew)
app.post('/api/members/:id/renew', authenticateAdmin, async (req, res) => {
  res.redirect(307, `/api/users/${req.params.id}/renew`);
});

// Limpieza semanal + exportación (simulada localmente)
app.post('/api/cleanup', authenticateAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const allLogs = await prisma.acceso.findMany({ include: { usuario: true } });
    console.log(`📧 [SIMULADO] Exportando ${allLogs.length} registros a: ${email}`);

    await prisma.acceso.deleteMany({});
    console.log(`🧹 Base de datos de accesos limpiada.`);

    res.json({ success: true, message: `Backup simulado enviado a ${email} y logs limpiados.` });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Siguiente ID de huella disponible (reciclado o nuevo)
app.get('/api/next-huella-id', authenticateAdmin, async (req, res) => {
  try {
    const recycled = await prisma.huellaDisponible.findFirst({ orderBy: { huella_id: 'asc' } });
    if (recycled) {
      return res.json({ huella_id: recycled.huella_id, recycled: true });
    }
    const maxUser = await prisma.usuario.findFirst({ orderBy: { huella_id: 'desc' } });
    res.json({ huella_id: (maxUser?.huella_id || 0) + 1, recycled: false });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Consumir un huella_id reciclado después del enrolamiento exitoso
app.delete('/api/free-huella/:huellaId', authenticateAdmin, async (req, res) => {
  try {
    const huellaId = parseInt(req.params.huellaId);
    await prisma.huellaDisponible.deleteMany({ where: { huella_id: huellaId } });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────────────
// 5. Data Retention — Export y limpieza de accesos
// ─────────────────────────────────────────────────────

// Exportar accesos anteriores a una fecha (CSV-ready JSON)
app.get('/api/accesses/export', async (req, res) => {
  try {
    const { before } = req.query;
    if (!before) return res.status(400).json({ error: 'Parámetro before (ISO date) requerido' });

    const beforeDate = new Date(before);
    const accesses = await prisma.acceso.findMany({
      where: { timestamp: { lt: beforeDate } },
      include: { usuario: true },
      orderBy: { timestamp: 'desc' }
    });

    res.json({ count: accesses.length, accesses });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Limpiar accesos anteriores a una fecha
app.post('/api/accesses/cleanup', authenticateAdmin, async (req, res) => {
  try {
    const { before } = req.body;
    if (!before) return res.status(400).json({ error: 'Parámetro before requerido' });

    const beforeDate = new Date(before);
    const deleted = await prisma.acceso.deleteMany({
      where: { timestamp: { lt: beforeDate } }
    });

    console.log(`🧹 Limpieza completada: ${deleted.count} registros eliminados (anteriores a ${before})`);
    res.json({ success: true, deleted: deleted.count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Subida simulada a Google Drive (genera un enlace de descarga local)
app.post('/api/accesses/upload-drive', authenticateAdmin, async (req, res) => {
  try {
    const { csv, filename } = req.body;
    if (!csv) return res.status(400).json({ error: 'CSV requerido' });

    const fs = require('fs');
    const path = require('path');
    const exportDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    const filePath = path.join(exportDir, filename || `export_${Date.now()}.csv`);
    fs.writeFileSync(filePath, csv, 'utf8');

    console.log(`📧 [SIMULADO] Archivo exportado localmente: ${filePath}`);
    res.json({ success: true, message: 'Archivo guardado localmente (simula subida a Drive)', path: filePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Salud del servidor
app.get('/api/health', (req, res) => {
  res.json({
    status:   'ok',
    time:     new Date().toISOString(),
    mqtt:     mqttClient.connected ? 'connected' : 'disconnected',
    database: 'sqlite-local'
  });
});

// ─────────────────────────────────────────────────────
// 4. Iniciar servidor o exportar para Vercel
// ─────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log(`🚀 Servidor activo en: http://localhost:${PORT}`);
    console.log(`📡 MQTT Broker:        ${brokerUrl}`);
    console.log(`🗃️  Base de datos:      PostgreSQL / Supabase`);
    console.log('═══════════════════════════════════════════════');
    console.log('');
  });
}

module.exports = app;
