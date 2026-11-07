(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const MAX_MB = 25;
  const socket = io({ reconnectionDelayMax: 4000 });

  // ===================== State =====================
  let me = null;
  let users = [];
  let active = null; // 'all' ya username
  let joining = false;
  let everJoined = false;
  const chats = {};      // key -> [messages]
  const unread = {};     // key -> number
  const typingNow = {};  // key -> name
  const typingTimers = {};
  let stick = true;      // chat neeche scroll par hai?
  let newWhileAway = 0;
  let lastTypingSent = 0;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const rid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  let clientId = store.get('cid');
  if (!clientId) { clientId = rid(); store.set('cid', clientId); }
  const isMobile = () => matchMedia('(max-width: 760px)').matches;
  const isTouch = () => matchMedia('(pointer: coarse)').matches;

  // ===================== Helpers =====================
  const COLORS = ['#d9534f', '#a64ac9', '#5c6bc0', '#0288d1', '#00897b', '#43a047', '#ef8a17', '#8d6e63', '#546e7a', '#d81b60'];
  const colorFor = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const initial = (s) => (Array.from(String(s || '?').trim())[0] || '?');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const icon = (id, cls) => {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('class', cls || 'ic');
    const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s;
  };
  const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const fmtDay = (t) => {
    const d = new Date(t), n = new Date();
    if (sameDay(d, n)) return 'Aaj';
    const y = new Date(n); y.setDate(n.getDate() - 1);
    if (sameDay(d, y)) return 'Kal';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtSize = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const keyOf = (m) => (m.to === 'all' ? 'all' : (m.from === me ? m.to : m.from));
  const lastOf = (key) => { const a = chats[key]; return a && a.length ? a[a.length - 1] : null; };
  const extOf = (n) => { const m = /\.([a-z0-9]{1,5})$/i.exec(n || ''); return m ? m[1].toUpperCase() : 'FILE'; };

  let toastTimer;
  function toast(t, ms) {
    const e = $('toast'); e.textContent = t; e.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.add('hidden'), ms || 3200);
  }

  function avatar(name, opts) {
    opts = opts || {};
    const a = el('div', 'avatar' + (opts.sm ? ' sm' : ''));
    if (opts.group) { a.style.background = '#128c7e'; a.appendChild(icon('i-users')); }
    else { a.style.background = colorFor(name); a.appendChild(document.createTextNode(initial(name))); }
    if (opts.online) a.appendChild(el('span', 'on'));
    return a;
  }

  function linkify(text, into) {
    const re = /(https?:\/\/[^\s<]+)/gi;
    let last = 0, m;
    while ((m = re.exec(text))) {
      let url = m[0], trail = '';
      const t = /[.,;:!?)\]}'"]+$/.exec(url);
      if (t) { trail = t[0]; url = url.slice(0, -trail.length); }
      if (m.index > last) into.appendChild(document.createTextNode(text.slice(last, m.index)));
      const a = el('a', null, url); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      into.appendChild(a);
      if (trail) into.appendChild(document.createTextNode(trail));
      last = m.index + m[0].length;
    }
    if (last < text.length) into.appendChild(document.createTextNode(text.slice(last)));
  }

  // ===================== Theme =====================
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    store.set('theme', t);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === 'dark' ? '#202c33' : '#00a884';
    const b = $('themeBtn'); b.textContent = ''; b.appendChild(icon(t === 'dark' ? 'i-sun' : 'i-moon'));
  }
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  $('themeBtn').addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

  // iOS keyboard / mobile browser bar: app ki height visual viewport se match karo
  if (window.visualViewport) {
    const vv = window.visualViewport, app = $('app');
    const fit = () => {
      app.style.height = vv.height + 'px';
      if (vv.offsetTop) window.scrollTo(0, 0);
      if (stick && active) scrollDown();
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
  }

  // ===================== Join / Login =====================
  function setLoginLoading(on) {
    $('loginBtn').classList.toggle('loading', on);
    $('loginBtn').disabled = on;
  }
  function showLogin(err) {
    $('splash').classList.add('hidden');
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('loginError').textContent = err || '';
    setLoginLoading(false);
  }

  function doJoin(name, auto) {
    if (joining) return;
    joining = true;
    let answered = false;
    const timer = setTimeout(() => {
      if (answered) return;
      answered = true; joining = false;
      if (!everJoined) showLogin('Server ka jawab nahi aaya, dobara koshish karein');
    }, 12000);
    socket.emit('join', { name, clientId }, (res) => {
      if (answered) return;
      answered = true; clearTimeout(timer); joining = false;
      if (!res || !res.ok) {
        if (auto) { store.del('name'); me = null; }
        showLogin((res && res.error) || 'Join nahi ho saka');
        return;
      }
      const first = !everJoined || me !== res.name;
      everJoined = true;
      me = res.name;
      store.set('name', me);
      users = res.users || [];
      for (const k in chats) delete chats[k];
      for (const k in unread) delete unread[k];
      chats.all = [];
      (res.history || []).forEach((m) => {
        const k = keyOf(m);
        (chats[k] = chats[k] || []).push(m);
        if (m.to === me && m.status !== 'read') unread[m.from] = (unread[m.from] || 0) + 1;
      });
      unread.all = res.unreadGroup || 0;
      $('splash').classList.add('hidden');
      $('login').classList.add('hidden');
      $('app').classList.remove('hidden');
      $('meName').textContent = me;
      const mav = $('meAvatar'); mav.style.background = colorFor(me); mav.textContent = initial(me);
      setConn(true);
      renderList();
      if (active) {
        if (active !== 'all' && !users.some((u) => u.name === active)) closeChat();
        else { renderMessages(); updateHead(); markRead(); }
      }
      if (first && !isMobile()) $('searchInput').focus();
    });
  }

  $('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = $('nameInput').value.replace(/\s+/g, ' ').trim();
    if (!n) { $('loginError').textContent = 'Apna naam likhein'; return; }
    if (!socket.connected) { $('loginError').textContent = 'Server se connect ho raha hai, thora ruk kar dobara try karein'; return; }
    $('loginError').textContent = '';
    setLoginLoading(true);
    doJoin(n, false);
  });

  socket.on('connect', () => {
    const saved = store.get('name');
    const name = me || saved;
    if (name) {
      if (!everJoined) { $('splash').classList.remove('hidden'); $('login').classList.add('hidden'); }
      doJoin(name, true);
    } else {
      showLogin('');
    }
  });
  socket.on('disconnect', () => setConn(false));
  socket.on('connect_error', () => { setConn(false); if (!everJoined && store.get('name')) showLogin('Server se connect nahi ho paya, dobara koshish ho rahi hai…'); });

  let connTimer;
  function setConn(ok) {
    clearTimeout(connTimer);
    const st = $('connState'); st.classList.toggle('off', !ok);
    $('connText').textContent = ok ? 'online' : 'connecting…';
    const b = $('connBanner');
    if (ok) { b.classList.add('hidden'); return; }
    if (!everJoined) return;
    connTimer = setTimeout(() => { b.textContent = 'Internet / server se connection toot gaya. Dobara connect ho raha hai…'; b.classList.remove('hidden'); }, 1500);
  }

  $('logoutBtn').addEventListener('click', () => {
    openSheet('Logout karna chahte hain?', [
      { label: 'Logout', icon: 'i-logout', danger: true, fn: () => {
        socket.emit('logout');
        store.del('name'); me = null; everJoined = false; active = null;
        closeChat(); $('nameInput').value = '';
        showLogin('');
      } },
    ]);
  });

  // ===================== Chat list =====================
  function previewText(m) {
    let t;
    if (m.type === 'image') t = '📷 ' + (m.text || 'Photo');
    else if (m.type === 'video') t = '🎥 ' + (m.text || 'Video');
    else if (m.type === 'audio') t = '🎤 Voice message' + (m.dur ? ' (' + fmtDur(m.dur) + ')' : '');
    else if (m.type === 'file') t = '📄 ' + (m.name || 'File');
    else t = m.text;
    return t.replace(/\s+/g, ' ');
  }

  function tickIcon(m) {
    if (m.from !== me) return null;
    const s = m.to === 'all' ? 'sent' : (m.status || 'sent');
    return icon(s === 'sent' ? 'i-check' : 'i-check2', 'tick' + (s === 'read' ? ' read' : ''));
  }

  function chatItem(c) {
    const item = el('div', 'chat-item' + (active === c.key ? ' active' : ''));
    item.setAttribute('role', 'button'); item.tabIndex = 0;
    const last = lastOf(c.key);
    const un = unread[c.key] || 0;
    const body = el('div', 'ci-body');
    const top = el('div', 'ci-top');
    top.appendChild(el('div', 'ci-name', c.name));
    top.appendChild(el('div', 'ci-time' + (un ? ' unread' : ''), last ? fmtTime(last.time) : ''));
    const bottom = el('div', 'ci-bottom');
    const lastEl = el('div', 'ci-last');
    const t = typingNow[c.key];
    if (t) {
      lastEl.classList.add('typing');
      lastEl.textContent = c.group ? t + ' typing…' : 'typing…';
    } else if (last) {
      const tk = c.group ? null : tickIcon(last);
      if (tk) lastEl.appendChild(tk);
      let pre = '';
      if (c.group) pre = (last.from === me ? 'Aap' : last.from) + ': ';
      lastEl.appendChild(el('span', 'txt', pre + previewText(last)));
    } else {
      lastEl.appendChild(el('span', 'txt', c.group ? users.length + ' members' : (c.online ? 'online' : 'offline')));
    }
    bottom.appendChild(lastEl);
    if (un) bottom.appendChild(el('div', 'badge', un > 99 ? '99+' : String(un)));
    body.append(top, bottom);
    item.append(avatar(c.name, { group: c.group, online: c.online }), body);
    const open = () => openChat(c.key);
    item.addEventListener('click', open);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return item;
  }

  function renderList() {
    const list = $('chatList');
    const keep = list.scrollTop;
    list.textContent = '';
    const q = ($('searchInput').value || '').trim().toLowerCase();
    const people = users.filter((u) => u.name !== me && u.name.toLowerCase().includes(q))
      .map((u) => ({ key: u.name, name: u.name, online: u.online }));
    const recent = (a, b) => {
      const la = lastOf(a.key), lb = lastOf(b.key);
      if (la && lb) return lb.time - la.time;
      if (la) return -1; if (lb) return 1;
      return a.name.localeCompare(b.name);
    };
    const online = people.filter((p) => p.online).sort(recent);
    const offline = people.filter((p) => !p.online).sort(recent);

    if (!q || 'everyone group sab'.includes(q)) list.appendChild(chatItem({ key: 'all', name: 'Everyone (Group)', group: true }));
    if (online.length) { list.appendChild(el('div', 'section', 'Online · ' + online.length)); online.forEach((c) => list.appendChild(chatItem(c))); }
    if (offline.length) { list.appendChild(el('div', 'section', 'Offline · ' + offline.length)); offline.forEach((c) => list.appendChild(chatItem(c))); }
    if (!people.length) {
      list.appendChild(el('div', 'list-note', q ? 'Is naam ka koi nahi mila.' : 'Abhi aap ke ilawa koi join nahi hua.\nWebsite ka link doston ko bhejein, wo join karte hi yahan nazar aayenge.'));
      list.lastChild.style.whiteSpace = 'pre-line';
    }
    list.scrollTop = keep;
    updateTitle();
  }
  $('searchInput').addEventListener('input', renderList);

  function updateTitle() {
    const n = Object.values(unread).reduce((a, b) => a + b, 0);
    document.title = (n ? '(' + n + ') ' : '') + 'ChatApp';
  }

  // ===================== Open / close chat =====================
  function openChat(key) {
    active = key;
    unread[key] = 0;
    $('empty').classList.add('hidden');
    $('chatPane').classList.remove('hidden');
    $('app').classList.add('chat-open');
    if (isMobile()) {
      try {
        if (history.state && history.state.chat) history.replaceState({ chat: key }, '');
        else history.pushState({ chat: key }, '');
      } catch (e) { /* ignore */ }
    }
    stick = true; newWhileAway = 0;
    closePanels();
    updateHead();
    renderList();
    renderMessages();
    markRead();
    if (!isMobile()) $('msgInput').focus();
  }

  function closeChat() {
    stopAllAudio();
    if (rec) cancelRecording();
    closePanels();
    active = null;
    $('app').classList.remove('chat-open');
    $('chatPane').classList.add('hidden');
    $('empty').classList.remove('hidden');
    $('msgInput').blur();
    renderList();
  }
  $('backBtn').addEventListener('click', () => {
    if (history.state && history.state.chat) history.back(); else closeChat();
  });
  window.addEventListener('popstate', () => { if (active) closeChat(); });

  function updateHead() {
    if (!active) return;
    const isAll = active === 'all';
    const u = users.find((x) => x.name === active);
    const av = $('chatAvatar');
    av.replaceWith(Object.assign(avatar(isAll ? 'Everyone' : active, { group: isAll, online: !isAll && u && u.online }), { id: 'chatAvatar' }));
    $('chatName').textContent = isAll ? 'Everyone (Group)' : active;
    updateSub();
  }
  function updateSub() {
    if (!active) return;
    const sub = $('chatSub');
    const t = typingNow[active];
    sub.classList.toggle('typing', !!t);
    if (t) { sub.textContent = active === 'all' ? t + ' typing…' : 'typing…'; return; }
    if (active === 'all') {
      const on = users.filter((x) => x.online).length;
      sub.textContent = users.length + ' members · ' + on + ' online';
    } else {
      const u = users.find((x) => x.name === active);
      sub.textContent = u && u.online ? 'online' : 'offline';
    }
  }

  // ===================== Messages render =====================
  const messagesEl = $('messages');
  function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }
  function updateStick() {
    stick = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
    if (stick) { newWhileAway = 0; }
    $('toBottom').classList.toggle('hidden', stick);
    const c = $('toBottomCount'); c.classList.toggle('hidden', !newWhileAway); c.textContent = newWhileAway;
  }
  messagesEl.addEventListener('scroll', updateStick, { passive: true });
  $('toBottom').addEventListener('click', () => { messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }); });

  function metaEl(m, over) {
    const s = el('span', over ? 'meta-over' : 'meta');
    s.appendChild(document.createTextNode(fmtTime(m.time)));
    if (m.from === me) { const tk = el('span', 'tk'); const i = tickIcon(m); if (i) tk.appendChild(i); s.appendChild(tk); }
    return s;
  }

  function mediaBox(m) {
    const isVid = m.type === 'video';
    const box = el('div', 'media-box media-w' + (isVid ? ' vid' : ''));
    box.style.minHeight = '110px';
    const done = () => { box.style.minHeight = ''; if (stick) scrollDown(); };
    const fail = () => { box.className = 'media-box media-w fail'; box.style.minHeight = ''; box.textContent = isVid ? 'Ye video ab available nahi' : 'Ye photo ab available nahi'; box.onclick = null; };
    if (isVid) {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.playsInline = true; v.setAttribute('playsinline', ''); v.src = m.url + '#t=0.1';
      v.addEventListener('loadeddata', done); v.addEventListener('error', fail);
      box.appendChild(v);
      box.addEventListener('click', () => {
        if (box.classList.contains('playing')) return;
        box.classList.add('playing'); v.controls = true; v.play().catch(() => {});
      });
      v.addEventListener('ended', () => { box.classList.remove('playing'); v.controls = false; });
    } else {
      const img = document.createElement('img');
      img.alt = m.name || 'Photo'; img.decoding = 'async'; img.src = m.url;
      img.addEventListener('load', done); img.addEventListener('error', fail);
      box.appendChild(img);
      box.addEventListener('click', () => openLightbox(m.url, m.name));
    }
    return box;
  }

  // ---- Voice player ----
  const audios = new Map(); // msg id -> { audio, btn, bars }
  let playingId = null;
  function barHeights(id, n) {
    let h = 2166136261;
    for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    const out = [];
    for (let i = 0; i < n; i++) { h ^= i + 1; h = Math.imul(h, 16777619); out.push(18 + ((h >>> 0) % 82)); }
    return out;
  }
  function stopAllAudio() {
    audios.forEach((p, id) => { try { p.audio.pause(); } catch (e) { /* ignore */ } setPlayIcon(p, false); });
    playingId = null;
  }
  function setPlayIcon(p, playing) { if (!p.btn) return; p.btn.textContent = ''; p.btn.appendChild(icon(playing ? 'i-pause' : 'i-play')); }

  function voiceEl(m) {
    const wrap = el('div', 'voice');
    const btn = el('button', 'play'); btn.type = 'button'; btn.setAttribute('aria-label', 'Voice message chalayein');
    btn.appendChild(icon('i-play'));
    const wave = el('div', 'wave');
    const bars = barHeights(m.id, 34).map((h) => { const i = document.createElement('i'); i.style.height = h + '%'; wave.appendChild(i); return i; });
    const dur = el('div', 'dur', fmtDur(m.dur));
    wrap.append(btn, wave, dur);
    const p = { audio: null, btn, bars, dur, wave, total: m.dur || 0 };

    const paint = () => {
      const a = p.audio;
      const total = (a && isFinite(a.duration) && a.duration > 0) ? a.duration : p.total;
      const ratio = a && total ? Math.min(1, a.currentTime / total) : 0;
      const n = Math.round(ratio * bars.length);
      bars.forEach((b, i) => b.classList.toggle('done', i < n));
    };
    function ensure() {
      if (p.audio) return p.audio;
      const a = new Audio(); a.preload = 'auto'; a.src = m.url; p.audio = a;
      a.addEventListener('timeupdate', () => {
        paint();
        const total = isFinite(a.duration) && a.duration > 0 ? a.duration : p.total;
        dur.textContent = fmtDur(a.paused && a.currentTime === 0 ? total : (a.currentTime));
      });
      a.addEventListener('ended', () => { setPlayIcon(p, false); playingId = null; a.currentTime = 0; bars.forEach((b) => b.classList.remove('done')); dur.textContent = fmtDur(p.total); });
      a.addEventListener('pause', () => setPlayIcon(p, false));
      a.addEventListener('play', () => setPlayIcon(p, true));
      a.addEventListener('error', () => { wrap.classList.add('err'); toast('Voice message nahi chal saka (shayad purana ho gaya)'); });
      return a;
    }
    btn.addEventListener('click', () => {
      const a = ensure();
      if (!a.paused) { a.pause(); return; }
      if (playingId && playingId !== m.id && audios.get(playingId)) audios.get(playingId).audio.pause();
      playingId = m.id;
      a.play().catch(() => toast('Voice message nahi chal saka'));
    });
    const seek = (e) => {
      const a = ensure();
      const r = wave.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const total = isFinite(a.duration) && a.duration > 0 ? a.duration : p.total;
      if (total) { try { a.currentTime = ratio * total; } catch (err) { /* ignore */ } paint(); }
    };
    wave.addEventListener('click', seek);
    audios.set(m.id, p);
    return wrap;
  }

  function fileEl(m) {
    const a = el('a', 'file-card'); a.href = m.url; a.target = '_blank'; a.rel = 'noopener'; a.download = m.name || '';
    const fi = el('div', 'fi', extOf(m.name).slice(0, 4)); fi.style.background = colorFor(extOf(m.name));
    const info = el('div', 'info');
    info.appendChild(el('div', 'fn', m.name || 'File'));
    info.appendChild(el('div', 'fs', fmtSize(m.size || 0)));
    const dl = el('span', 'dl'); dl.appendChild(icon('i-download'));
    a.append(fi, info, dl);
    return a;
  }

  function buildRow(m, prev) {
    const out = m.from === me;
    const row = el('div', 'msg-row ' + (out ? 'out' : 'in'));
    row.dataset.id = m.id;
    const grouped = !!prev && prev.from === m.from && sameDay(prev.time, m.time);
    if (!grouped) row.classList.add('gap');
    const isMedia = m.type === 'image' || m.type === 'video';
    const box = el('div', 'msg ' + (out ? 'out' : 'in') + (grouped ? ' tail-less' : '') + (isMedia ? ' media' : ''));

    if (!out && active === 'all' && !grouped) {
      const w = el('div', 'who', m.from); w.style.color = colorFor(m.from); box.appendChild(w);
    }
    if (isMedia) {
      const mb = mediaBox(m);
      if (!m.text) mb.appendChild(metaEl(m, true));
      box.appendChild(mb);
      if (m.text) {
        const cap = el('div', 'body cap'); linkify(m.text, cap); cap.appendChild(metaEl(m)); box.appendChild(cap);
        box.appendChild(el('div', 'clear'));
      }
    } else if (m.type === 'audio') {
      box.appendChild(voiceEl(m));
      const mw = el('div', 'meta-wrap'); mw.appendChild(metaEl(m)); box.appendChild(mw);
    } else if (m.type === 'file') {
      box.appendChild(fileEl(m));
      if (m.text) { const cap = el('div', 'body cap'); linkify(m.text, cap); box.appendChild(cap); }
      const mw = el('div', 'meta-wrap'); mw.appendChild(metaEl(m)); box.appendChild(mw);
    } else {
      const body = el('div', 'body'); linkify(m.text, body); body.appendChild(metaEl(m)); box.appendChild(body);
      box.appendChild(el('div', 'clear'));
    }
    attachMenu(box, m);
    row.appendChild(box);
    return row;
  }

  function renderMessages() {
    stopAllAudio(); audios.clear();
    messagesEl.textContent = '';
    let prev = null;
    (chats[active] || []).forEach((m) => {
      if (!prev || !sameDay(prev.time, m.time)) { messagesEl.appendChild(el('div', 'day', fmtDay(m.time))); prev = null; }
      messagesEl.appendChild(buildRow(m, prev));
      prev = m;
    });
    scrollDown();
    stick = true; newWhileAway = 0; updateStick();
  }

  function appendMessage(m) {
    const arr = chats[active] || [];
    const prev = arr.length > 1 ? arr[arr.length - 2] : null;
    if (!prev || !sameDay(prev.time, m.time)) messagesEl.appendChild(el('div', 'day', fmtDay(m.time)));
    messagesEl.appendChild(buildRow(m, prev && sameDay(prev.time, m.time) ? prev : null));
    if (m.from === me || stick) { scrollDown(); updateStick(); }
    else { newWhileAway++; updateStick(); }
  }

  // ===================== Socket events =====================
  let actx = null;
  function beep() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.0001;
      o.connect(g); g.connect(actx.destination);
      const t = actx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.start(t); o.stop(t + 0.2);
    } catch (e) { /* ignore */ }
  }

  socket.on('message', (m) => {
    if (!me) return;
    const key = keyOf(m);
    const arr = (chats[key] = chats[key] || []);
    if (arr.some((x) => x.id === m.id)) return;
    arr.push(m);
    delete typingNow[key];
    const visible = document.visibilityState === 'visible';
    if (key === active) {
      appendMessage(m);
      updateSub();
      if (m.from !== me) { if (visible) markRead(); else { unread[key] = (unread[key] || 0) + 1; beep(); } }
    } else if (m.from !== me) {
      unread[key] = (unread[key] || 0) + 1;
      beep();
    }
    renderList();
  });

  socket.on('status', ({ ids, status }) => {
    const set = new Set(ids || []);
    let touched = false;
    for (const k in chats) chats[k].forEach((m) => {
      if (set.has(m.id) && m.from === me) {
        if (status === 'read' || m.status !== 'read') m.status = status;
        touched = true;
        const tk = messagesEl.querySelector('[data-id="' + m.id + '"] .tk');
        if (tk) { tk.textContent = ''; const i = tickIcon(m); if (i) tk.appendChild(i); }
      }
    });
    if (touched) renderList();
  });

  socket.on('deleted', ({ id, to, from }) => {
    const key = to === 'all' ? 'all' : (from === me ? to : from);
    const arr = chats[key];
    if (!arr) return;
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return;
    const wasUnread = arr[i].from !== me && arr[i].status !== 'read' && key !== active;
    arr.splice(i, 1);
    if (wasUnread && unread[key]) unread[key]--;
    if (key === active) { const keep = messagesEl.scrollTop; renderMessages(); if (!stick) messagesEl.scrollTop = keep; }
    renderList();
  });

  socket.on('users', (u) => { users = u; renderList(); updateSub(); if (active && active !== 'all') updateHead(); });

  socket.on('typing', ({ from, to }) => {
    const key = to === 'all' ? 'all' : from;
    typingNow[key] = from;
    clearTimeout(typingTimers[key]);
    typingTimers[key] = setTimeout(() => { delete typingNow[key]; renderList(); updateSub(); }, 3000);
    renderList(); updateSub();
  });

  function markRead() {
    if (!active || document.visibilityState !== 'visible' || !socket.connected) return;
    if (active === 'all') {
      if (unread.all) { unread.all = 0; renderList(); }
      socket.emit('read', { chat: 'all' });
      return;
    }
    const pending = (chats[active] || []).filter((m) => m.from === active && m.status !== 'read');
    unread[active] = 0;
    if (!pending.length) { updateTitle(); return; }
    pending.forEach((m) => { m.status = 'read'; });
    socket.emit('read', { chat: active });
    renderList();
  }
  document.addEventListener('visibilitychange', markRead);
  window.addEventListener('focus', markRead);

  // ===================== Sending text =====================
  const input = $('msgInput');
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }
  function toggleSendMic() {
    const has = input.value.trim().length > 0;
    $('sendBtn').classList.toggle('hidden', !has);
    $('micBtn').classList.toggle('hidden', has);
  }
  function send(payload, done) {
    if (!socket.connected) { toast('Connection nahi hai, thora ruk kar try karein'); if (done) done({ ok: false }); return; }
    socket.timeout(15000).emit('message', payload, (err, res) => {
      if (err) { toast('Message nahi gaya, dobara try karein'); if (done) done({ ok: false }); return; }
      if (!res || !res.ok) toast((res && res.error) || 'Message nahi gaya');
      if (done) done(res || { ok: false });
    });
  }
  function sendText() {
    const text = input.value.trim();
    if (!text || !active) return;
    const keep = input.value;
    input.value = ''; autosize(); toggleSendMic();
    send({ to: active, type: 'text', text }, (r) => { if (!r.ok && !input.value) { input.value = keep; autosize(); toggleSendMic(); } });
    if (!isTouch()) input.focus();
  }
  $('sendBtn').addEventListener('mousedown', (e) => e.preventDefault()); // keyboard band na ho
  $('sendBtn').addEventListener('click', sendText);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isTouch()) { e.preventDefault(); sendText(); }
  });
  input.addEventListener('input', () => {
    autosize(); toggleSendMic();
    const now = Date.now();
    if (active && socket.connected && input.value && now - lastTypingSent > 2000) { lastTypingSent = now; socket.emit('typing', { to: active }); }
  });
  input.addEventListener('focus', () => { closePanels(); setTimeout(() => { if (stick) scrollDown(); }, 300); });
  input.addEventListener('paste', (e) => {
    const f = e.clipboardData && Array.from(e.clipboardData.files || [])[0];
    if (f) { e.preventDefault(); pickFile(f); }
  });

  // ===================== Panels (emoji / attach) =====================
  function closePanels() { $('emojiPanel').classList.add('hidden'); $('attachMenu').classList.add('hidden'); $('emojiBtn').classList.remove('on'); }
  $('attachBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = $('attachMenu').classList.contains('hidden');
    closePanels();
    if (open) $('attachMenu').classList.remove('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!$('attachMenu').contains(e.target) && e.target !== $('attachBtn')) $('attachMenu').classList.add('hidden');
  });
  $('cameraItem').classList.toggle('hidden', !isTouch());
  $('attachMenu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pick]'); if (!b) return;
    closePanels();
    ({ gallery: $('fileGallery'), camera: $('fileCamera'), doc: $('fileDoc') })[b.dataset.pick].click();
  });
  ['fileGallery', 'fileCamera', 'fileDoc'].forEach((id) => $(id).addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) pickFile(f);
  }));

  // ===================== Emoji =====================
  const seg = (s) => (window.Intl && Intl.Segmenter)
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment)
    : Array.from(s);
  const EMOJI = [
    ['😀', '😀😃😄😁😆😅😂🤣🥲😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🥸🤩🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🫡🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👿💀☠️💩🤡👻👽🤖'],
    ['👍', '👍👎👌🤌🤏✌️🤞🫰🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋🤝🙏👏🙌👐🤲💪🦾✍️💅🤳🫶👀🧠'],
    ['❤️', '❤️🧡💛💚💙💜🖤🤍🤎💔❤️‍🔥💕💞💓💗💖💘💝💟☮️✨⭐🌟💫🔥💥💯💢💦💨🎉🎊🎈🎁🏆🥇🎂'],
    ['🐶', '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🦆🦅🦉🐺🐴🦄🐝🦋🐢🐍🐙🐬🐳🌹🌸🌻🌴🌵🍀🌍🌙☀️⛅🌧️⚡❄️🌈'],
    ['🍕', '🍎🍌🍉🍇🍓🍒🍑🥭🍍🥥🥝🍅🥑🌽🥕🍞🧀🍗🍖🌭🍔🍟🍕🌮🍜🍝🍣🍩🍪🎂🍰🍫🍬🍿☕🍵🥤🧃🍺'],
    ['⚽', '⚽🏀🏈⚾🏏🏑🎾🏐🎱🏓🏸🥊🎮🎯🎲🎵🎶🎤🎧🎸📱💻⌚📷🔑💡📚✏️💰🚗🚌🚲✈️🚀🏠⏰🕌🕋'],
  ];
  const grid = $('emojiGrid'), tabs = $('emojiTabs');
  function showCat(i) {
    grid.textContent = '';
    Array.from(tabs.children).forEach((t, j) => t.classList.toggle('on', i === j));
    seg(EMOJI[i][1]).forEach((em) => { const b = el('button', null, em); b.type = 'button'; grid.appendChild(b); });
    grid.scrollTop = 0;
  }
  EMOJI.forEach((c, i) => { const b = el('button', null, c[0]); b.type = 'button'; b.addEventListener('click', () => showCat(i)); tabs.appendChild(b); });
  showCat(0);
  grid.addEventListener('mousedown', (e) => e.preventDefault());
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const em = b.textContent;
    const s = input.selectionStart == null ? input.value.length : input.selectionStart;
    const en = input.selectionEnd == null ? s : input.selectionEnd;
    if (input.value.length - (en - s) + em.length > 2000) return;
    input.value = input.value.slice(0, s) + em + input.value.slice(en);
    const pos = s + em.length;
    try { input.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
    autosize(); toggleSendMic();
  });
  $('emojiBtn').addEventListener('click', () => {
    const open = $('emojiPanel').classList.contains('hidden');
    closePanels();
    if (open) { $('emojiPanel').classList.remove('hidden'); $('emojiBtn').classList.add('on'); input.blur(); setTimeout(() => { if (stick) scrollDown(); }, 50); }
    else if (!isTouch()) input.focus();
  });

  // ===================== File picking / preview / upload =====================
  let pending = null; // { file, kind, objUrl, xhr }
  function kindOf(f) {
    if (/^image\/(jpeg|png|gif|webp)$/.test(f.type)) return 'image';
    if (/^video\/(mp4|webm|quicktime|x-m4v)$/.test(f.type) || /\.(mp4|webm|mov|m4v)$/i.test(f.name)) return 'video';
    return 'file';
  }
  function pickFile(f) {
    if (!active) { toast('Pehle koi chat chunein'); return; }
    if (!f || !f.size) { toast('Ye file khali hai'); return; }
    if (f.size > MAX_MB * 1024 * 1024) { toast('File ' + MAX_MB + ' MB se choti honi chahiye (ye ' + fmtSize(f.size) + ' hai)', 4200); return; }
    closePanels();
    const kind = kindOf(f);
    pending = { file: f, kind, objUrl: kind === 'file' ? null : URL.createObjectURL(f), xhr: null, to: active };
    const body = $('pvBody'); body.textContent = '';
    if (kind === 'image') { const i = document.createElement('img'); i.src = pending.objUrl; i.alt = ''; body.appendChild(i); }
    else if (kind === 'video') { const v = document.createElement('video'); v.src = pending.objUrl; v.controls = true; v.playsInline = true; v.setAttribute('playsinline', ''); body.appendChild(v); }
    else {
      const w = el('div', 'pv-file'); const fi = el('div', 'fi', extOf(f.name).slice(0, 4)); fi.style.background = colorFor(extOf(f.name));
      w.append(fi, el('div', null, f.name), el('div', null, fmtSize(f.size))); body.appendChild(w);
    }
    $('pvTitle').textContent = (active === 'all' ? 'Everyone (Group)' : active) + ' ko bhejein';
    $('pvCaption').value = ''; $('pvProgress').classList.add('hidden'); $('pvBar').style.width = '0';
    $('pvSend').disabled = false; $('pvCaption').disabled = false;
    $('preview').classList.remove('hidden');
    if (!isTouch()) $('pvCaption').focus();
  }
  function closePreview() {
    if (pending) {
      if (pending.xhr) { try { pending.xhr.abort(); } catch (e) { /* ignore */ } }
      if (pending.objUrl) URL.revokeObjectURL(pending.objUrl);
      pending = null;
    }
    $('preview').classList.add('hidden'); $('pvBody').textContent = '';
  }
  $('pvClose').addEventListener('click', closePreview);
  $('preview').addEventListener('click', (e) => { if (e.target === $('preview') && !isMobile()) closePreview(); });

  function upload(blob, name, onProgress, hold) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      if (hold) hold.xhr = x;
      x.open('POST', '/upload');
      x.setRequestHeader('x-client-id', clientId);
      x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let d = {}; try { d = JSON.parse(x.responseText); } catch (e) { /* ignore */ }
        if (x.status >= 200 && x.status < 300 && d.url) resolve(d); else reject(new Error(d.error || 'Upload nahi ho saki'));
      };
      x.onerror = () => reject(new Error('Internet ka masla, upload nahi ho saka'));
      x.onabort = () => reject(new Error('cancelled'));
      x.ontimeout = () => reject(new Error('Upload mein bohat waqt lag gaya'));
      x.timeout = 5 * 60 * 1000;
      const fd = new FormData(); fd.append('file', blob, name); x.send(fd);
    });
  }

  async function sendPending() {
    const p = pending; if (!p) return;
    if (!socket.connected) { toast('Connection nahi hai, thora ruk kar try karein'); return; }
    $('pvSend').disabled = true; $('pvCaption').disabled = true;
    $('pvProgress').classList.remove('hidden');
    try {
      const d = await upload(p.file, p.file.name, (r) => { $('pvBar').style.width = Math.round(r * 100) + '%'; }, p);
      p.xhr = null;
      const caption = $('pvCaption').value.trim();
      send({ to: p.to, type: p.kind, url: d.url, name: d.name, text: caption });
      closePreview();
    } catch (err) {
      if (!pending) return; // user ne khud cancel kiya
      p.xhr = null;
      $('pvSend').disabled = false; $('pvCaption').disabled = false; $('pvProgress').classList.add('hidden');
      toast(err.message || 'Upload nahi ho saki', 4200);
    }
  }
  $('pvSend').addEventListener('click', sendPending);
  $('pvCaption').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (!$('pvSend').disabled) sendPending(); } });

  // Drag & drop (desktop)
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files') && active) { dragDepth++; $('drop').classList.remove('hidden'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').classList.add('hidden'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('drop').classList.add('hidden');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && active) pickFile(f);
  });

  // ===================== Voice recording =====================
  let rec = null;
  function pickMime() {
    const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return list.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  }
  async function startRecording() {
    if (!active || rec) return;
    if (!socket.connected) { toast('Connection nahi hai, thora ruk kar try karein'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      toast('Voice recording ke liye HTTPS wala link aur naya browser chahiye', 4500); return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { toast('Microphone ki ijazat dein (browser ki address bar mein lock icon se)', 4500); return; }
    if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }
    const mime = pickMime();
    let recorder;
    try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch (e) { stream.getTracks().forEach((t) => t.stop()); toast('Is browser mein recording shuru nahi ho saki'); return; }
    const r = { recorder, stream, chunks: [], start: Date.now(), send: false, to: active, mime: recorder.mimeType || mime || 'audio/webm', timer: null, ctx: null, raf: null };
    rec = r;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
    recorder.onstop = () => finishRecording(r);
    recorder.start(250);

    // live waveform
    const bars = $('recBars'); bars.textContent = '';
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      r.ctx = new AC(); const src = r.ctx.createMediaStreamSource(stream); const an = r.ctx.createAnalyser(); an.fftSize = 256; src.connect(an);
      const data = new Uint8Array(an.fftSize); let lastPush = 0;
      const loop = (t) => {
        if (rec !== r) return;
        if (t - lastPush > 90) {
          lastPush = t; an.getByteTimeDomainData(data);
          let peak = 0; for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
          const b = document.createElement('i'); b.style.height = Math.max(8, Math.min(100, peak * 1.6)) + '%'; bars.appendChild(b);
          while (bars.children.length > 80) bars.removeChild(bars.firstChild);
        }
        r.raf = requestAnimationFrame(loop);
      };
      r.raf = requestAnimationFrame(loop);
    } catch (e) { /* waveform optional */ }

    $('composer').classList.add('hidden'); $('recBar').classList.remove('hidden'); closePanels();
    $('recTime').textContent = '0:00';
    r.timer = setInterval(() => {
      const s = Math.floor((Date.now() - r.start) / 1000);
      $('recTime').textContent = fmtDur(s);
      if (s >= 300) stopRecording(true);
    }, 250);
  }
  function stopRecording(send) {
    const r = rec; if (!r) return;
    r.send = !!send;
    clearInterval(r.timer); if (r.raf) cancelAnimationFrame(r.raf);
    if (r.recorder.state !== 'inactive') { try { r.recorder.stop(); } catch (e) { finishRecording(r); } } else finishRecording(r);
  }
  function cancelRecording() { stopRecording(false); }
  async function finishRecording(r) {
    if (rec === r) rec = null; else if (r.done) return;
    r.done = true;
    r.stream.getTracks().forEach((t) => t.stop());
    if (r.ctx) { try { r.ctx.close(); } catch (e) { /* ignore */ } }
    $('recBar').classList.add('hidden'); $('composer').classList.remove('hidden');
    const secs = (Date.now() - r.start) / 1000;
    if (!r.send || !r.chunks.length) return;
    if (secs < 1) { toast('Voice message bohat chhota hai, mic dabaye rakhein'); return; }
    const type = r.mime.split(';')[0];
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const blob = new Blob(r.chunks, { type });
    if (blob.size > MAX_MB * 1024 * 1024) { toast('Voice message bohat bara hai'); return; }
    toast('Voice bheji ja rahi hai…', 20000);
    try {
      const d = await upload(blob, 'voice.' + ext);
      send({ to: r.to, type: 'audio', url: d.url, name: d.name, dur: Math.round(secs) }, () => $('toast').classList.add('hidden'));
    } catch (err) { toast('Voice nahi gayi: ' + err.message, 4200); }
  }
  $('micBtn').addEventListener('click', startRecording);
  $('recSend').addEventListener('click', () => stopRecording(true));
  $('recCancel').addEventListener('click', cancelRecording);

  // ===================== Lightbox / sheet / context menu =====================
  function openLightbox(url, name) {
    $('lbImg').src = url; $('lbDownload').href = url; $('lbDownload').download = name || 'photo';
    $('lightbox').classList.remove('hidden');
  }
  function closeLightbox() { $('lightbox').classList.add('hidden'); $('lbImg').removeAttribute('src'); }
  $('lbClose').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });

  function openSheet(title, actions) {
    $('sheetTitle').textContent = title || '';
    const box = $('sheetActions'); box.textContent = '';
    actions.concat([{ label: 'Cancel', cancel: true }]).forEach((a) => {
      const b = el('button', (a.danger ? 'danger ' : '') + (a.cancel ? 'cancel' : '')); b.type = 'button';
      if (a.icon) b.appendChild(icon(a.icon));
      b.appendChild(document.createTextNode(a.label));
      b.addEventListener('click', () => { closeSheet(); if (a.fn) a.fn(); });
      box.appendChild(b);
    });
    $('sheet').classList.remove('hidden');
  }
  function closeSheet() { $('sheet').classList.add('hidden'); }
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });

  let menuAt = 0;
  function showMsgMenu(m) {
    if (Date.now() - menuAt < 500) return;
    menuAt = Date.now();
    const acts = [];
    if (m.type === 'text' || m.text) acts.push({ label: 'Copy', icon: 'i-copy', fn: () => copyText(m.text) });
    if (m.url) acts.push({ label: 'Download', icon: 'i-download', fn: () => { const a = el('a'); a.href = m.url; a.download = m.name || ''; document.body.appendChild(a); a.click(); a.remove(); } });
    if (m.from === me) acts.push({ label: 'Sab ke liye delete karein', icon: 'i-trash', danger: true, fn: () => {
      socket.timeout(8000).emit('delete', m.id, (err, res) => { if (err || !res || !res.ok) toast('Message delete nahi ho saka'); });
    } });
    if (!acts.length) return;
    openSheet(previewText(m).slice(0, 60), acts);
  }
  function copyText(t) {
    const ok = () => toast('Copy ho gaya', 1500);
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(t).then(ok, () => fallbackCopy(t, ok)); }
    else fallbackCopy(t, ok);
  }
  function fallbackCopy(t, ok) {
    const ta = el('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch (e) { toast('Copy nahi ho saka'); }
    ta.remove();
  }
  function attachMenu(box, m) {
    let timer = null, sx = 0, sy = 0;
    box.addEventListener('contextmenu', (e) => { if (e.target.closest('a')) return; e.preventDefault(); showMsgMenu(m); });
    box.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      clearTimeout(timer); timer = setTimeout(() => { showMsgMenu(m); if (navigator.vibrate) navigator.vibrate(15); }, 450);
    }, { passive: true });
    box.addEventListener('touchmove', (e) => {
      const t = e.touches[0]; if (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8) clearTimeout(timer);
    }, { passive: true });
    ['touchend', 'touchcancel'].forEach((ev) => box.addEventListener(ev, () => clearTimeout(timer), { passive: true }));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('sheet').classList.contains('hidden')) closeSheet();
    else if (!$('lightbox').classList.contains('hidden')) closeLightbox();
    else if (!$('preview').classList.contains('hidden')) closePreview();
    else if (!$('emojiPanel').classList.contains('hidden') || !$('attachMenu').classList.contains('hidden')) closePanels();
    else if (active && !isMobile()) closeChat();
  });

  // Refresh / band karte waqt recording ya upload ho rahi ho to warn
  window.addEventListener('beforeunload', (e) => { if (rec || (pending && pending.xhr)) { e.preventDefault(); e.returnValue = ''; } });

  // Pehli baar: agar saved naam nahi to login dikhao (socket connect hone tak)
  if (!store.get('name')) showLogin('');
  else { $('splash').classList.remove('hidden'); $('login').classList.add('hidden'); }
  toggleSendMic();
})();
