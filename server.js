'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Server } = require('socket.io');

// ===================== Settings =====================
const MAX_FILE_MB = 25;      // ek file ki max size
const MAX_MESSAGES = 1000;   // memory mein kitne messages rakhne hain
const FILE_KEEP_DAYS = 7;    // uploaded files kitne din baad delete hon
const MAX_USERS = 100;       // kitne log join ho sakte hain
const LOCK_NAME_TO_DEVICE = true; // true: ek naam sirf usi device/browser se use ho jis ne pehle liya

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 30000 });

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const VID_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const AUD_EXT = new Set(['.m4a', '.mp4', '.webm', '.ogg', '.oga', '.mp3', '.wav', '.aac']);
const INLINE_EXT = new Set([...IMG_EXT, ...VID_EXT, ...AUD_EXT]);
const TYPES = new Set(['text', 'image', 'video', 'audio', 'file']);

// ===================== State (memory mein; server restart par reset) =====================
const known = new Map();      // nameLower -> { name, clientId, sockets:Set, groupRead:number }
const clientIds = new Set();  // upload ke liye check
const messages = [];

const userList = () => [...known.values()].map((u) => ({ name: u.name, online: u.sockets.size > 0 }));
const visibleTo = (name) => messages.filter((m) => m.to === 'all' || m.from === name || m.to === name);
const cleanName = (s) =>
  String(s || '')
    .replace(/[\u0000-\u001f\u007f<>​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
const safeUnlink = (url) => {
  const base = path.basename(String(url || ''));
  if (!/^[\w.-]+$/.test(base) || base.includes('..')) return;
  fs.unlink(path.join(UPLOAD_DIR, base), () => {});
};

// ===================== Uploads =====================
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '').slice(0, 10);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 } });

app.get('/health', (req, res) => res.type('text').send('ok'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; media-src 'self'; img-src 'self'");
      // Sirf images/audio/video browser mein khulen, baqi sab download hon (security ke liye)
      if (!INLINE_EXT.has(path.extname(filePath).toLowerCase())) {
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
  })
);

app.post('/upload', (req, res) => {
  const cid = req.get('x-client-id');
  if (!cid || !clientIds.has(cid)) return res.status(401).json({ error: 'Pehle chat mein join karein (connection dobara ban raha hai)' });
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File ' + MAX_FILE_MB + ' MB se choti honi chahiye' : 'Upload nahi ho saki';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'File nahi mili' });
    res.json({
      url: '/uploads/' + req.file.filename,
      name: Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 120),
      size: req.file.size,
    });
  });
});

function cleanOldFiles() {
  const limit = Date.now() - FILE_KEEP_DAYS * 864e5;
  fs.readdir(UPLOAD_DIR, (e, files) => {
    if (e) return;
    files.forEach((f) => {
      const p = path.join(UPLOAD_DIR, f);
      fs.stat(p, (e2, st) => { if (!e2 && st.isFile() && st.mtimeMs < limit) fs.unlink(p, () => {}); });
    });
  });
}
setInterval(cleanOldFiles, 6 * 3600 * 1000).unref();
cleanOldFiles();

// ===================== Sockets =====================
io.on('connection', (socket) => {
  let me = null; // { name, key }
  const bucket = [];

  const allow = () => {
    const now = Date.now();
    while (bucket.length && now - bucket[0] > 10000) bucket.shift();
    if (bucket.length >= 30) return false;
    bucket.push(now);
    return true;
  };

  function leave() {
    if (!me) return;
    const u = known.get(me.key);
    if (u) u.sockets.delete(socket.id);
    socket.leave('joined');
    socket.leave('u:' + me.key);
    me = null;
    io.to('joined').emit('users', userList());
  }

  socket.on('join', (data, cb) => {
    if (typeof cb !== 'function') return;
    const name = cleanName(data && data.name);
    const clientId = String((data && data.clientId) || '').slice(0, 64);
    if (!name) return cb({ ok: false, error: 'Apna naam likhein' });
    if (!clientId) return cb({ ok: false, error: 'Browser ID nahi mili, page refresh karein' });
    if (name.toLowerCase() === 'all') return cb({ ok: false, error: 'Ye naam allowed nahi, doosra chunein' });
    const key = name.toLowerCase();
    let u = known.get(key);
    if (u && LOCK_NAME_TO_DEVICE && u.clientId !== clientId) {
      return cb({ ok: false, error: 'Ye naam kisi aur ne le liya hai, doosra naam chunein' });
    }
    if (!u && known.size >= MAX_USERS) return cb({ ok: false, error: 'Chat full hai' });
    if (me && me.key !== key) leave();
    if (!u) {
      u = { name, clientId, sockets: new Set(), groupRead: Date.now() };
      known.set(key, u);
    }
    clientIds.add(clientId);
    u.sockets.add(socket.id);
    me = { name: u.name, key };
    socket.join('joined');
    socket.join('u:' + key);

    // Jo messages is user ke liye "sent" thay wo ab "delivered" ho gaye
    const deliveredBySender = {};
    messages.forEach((m) => {
      if (m.to === u.name && m.status === 'sent') {
        m.status = 'delivered';
        const k = m.from.toLowerCase();
        (deliveredBySender[k] = deliveredBySender[k] || []).push(m.id);
      }
    });
    const unreadGroup = messages.filter((m) => m.to === 'all' && m.from !== u.name && m.time > u.groupRead).length;

    cb({ ok: true, name: u.name, users: userList(), history: visibleTo(u.name), unreadGroup });
    io.to('joined').emit('users', userList());
    Object.keys(deliveredBySender).forEach((k) =>
      io.to('u:' + k).emit('status', { ids: deliveredBySender[k], status: 'delivered' })
    );
  });

  socket.on('message', (data, cb) => {
    const reply = (r) => { if (typeof cb === 'function') cb(r); };
    if (!me) return reply({ ok: false, error: 'Pehle join karein' });
    if (!data || typeof data !== 'object') return reply({ ok: false, error: 'Ghalat message' });
    if (!allow()) return reply({ ok: false, error: 'Bohat tez, thora ruk kar bhejein' });

    let type = TYPES.has(data.type) ? data.type : 'text';
    const text = String(data.text || '').replace(/\u0000/g, '').trim().slice(0, 2000);
    const msg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      from: me.name,
      to: 'all',
      type,
      text,
      time: Date.now(),
    };

    if (type === 'text') {
      if (!text) return reply({ ok: false, error: 'Khali message' });
    } else {
      const mm = /^\/uploads\/([\w.-]+)$/.exec(String(data.url || ''));
      if (!mm || mm[1].includes('..')) return reply({ ok: false, error: 'File nahi mili' });
      const filePath = path.join(UPLOAD_DIR, mm[1]);
      let st;
      try { st = fs.statSync(filePath); } catch (e) { return reply({ ok: false, error: 'File nahi mili' }); }
      const ext = path.extname(mm[1]).toLowerCase();
      const allowed = { image: IMG_EXT, video: VID_EXT, audio: AUD_EXT }[type];
      if (allowed && !allowed.has(ext)) type = 'file';
      msg.type = type;
      msg.url = '/uploads/' + mm[1];
      msg.name = String(data.name || mm[1]).slice(0, 120);
      msg.size = st.size;
      if (type === 'audio') msg.dur = Math.max(0, Math.min(600, Math.round(Number(data.dur) || 0)));
    }

    if (data.to && data.to !== 'all') {
      const target = known.get(String(data.to).toLowerCase());
      if (!target) return reply({ ok: false, error: 'Ye user nahi mila' });
      if (target.name === me.name) return reply({ ok: false, error: 'Apne aap ko message nahi bhej sakte' });
      msg.to = target.name;
      msg.status = target.sockets.size > 0 ? 'delivered' : 'sent';
      messages.push(msg);
      io.to('u:' + target.name.toLowerCase()).to('u:' + me.key).emit('message', msg);
    } else {
      msg.status = 'sent';
      messages.push(msg);
      io.to('joined').emit('message', msg);
    }
    while (messages.length > MAX_MESSAGES) {
      const old = messages.shift();
      if (old && old.url) safeUnlink(old.url);
    }
    reply({ ok: true, id: msg.id });
  });

  // Apna message sab ke liye delete karna
  socket.on('delete', (id, cb) => {
    const reply = (r) => { if (typeof cb === 'function') cb(r); };
    if (!me) return reply({ ok: false });
    const idx = messages.findIndex((m) => m.id === id && m.from === me.name);
    if (idx < 0) return reply({ ok: false, error: 'Message nahi mila' });
    const m = messages.splice(idx, 1)[0];
    if (m.url) safeUnlink(m.url);
    const ev = { id: m.id, to: m.to, from: m.from };
    if (m.to === 'all') io.to('joined').emit('deleted', ev);
    else io.to('u:' + m.to.toLowerCase()).to('u:' + me.key).emit('deleted', ev);
    reply({ ok: true });
  });

  // Receiver ne chat khol kar messages parh liye -> blue ticks
  socket.on('read', (data) => {
    if (!me || !data || !data.chat) return;
    if (data.chat === 'all') {
      const u = known.get(me.key);
      if (u) u.groupRead = Date.now();
      return;
    }
    const other = known.get(String(data.chat).toLowerCase());
    if (!other) return;
    const ids = [];
    messages.forEach((m) => {
      if (m.from === other.name && m.to === me.name && m.status !== 'read') {
        m.status = 'read';
        ids.push(m.id);
      }
    });
    if (ids.length) io.to('u:' + other.name.toLowerCase()).emit('status', { ids, status: 'read' });
  });

  socket.on('typing', (data) => {
    if (!me || !data) return;
    if (!data.to || data.to === 'all') {
      socket.to('joined').emit('typing', { from: me.name, to: 'all' });
    } else {
      const target = known.get(String(data.to).toLowerCase());
      if (target) io.to('u:' + target.name.toLowerCase()).emit('typing', { from: me.name, to: target.name });
    }
  });

  socket.on('logout', () => leave());
  socket.on('disconnect', () => leave());
});

process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Chat app chal raha hai: http://localhost:' + PORT));
