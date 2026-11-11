/* ---------- SUPABASE & LIVEKIT CONFIG ---------- */
const SB_URL = 'https://vlrscrzwqjkresgvcygh.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZscnNjcnp3cWprcmVzZ3ZjeWdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMDExMjMsImV4cCI6MjEwNzg3NzEyM30.8ttvi0_BkIrPa7KQ7L4zcxBPHNz-e_gsbcF1Bep4b90';
const LIVEKIT_URL = 'wss://xgames-bjyx6237.livekit.cloud';
const sb = window.supabase ? supabase.createClient(SB_URL, SB_KEY) : (() => {
  setTimeout(() => { try { bugAdd('library', 'Online library failed to load. Rooms are off, Quick Play still works.'); toast('Online features failed to load. Quick Play still works.'); } catch (e) {} }, 800);
  const c = { on: () => c, subscribe: () => c, send() {}, track() {} };
  const q = () => ({ select: q, eq: q, limit: q, insert: q, upsert: q, maybeSingle: q, then: r => r({ data: null, error: { message: 'offline' } }) });
  return { from: q, channel: () => c, removeChannel() {}, functions: { invoke: () => Promise.resolve({ error: { message: 'offline' } }) } };
})();

const $ = id => document.getElementById(id);

/* ---------- INPUT SAFETY ---------- */
const ID_RE = /^p_[a-z0-9]{4,16}$/;
const stripBio = s => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60);
const cleanLink = s => { try { const u = new URL(String(s || '').trim()); return u.protocol === 'https:' ? u.href.slice(0, 120) : ''; } catch (e) { return ''; } };
const stripName = s => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 15);
const cleanName = s => stripName(s) || 'Player';

let roomSubscription = null, pollTimer = null, joinRetryTimer = null, livekitRoom = null;
let roomCode = '', mySeatPos = 'S', micActive = false;
let roomMessages = [], unread = 0, chatOpen = false, chatReady = false, chatHits = {};
const MAX_ROOM = 4;
let hostTerm = 0, stateVersion = 0, lastApplied = { term: -1, version: -1 };
let joinConfirmed = false, syncing = false, syncDirty = false;
let mutedPlayers = new Set(), speaking = new Set(), gameMode = 'cutthroat';
let scores = { S: 0, W: 0, N: 0, E: 0 };
let botLevel = localStorage.getItem('xg_level') || 'medium';
if (!['easy', 'medium', 'hard'].includes(botLevel)) botLevel = 'medium';

let myClientId = localStorage.getItem('xg_perm_client_id');
if (!myClientId || !ID_RE.test(myClientId)) {
  myClientId = 'p_' + Math.random().toString(36).slice(2, 11);
  localStorage.setItem('xg_perm_client_id', myClientId);
}
let myNickname = stripName(localStorage.getItem('xg_perm_nickname'));
let myBio = stripBio(localStorage.getItem('xg_bio')), myLink = cleanLink(localStorage.getItem('xg_link'));
const AVATARS = ['😎', '🔥', '🌴', '🥥', '🍹', '🎧', '👑', '🦁', '🐢', '🌶️', '⚡', '🎲'];
let myAvatar = localStorage.getItem('xg_avatar');
if (!AVATARS.includes(myAvatar)) myAvatar = '😎';

/* ---------- REFRESH-PROOF SESSION ---------- */
const SESSION_KEY = 'xg_session_v1';
const MAX_SESSION_AGE = 6 * 3600 * 1000;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
function saveSession() { store.set(SESSION_KEY, { roomCode, role: isHost ? 'host' : 'guest', savedAt: Date.now() }); }
function clearSession() { store.del(SESSION_KEY); }

/* ---------- THEMES ---------- */
const THEMES = {
  classic: { n: 'Classic', tile: '#ffffff', edge: '#cbd5e1', line: '#94a3b8', pip: '#111827', top: '#155e2b', bot: '#0f441f', frame: '#3d2314' },
  neon: { n: 'Neon', tile: '#0f172a', edge: '#22d3ee', line: '#22d3ee', pip: '#f472b6', top: '#0b1020', bot: '#05060d', frame: '#312e81', glow: '#22d3ee' },
  wood: { n: 'Yard Wood', tile: '#f5e6c8', edge: '#a16207', line: '#92400e', pip: '#3b1d0a', top: '#6b4423', bot: '#4a2c14', frame: '#2a1608' },
};
let themeKey = localStorage.getItem('xg_theme');
if (!THEMES[themeKey]) themeKey = 'classic';
const TH = () => THEMES[themeKey];
function setTheme(k) {
  if (!THEMES[k]) return;
  themeKey = k; localStorage.setItem('xg_theme', k);
  $('wrap').style.borderColor = TH().frame;
  $('themeBtn').textContent = '🎨 ' + TH().n; renderSettingsButtons();
  if (!$('game').classList.contains('hidden')) refresh();
}
$('themeBtn').onclick = () => { const ks = Object.keys(THEMES); setTheme(ks[(ks.indexOf(themeKey) + 1) % ks.length]); };

/* ---------- ARCADE PICKER ---------- */
function openModal(title, items, currentVal, onSelect) {
  $('modalTitle').textContent = title;
  const list = $('modalList'); list.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'modal-option' + (item.value === currentVal ? ' selected' : '');
    el.textContent = item.label;
    el.onclick = () => { $('customModal').classList.add('hidden'); onSelect(item.value); };
    list.appendChild(el);
  });
  $('customModal').classList.remove('hidden');
}
$('modalClose').onclick = () => $('customModal').classList.add('hidden');

const MODE_NAME = { cutthroat: 'Cut Throat (FFA)', partners: 'Partners (2v2)', boneyard: 'Boneyard (2-4 players)' };
function renderSettingsButtons() {
  const modeText = gameId === 'ludo' ? (ludoMode === 'lock' ? 'Lock on the Stop' : 'Regular') : (MODE_NAME[gameMode] || 'Cut Throat (FFA)');
  const levelText = botLevel.charAt(0).toUpperCase() + botLevel.slice(1);
  $('qModeBtn').textContent = modeText; $('qLevelBtn').textContent = levelText;
  $('roomModeBtn').textContent = modeText; $('roomLevelBtn').textContent = levelText;
  $('roomThemeBtn').textContent = TH().n;
}
const MODE_ITEMS = [{ value: 'cutthroat', label: 'Cut Throat (FFA, 4 players)' }, { value: 'partners', label: 'Partners (2v2, 4 players)' }, { value: 'boneyard', label: 'Boneyard (2-4 players)' }];
const LEVEL_ITEMS = [{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }];
$('qModeBtn').onclick = () => openModal('Select Game Rules', MODE_ITEMS, gameMode, v => { gameMode = v; renderSettingsButtons(); });
$('roomModeBtn').onclick = () => {
  if (!isHost) return toast('Only the host can change the rules');
  if (gameId === 'ludo') return openModal('Select Ludo Rules', [{ value: 'regular', label: 'Regular' }, { value: 'lock', label: 'Lock on the Stop' }], ludoMode, v => { ludoMode = v; renderSettingsButtons(); syncRoomState(); });
  openModal('Select Game Rules', MODE_ITEMS, gameMode, v => { gameMode = v; renderSettingsButtons(); syncRoomState(); });
};
$('qLevelBtn').onclick = () => openModal('Select Bot Difficulty', LEVEL_ITEMS, botLevel, v => { botLevel = v; localStorage.setItem('xg_level', v); renderSettingsButtons(); });
$('roomLevelBtn').onclick = () => {
  if (!isHost) return toast('Only the host can change bot difficulty');
  openModal('Select Bot Difficulty', LEVEL_ITEMS, botLevel, v => { botLevel = v; localStorage.setItem('xg_level', v); renderSettingsButtons(); syncRoomState(); });
};
$('roomThemeBtn').onclick = () => openModal('Select Board Theme', Object.keys(THEMES).map(k => ({ value: k, label: THEMES[k].n })), themeKey, v => setTheme(v));

/* ---------- SOUND EFFECTS ---------- */
const AC = new (window.AudioContext || window.webkitAudioContext)();
const DEFAULTS = { musicOn: true, music: 70, sfxOn: true, sfx: 80, voice: 100, vibe: true, speed: 'normal' };
let settings = Object.assign({}, DEFAULTS, store.get('xg_settings') || {});
const musicBus = AC.createGain(), sfxBus = AC.createGain();
musicBus.connect(AC.destination); sfxBus.connect(AC.destination);
function applyAudio() {
  musicBus.gain.value = settings.musicOn ? settings.music / 100 : 0;
  sfxBus.gain.value = settings.sfxOn ? settings.sfx / 100 : 0;
  document.querySelectorAll('#audioBox audio').forEach(el => { el.volume = Math.min(1, settings.voice / 100); });
  $('musicBtn').textContent = settings.musicOn ? '🎵' : '🔕'; $('musicBtn').className = 'ib ' + (settings.musicOn ? 'blue' : 'red');
  $('sfxBtn').textContent = settings.sfxOn ? '🔊' : '🔇'; $('sfxBtn').className = 'ib ' + (settings.sfxOn ? 'blue' : 'red');
}
function saveSettings() { store.set('xg_settings', settings); applyAudio(); }

let bgTimer = null, bgStep = 0;
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33];
const BASS = [130.81, 174.61, 196.0, 164.81];
function bgNote(f, t, d, vol, type) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + d + 0.05);
}
function startAmbientLoop() {
  if (bgTimer || !settings.musicOn) return;
  bgStep = 0;
  bgTimer = setInterval(() => {
    if (!settings.musicOn) return;
    try {
      if (AC.state === 'suspended') { AC.resume(); return; }
      const t = AC.currentTime + 0.05, beat = bgStep % 16, bar = (bgStep >> 4) % 4;
      if (beat % 4 === 0) bgNote(BASS[bar], t, 1.6, 0.05, 'triangle');
      if (beat % 2 === 0 || Math.random() < 0.3) bgNote(PENTA[Math.floor(Math.random() * PENTA.length)] * (Math.random() < 0.25 ? 2 : 1), t, 0.9, 0.025, 'sine');
      bgStep++;
    } catch (e) {}
  }, 450);
}
function stopAmbientLoop() { clearInterval(bgTimer); bgTimer = null; }
function toggleMusic() {
  settings.musicOn = !settings.musicOn; saveSettings();
  if (settings.musicOn) startAmbientLoop(); else stopAmbientLoop();
  syncSettingsUI(); toast(settings.musicOn ? 'Music on' : 'Music off');
}
function toggleSfx() { settings.sfxOn = !settings.sfxOn; saveSettings(); syncSettingsUI(); toast(settings.sfxOn ? 'Sound effects on' : 'Sound effects off'); }
$('musicBtn').onclick = toggleMusic;
$('sfxBtn').onclick = toggleSfx;
const buzz = pat => { if (settings.vibe && navigator.vibrate) { try { navigator.vibrate(pat); } catch (e) {} } };

function tone(f1, f2, d, type, vol, delay = 0) {
  if (!settings.sfxOn) return;
  try {
    if (AC.state === 'suspended' || AC.state === 'interrupted') AC.resume();
    const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f1, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.01, t + d);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + d);
  } catch (e) {}
}
const clack = () => tone(480, 90, .05, 'sine', .5);
const slam = () => { tone(180, 20, .22, 'triangle', 1); tone(650, 110, .06, 'square', .7); shake(); buzz(40); };
const knock = () => { tone(240, 60, .04, 'sine', .6); tone(240, 60, .04, 'sine', .6, .09); };
const fanfare = () => { buzz([60, 40, 60]); [261.63, 329.63, 392, 523.25, 659.25].forEach((f, i) => tone(f, 0, .3, 'sine', .35, i * .09)); };
function shake() {
  const w = $('wrap'); w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake');
  setTimeout(() => w.classList.remove('shake'), 260);
}

/* ---------- HELPERS ---------- */
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200); }
const log = m => $('log').textContent = m;
const pick = (v, cur) => (v === undefined ? cur : v);
const isNewer = st => {
  const term = st.term || 0, version = st.version || 0;
  return term !== lastApplied.term ? term > lastApplied.term : version > lastApplied.version;
};
const gameHidden = () => $('game').classList.contains('hidden');
function ask(msg, yesLabel, fn) {
  $('cMsg').textContent = msg; $('cYes').textContent = yesLabel;
  $('confirm').classList.remove('hidden');
  $('cYes').onclick = () => { $('confirm').classList.add('hidden'); fn(); };
  $('cNo').onclick = () => $('confirm').classList.add('hidden');
}

/* ---------- STATE ---------- */
const NEXT = { N: 'W', W: 'S', S: 'E', E: 'N' };
const MATE = { S: 'N', N: 'S', W: 'E', E: 'W' };
let lobby = [], botN = 0, isHost = false, hostClientId = '', roomStatus = 'waiting';
let handNo = 1, sNS = 0, sWE = 0, lastWin = null, needD6 = true, openTile = null, bone = [];
let players = [], turn = 'S', L = null, R = null, center = null, lb = [], rb = [], passes = 0, active = false, epoch = 0, matchOver = false;
let passMiss = { S: new Set(), W: new Set(), N: new Set(), E: new Set() };
const byPos = p => players.find(x => x.pos === p);

/* ---------- PROFILE ---------- */
function initProfile() {
  if (!myNickname) { $('homeBox').classList.add('hidden'); $('profileBox').classList.remove('hidden'); }
  else { $('myNickDisplay').textContent = myNickname; $('profileBox').classList.add('hidden'); $('homeBox').classList.remove('hidden'); }
}
$('saveProfileBtn').onclick = () => {
  const v = stripName($('profileNameIn').value);
  if (!v) return toast('Please enter a nickname');
  myNickname = v; localStorage.setItem('xg_perm_nickname', v);
  $('myNickDisplay').textContent = v;
  $('profileBox').classList.add('hidden'); $('homeBox').classList.remove('hidden');
  toast('Profile saved!');
  const roomParam = new URLSearchParams(window.location.search).get('room');
  if (roomParam) joinRoomByCode(roomParam.toUpperCase());
};
$('editProfileBtn').onclick = openSettings;

/* ---------- OTHER GAMES ---------- */
let gameId = 'dominoes', ludoMode = 'regular', gs = null, frameReady = false, qGame = 'dominoes';
const fo = () => !$('gameFrame').classList.contains('hidden');
const toFrame = m => { const w = $('gf').contentWindow; if (w) w.postMessage(m, '*'); };
function openFrame(src) {
  frameReady = false;
  $('gameFrame').classList.remove('hidden');
}
function closeFrame() { $('gameFrame').classList.add('hidden'); $('gf').removeAttribute('srcdoc'); $('gf').src = 'about:blank'; frameReady = false; }

const CH = document.querySelectorAll('.gamechips .chip');
const cs = CH[2] && CH[2].querySelector('small'); if (cs) cs.remove();
[[0, 'dominoes'], [2, 'ludo']].forEach(([i, g]) => { CH[i].onclick = () => { if (!isHost) return toast('Only the host picks the game'); gameId = g; renderLobby(); syncRoomState(); }; });
$('qGameBtn').onclick = () => { qGame = qGame === 'ludo' ? 'dominoes' : 'ludo'; $('qGameBtn').textContent = 'Game: ' + (qGame === 'ludo' ? 'Ludo' : 'Dominoes'); };

/* ---------- ROOM SYNC ---------- */
function snapshot() {
  return { term: hostTerm, version: stateVersion, status: roomStatus, hostClientId, game: 'dominoes', botLevel, roomMessages, handNo, sNS, sWE, scores, gameMode, lastWin, needD6, openTile, bone, players, turn, L, R, center, lb, rb, passes, active, matchOver, lobby, gameId, ludoMode, gs };
}

async function syncRoomState() {
  if (!roomCode || !isHost) return;
  stateVersion++;
  if (roomSubscription) roomSubscription.send({ type: 'broadcast', event: 'STATE', payload: snapshot() });
  if (syncing) { syncDirty = true; return; }
  syncing = true;
  try {
    do {
      syncDirty = false;
      const { error: upErr } = await sb.from('game_rooms').upsert({ room_code: roomCode, status: roomStatus, state: snapshot(), updated_at: new Date().toISOString() }, { onConflict: 'room_code' });
      if (upErr) bugAdd('sync', upErr.message);
    } while (syncDirty);
  } catch (e) { console.error('Save failed', e); bugAdd('sync', e.message); }
  syncing = false;
}

function showLobbyView() {
  closeFrame();
  $('game').classList.add('hidden'); $('lobby').classList.remove('hidden');
  $('homeBox').classList.add('hidden'); $('roomPanel').classList.remove('hidden');
  renderLobby(); refresh();
}

function applyState(st, force) {
  if (!st) return;
  if (isHost && !force) return;
  if (!force && !isNewer(st)) return;
  lastApplied = { term: st.term || 0, version: st.version || 0 };

  roomStatus = pick(st.status, roomStatus);
  hostClientId = pick(st.hostClientId, hostClientId);
  if (['easy', 'medium', 'hard'].includes(st.botLevel)) botLevel = st.botLevel;
  handNo = pick(st.handNo, handNo); sNS = pick(st.sNS, sNS); sWE = pick(st.sWE, sWE);
  if (MODE_NAME[st.gameMode]) gameMode = st.gameMode;
  if (st.gameId) gameId = st.gameId;
  if (st.ludoMode) ludoMode = st.ludoMode;
  if (st.gs !== undefined && (!isHost || force)) gs = st.gs;
  if (st.scores) scores = st.scores;
  lastWin = pick(st.lastWin, lastWin); needD6 = pick(st.needD6, needD6); openTile = pick(st.openTile, openTile); bone = st.bone || [];
  if (st.players && st.players.length) players = st.players;
  turn = pick(st.turn, turn); L = pick(st.L, L); R = pick(st.R, R); center = pick(st.center, center);
  lb = st.lb || []; rb = st.rb || [];
  passes = pick(st.passes, passes); active = pick(st.active, active); matchOver = pick(st.matchOver, matchOver);

  if (Array.isArray(st.roomMessages)) {
    let changed = false;
    st.roomMessages.forEach(m => { if (validMsg(m) && addMsg(m)) { changed = true; onNewMsg(m); } });
    if (changed && chatOpen) renderChat();
  }
  chatReady = true;

  if (st.lobby) {
    lobby = st.lobby;
    const me = lobby.find(p => p.clientId === myClientId);
    if (me) { mySeatPos = me.pos || null; joinConfirmed = true; clearInterval(joinRetryTimer); }
    else if (joinConfirmed && !isHost) { leaveToHome('The host removed you from the table.'); return; }
    renderLobby();
  }

  if (roomStatus === 'playing' && gameId === 'ludo') {
    $('lobby').classList.add('hidden');
    if (!fo()) openFrame('ludo.html?net=1');
    else if (!isHost && frameReady && st.gs) toFrame({ t: 'state', g: st.gs });
  } else if (roomStatus === 'playing' && gameHidden()) {
    $('lobby').classList.add('hidden'); $('game').classList.remove('hidden');
  } else if (roomStatus === 'waiting' && (!gameHidden() || fo()) && roomCode) {
    showLobbyView(); return;
  }
  refresh();
  if (force) maybeAi();
}

async function fetchLatestState() {
  if (!roomCode) return;
  const { data } = await sb.from('game_rooms').select('state').eq('room_code', roomCode).maybeSingle();
  if (data && data.state) applyState(data.state);
}

function stopListening() {
  clearInterval(pollTimer); clearInterval(joinRetryTimer);
  if (roomSubscription) { sb.removeChannel(roomSubscription); roomSubscription = null; }
}

function listenToRoom() {
  stopListening();
  roomSubscription = sb.channel('room_' + roomCode, { config: { presence: { key: myClientId } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: 'room_code=eq.' + roomCode }, payload => {
      if (!isHost && payload.new) applyState(payload.new.state);
    })
    .on('broadcast', { event: 'STATE' }, ({ payload }) => {
      if (!isHost && payload && payload.hostClientId === hostClientId) applyState(payload);
    })
    .on('broadcast', { event: 'JOIN_EVENT' }, ({ payload }) => { if (isHost) handleJoin(payload); })
    .on('broadcast', { event: 'READY' }, ({ payload }) => { if (isHost) handleReady(payload); })
    .on('broadcast', { event: 'CHAT_MSG' }, ({ payload }) => handleChat(payload))
    .on('broadcast', { event: 'JOIN_DENIED' }, ({ payload }) => {
      if (payload && payload.clientId === myClientId) leaveToHome(payload.reason || 'The host could not seat you.');
    })
    .on('broadcast', { event: 'ROOM_CLOSED' }, () => { if (!isHost) leaveToHome('The host closed the room.'); })
    .on('broadcast', { event: 'ACTION_MOVE' }, ({ payload }) => { if (isHost) handleMove(payload); })
    .on('broadcast', { event: 'GAME_ACT' }, ({ payload }) => { if (isHost && payload) toFrame({ t: 'act', id: payload.clientId, a: payload.a }); })
    .subscribe(status => {
      if (status !== 'SUBSCRIBED') return;
      try { roomSubscription.track({ id: myClientId }); } catch (e) {}
      if (!isHost) { fetchLatestState(); startJoinRetry(); }
    });
  if (!isHost) pollTimer = setInterval(fetchLatestState, 3000);
}

function startJoinRetry() {
  clearInterval(joinRetryTimer);
  if (joinConfirmed) return;
  let tries = 0;
  const send = () => {
    if (joinConfirmed || !roomSubscription) { clearInterval(joinRetryTimer); return; }
    if (++tries > 12) { clearInterval(joinRetryTimer); toast("Couldn't reach the host. Ask them to keep the room open."); return; }
    roomSubscription.send({ type: 'broadcast', event: 'JOIN_EVENT', payload: { clientId: myClientId, name: myNickname, av: myAvatar, bio: myBio, link: myLink } });
  };
  send();
  joinRetryTimer = setInterval(send, 1500);
}

function denyJoin(clientId, reason) {
  if (roomSubscription) roomSubscription.send({ type: 'broadcast', event: 'JOIN_DENIED', payload: { clientId, reason } });
}

function handleJoin(g) {
  if (!g || typeof g.clientId !== 'string' || !ID_RE.test(g.clientId)) return;
  if (!lobby.some(p => p.clientId === g.clientId)) {
    if (roomStatus === 'playing') return denyJoin(g.clientId, 'That match has already started.');
    const seat = freeSeat();
    if (!seat || lobby.length >= MAX_ROOM) return denyJoin(g.clientId, 'The room is full.');
    const name = cleanName(g.name);
    lobby.push({ clientId: g.clientId, name, av: AVATARS.includes(g.av) ? g.av : '', isBot: false, pos: seat, isHost: false, ready: false, bio: stripBio(g.bio), link: cleanLink(g.link) });
    renderLobby(); toast(name + ' joined the table!');
  }
  syncRoomState();
}

function handleReady(g) {
  if (!g || typeof g.clientId !== 'string') return;
  const m = lobby.find(p => p.clientId === g.clientId && !p.isBot && p.clientId !== hostClientId);
  if (!m) return;
  m.ready = g.ready === true;
  renderLobby(); syncRoomState();
}

function handleMove(mv) {
  if (!isHost || !mv || !active) return;
  const cur = byPos(turn);
  if (!cur || cur.ai || cur.clientId !== mv.clientId) return;
  if (mv.type === 'PLAY') {
    if (!Number.isInteger(mv.index)) return;
    const t = cur.hand[mv.index];
    if (!t || !isValid(t)) return;
    if (!center) { if (mv.side !== 'first') return; }
    else if (mv.side === 'left') { if (!(t.a === L || t.b === L)) return; }
    else if (mv.side === 'right') { if (!(t.a === R || t.b === R)) return; }
    else return;
    play(mv.index, mv.side);
  } else if (mv.type === 'PASS') {
    if (center && (cur.hand.some(isValid) || bone.length)) return;
    pass();
  } else if (mv.type === 'DRAW') {
    if (!center || cur.hand.some(isValid) || !bone.length) return;
    drawFor(cur);
  }
}

/* ---------- HOME ---------- */
$('quickBtn').onclick = () => {
  if (!myNickname) return initProfile();
  if (qGame === 'ludo') { openFrame('ludo.html'); return; }
  if (AC.state === 'suspended') AC.resume();
  roomCode = ''; isHost = true; hostClientId = myClientId; mySeatPos = 'S'; joinConfirmed = true; roomStatus = 'playing';
  botN = 0;
  lobby = [{ clientId: myClientId, name: myNickname, av: myAvatar, bio: myBio, link: myLink, isBot: false, pos: 'S', isHost: true, ready: true }];
  const total = gameMode === 'boneyard' ? 2 : 4;
  ['W', 'N', 'E'].slice(0, total - 1).forEach(pos => { botN++; lobby.push({ clientId: 'bot_' + botN, name: 'XBot-' + botN, av: '🤖', isBot: true, pos, isHost: false, ready: true }); });
  $('roomBadge').textContent = 'Quick Play';
  $('homeBox').classList.add('hidden');
  startAmbientLoop();
  newMatch();
};

$('createBtn').onclick = async () => {
  if (!myNickname) return initProfile();
  const code = 'XG-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const myEntry = { clientId: myClientId, name: myNickname, av: myAvatar, bio: myBio, link: myLink, isBot: false, pos: 'S', isHost: true, ready: true };
  scores = { S: 0, W: 0, N: 0, E: 0 };

  const { error } = await sb.from('game_rooms').insert([{
    room_code: code, status: 'waiting',
    state: { term: 0, version: 0, status: 'waiting', hostClientId: myClientId, game: 'dominoes', botLevel, lobby: [myEntry], handNo: 1, sNS: 0, sWE: 0, gameMode, scores }
  }]);
  if (error) { console.error(error); bugAdd('create', (error.code ? error.code + ': ' : '') + error.message); toast('Create failed: ' + String(error.message).slice(0, 80)); return; }

  roomCode = code; isHost = true; hostClientId = myClientId; mySeatPos = 'S'; roomStatus = 'waiting';
  joinConfirmed = true; hostTerm = 0; stateVersion = 0; lastApplied = { term: -1, version: -1 };
  lobby = [myEntry];
  $('roomBadge').textContent = 'Room: ' + roomCode; $('codeBig').textContent = roomCode;
  $('homeBox').classList.add('hidden'); $('roomPanel').classList.remove('hidden');
  renderLobby(); refresh(); saveSession(); startAmbientLoop();
  toast('Room ' + roomCode + ' created!');
  listenToRoom();
};

$('joinBtn').onclick = () => {
  if (!myNickname) return initProfile();
  const code = $('codeIn').value.trim().toUpperCase();
  if (!code) return toast('Enter a room code');
  joinRoomByCode(code);
};

async function joinRoomByCode(code) {
  if (!myNickname) return initProfile();
  const { data, error } = await sb.from('game_rooms').select('state, status').eq('room_code', code).maybeSingle();
  if (error || !data || !data.state) return toast('Room not found');

  roomCode = code; roomStatus = data.status || 'waiting';
  hostClientId = data.state.hostClientId || '';
  isHost = (hostClientId === myClientId);
  joinConfirmed = false; lastApplied = { term: -1, version: -1 };

  if (!isHost && !(data.state.lobby || []).some(p => p.clientId === myClientId) && (data.state.lobby || []).length >= MAX_ROOM) {
    roomCode = ''; return toast('That room is full');
  }

  $('roomBadge').textContent = 'Room: ' + roomCode; $('codeBig').textContent = roomCode;
  $('homeBox').classList.add('hidden'); $('roomPanel').classList.remove('hidden');

  if (isHost) { hostTerm = (data.state.term || 0) + 1; stateVersion = 0; }
  applyState(data.state, isHost);
  renderLobby(); refresh(); saveSession(); startAmbientLoop();
  listenToRoom();
  if (isHost) syncRoomState();
}

$('copyBtn').onclick = () => {
  if (navigator.clipboard) navigator.clipboard.writeText(roomCode).then(() => toast('Code copied!'));
  else toast('Code: ' + roomCode);
};

$('shareBtn').onclick = () => {
  const joinUrl = window.location.origin + window.location.pathname + '?room=' + roomCode;
  if (navigator.share) navigator.share({ title: 'Xgames Arcade', text: 'Join my table! Room Code: ' + roomCode, url: joinUrl }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(joinUrl).then(() => toast('Invite link copied!'));
  else toast(joinUrl);
};

async function leaveToHome(message) {
  closeFrame(); gs = null; gameId = 'dominoes';
  clearSession(); stopAmbientLoop();
  epoch++; active = false;
  if (isHost && roomSubscription) {
    try { await roomSubscription.send({ type: 'broadcast', event: 'ROOM_CLOSED', payload: {} }); } catch (e) {}
  }
  stopListening(); disconnectVoice();
  lobby = []; players = []; roomCode = ''; isHost = false; hostClientId = ''; joinConfirmed = false;
  lastApplied = { term: -1, version: -1 }; hostTerm = 0; stateVersion = 0; roomStatus = 'waiting'; matchOver = false;
  center = null; lb = []; rb = []; L = R = null; botN = 0; speaking = new Set();
  roomMessages = []; unread = 0; chatReady = false; closeChat(); updateChatBadge();
  scores = { S: 0, W: 0, N: 0, E: 0 };
  $('roomBadge').textContent = 'No room yet';
  $('game').classList.add('hidden'); $('roomPanel').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  window.history.replaceState({}, document.title, window.location.pathname);
  initProfile(); refresh();
  if (message) toast(message);
}
function leaveOrConfirm() {
  if (roomCode || !gameHidden()) ask('Leave and go back to the main menu?', 'Leave', () => leaveToHome());
  else leaveToHome();
}
$('leaveBtn').onclick = leaveOrConfirm;
$('hubBtn').onclick = leaveOrConfirm;

$('exitBtn').onclick = () => {
  if (!roomCode) ask('Leave this game and go back to the main menu?', 'Leave', () => leaveToHome());
  else if (isHost) ask('Send everyone back to the room? This match will end.', 'Back to room', backToRoom);
  else ask('Leave the room?', 'Leave', () => leaveToHome());
};

function backToRoom() {
  if (!isHost) return;
  if (!roomCode) return leaveToHome();
  closeFrame(); gs = null;
  epoch++; active = false; matchOver = false; roomStatus = 'waiting';
  lobby.forEach(p => { p.ready = p.isBot || p.clientId === hostClientId; });
  showLobbyView(); syncRoomState();
}
$('roomBtn').onclick = backToRoom;

$('botBtn').onclick = () => {
  if (!isHost) return toast('Only host can add bots');
  if (lobby.length >= MAX_ROOM) return toast('Room is full');
  const freePos = freeSeat();
  if (!freePos) return toast('No free seat. Remove a player or bot first.');
  botN++;
  lobby.push({ clientId: 'bot_' + botN, name: 'XBot-' + botN, isBot: true, av: '🤖', pos: freePos, isHost: false, ready: true });
  renderLobby(); syncRoomState();
};

$('readyBtn').onclick = () => {
  const me = lobby.find(p => p.clientId === myClientId);
  if (!me || !roomSubscription || isHost) return;
  me.ready = !me.ready; renderLobby();
  roomSubscription.send({ type: 'broadcast', event: 'READY', payload: { clientId: myClientId, ready: me.ready } });
};

function toggleMutePlayer(targetClientId) {
  const el = $('audio_' + targetClientId);
  if (mutedPlayers.has(targetClientId)) { mutedPlayers.delete(targetClientId); if (el) el.muted = false; toast('Unmuted player'); }
  else { mutedPlayers.add(targetClientId); if (el) el.muted = true; toast('Muted player locally'); }
  renderLobby(); refresh();
}

const freeSeat = () => ['S', 'W', 'N', 'E'].find(pos => !lobby.some(p => p.pos === pos));

function renderLobby() {
  const list = $('plist'); list.innerHTML = '';
  lobby.forEach(p => {
    const isPlayerHost = p.clientId === hostClientId, isMe = p.clientId === myClientId;
    const row = document.createElement('div'); row.className = 'pl' + (speaking.has(p.clientId) ? ' speaking' : '');
    row.style.cssText = 'cursor:pointer;min-height:44px';
    row.addEventListener('click', () => playerMenu(p, false));
    const nameEl = document.createElement('span'); nameEl.textContent = (p.av ? p.av + ' ' : '') + (mutedPlayers.has(p.clientId) ? '🔇 ' : '') + p.name;
    const right = document.createElement('span');
    const tags = [[p.isBot ? 'BOT' : (isPlayerHost ? 'HOST' : 'PLAYER'), p.isBot ? 'bot' : (isPlayerHost ? 'host' : '')]];
    if (!p.isBot) tags.push(p.ready ? ['READY', 'ok'] : ['WAITING', 'wait']);
    if (isMe) tags.push(['YOU', 'you']);
    tags.forEach(([t, c], i) => {
      if (i) right.appendChild(document.createTextNode(' '));
      const el = document.createElement('span'); el.className = 'tag ' + c; el.textContent = t; right.appendChild(el);
    });
    row.appendChild(nameEl); row.appendChild(right); list.appendChild(row);
  });

  const me = lobby.find(p => p.clientId === myClientId);
  $('pc').textContent = lobby.length;
  $('startBtn').textContent = gameId === 'ludo' ? '▶ Start Ludo' : '▶ Start Yard Dominoes';
  CH.forEach((c, i) => c.classList.toggle('on', (i === 0 && gameId === 'dominoes') || (i === 2 && gameId === 'ludo')));
  $('startBtn').classList.toggle('hidden', !isHost);
  $('botBtn').classList.toggle('hidden', !isHost);
  $('guestWaitMsg').classList.toggle('hidden', isHost);
  $('readyBtn').textContent = me && me.ready ? '✅ Ready (tap to cancel)' : 'Tap when you are ready';
  $('readyBtn').className = (me && me.ready ? 'green' : 'blue') + (isHost ? ' hidden' : '');
  const need = needPlayersMsg();
  $('needMsg').textContent = need; $('needMsg').classList.toggle('hidden', !need);
  renderSettingsButtons();
}

function needPlayersMsg() {
  const n = lobby.length;
  if (gameId === 'ludo') return n < 2 ? 'Ludo needs at least 2 players. Invite a friend or tap 🤖 +Bot.' : '';
  if (gameMode === 'boneyard') return n < 2 ? 'Boneyard needs at least 2 players. Invite a friend or tap 🤖 +Bot.' : '';
  return n < 4 ? 'This mode needs 4 players (' + (4 - n) + ' more). Invite friends, tap 🤖 +Bot, or switch to Boneyard.' : '';
}
$('startBtn').onclick = () => {
  if (!isHost) return toast('Only host can start');
  const waiting = lobby.filter(p => !p.isBot && p.pos && !p.ready);
  if (waiting.length) return toast(waiting.map(p => p.name).join(', ') + ' not ready yet');
  const need = needPlayersMsg();
  if (need) return toast(need);
  roomStatus = 'playing';
  if (gameId === 'ludo') { gs = null; $('lobby').classList.add('hidden'); openFrame('ludo.html?net=1'); syncRoomState(); return; }
  newMatch();
};

/* ---------- VOICE ---------- */
async function connectVoice() {
  if (livekitRoom) return true;
  if (!window.LivekitClient) { toast('Voice failed to load. Refresh and try again.'); return false; }
  if (!roomCode) { toast('Join a room first'); return false; }
  const { data, error } = await sb.functions.invoke('livekit-token', { body: { roomCode, clientId: myClientId, name: myNickname } });
  if (error || !data || !data.token) { console.error('Voice token error', error, data); toast('Voice token error. Check Supabase setup.'); return false; }

  const room = new LivekitClient.Room({
    adaptiveStream: true, dynacast: true,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind === 'audio') {
      const el = track.attach();
      el.id = 'audio_' + participant.identity; el.autoplay = true; el.playsInline = true;
      el.volume = Math.min(1, settings.voice / 100);
      if (mutedPlayers.has(participant.identity)) el.muted = true;
      $('audioBox').appendChild(el);
    }
  });
  room.on(LivekitClient.RoomEvent.TrackUnsubscribed, track => { track.detach().forEach(el => el.remove()); });
  room.on(LivekitClient.RoomEvent.ActiveSpeakersChanged, sp => {
    speaking = new Set(sp.map(s => s.identity));
    if (gameHidden()) renderLobby(); else renderOutsideSeats();
  });
  room.on(LivekitClient.RoomEvent.Disconnected, () => {
    if (livekitRoom === room) { livekitRoom = null; micActive = false; updateMicUI(false, true); }
  });
  await room.connect(LIVEKIT_URL, data.token);
  try { await room.startAudio(); } catch (e) { console.log('Audio autoplay prompt needed'); }
  livekitRoom = room;
  return true;
}

function disconnectVoice() {
  const r = livekitRoom; livekitRoom = null; speaking = new Set();
  if (r) { try { r.disconnect(); } catch (e) {} }
  $('audioBox').innerHTML = '';
  if (micActive) { micActive = false; updateMicUI(false, true); }
}

$('micBtn').onclick = async () => {
  if (AC.state === 'suspended') AC.resume();
  const wantOn = !micActive;
  $('micBtn').disabled = true;
  try {
    if (wantOn) {
      if (!(await connectVoice())) return;
      await livekitRoom.localParticipant.setMicrophoneEnabled(true);
      micActive = true;
    } else if (livekitRoom) {
      await livekitRoom.localParticipant.setMicrophoneEnabled(false);
      livekitRoom.localParticipant.audioTrackPublications.forEach(pub => { if (pub.track) pub.track.stop(); });
      micActive = false;
    }
    updateMicUI(micActive);
  } catch (e) {
    console.error('Voice error', e); toast('Mic blocked or voice failed. Check mic permission.');
  } finally { $('micBtn').disabled = false; }
};

function updateMicUI(on, silent) {
  const btn = $('micBtn'), dot = $('micDot');
  $('gfMic').textContent = on ? '🎙️ Live' : '🎙️';
  if (on) { btn.textContent = '🎙️ Live'; btn.className = 'red'; dot.classList.add('active'); if (!silent) toast('Microphone ON'); }
  else { btn.textContent = '🎙️ Off'; btn.className = 'blue'; dot.classList.remove('active'); if (!silent) toast('Microphone OFF'); }
}

/* ---------- PLAYER MENU ---------- */
function playerMenu(p, inGame) {
  if (!p) return;
  const isMe = p.clientId === myClientId, items = [];
  const bio = isMe ? myBio : p.bio, link = isMe ? myLink : p.link;
  if (bio) items.push({ value: 'bio', label: '📝 ' + bio });
  if (link) items.push({ value: 'link', label: '🔗 Open link' });
  if (!isMe && !p.isBot) items.push({ value: 'mute', label: mutedPlayers.has(p.clientId) ? '🔊 Unmute ' + p.name : '🔇 Mute ' + p.name });
  if (isHost && !isMe && !inGame && roomStatus === 'waiting') {
    items.push({ value: 'kick', label: '🚪 Remove from room' });
  }
  if (!items.length) return toast(p.name + (isMe ? ' (you)' : ''));
  openModal(p.name, items, null, v => {
    if (v === 'mute') toggleMutePlayer(p.clientId);
    else if (v === 'kick') { lobby = lobby.filter(x => x.clientId !== p.clientId); renderLobby(); syncRoomState(); }
    else if (v === 'link') window.open(link, '_blank', 'noopener,noreferrer');
  });
}

/* ---------- ROOM CHAT ---------- */
const stripText = t => String(t || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 200);
function validMsg(m) {
  return !!m && typeof m.id === 'string' && m.id.length < 60 && typeof m.from === 'string' && typeof m.name === 'string' && typeof m.text === 'string' && Number.isFinite(m.ts);
}
function addMsg(m) {
  if (roomMessages.some(x => x.id === m.id)) return false;
  roomMessages.push({ id: m.id, from: m.from, name: stripName(m.name) || 'Player', text: stripText(m.text), ts: m.ts });
  roomMessages.sort((a, b) => a.ts - b.ts);
  if (roomMessages.length > 60) roomMessages = roomMessages.slice(-60);
  return true;
}
function updateChatBadge() { const b = $('chatBadge'); b.textContent = unread > 9 ? '9+' : String(unread); b.classList.toggle('hidden', unread === 0); }
function onNewMsg(m) { if (!chatReady || chatOpen || m.from === myClientId) return; unread++; updateChatBadge(); }
function renderChat() {
  const list = $('chatList'); list.innerHTML = '';
  roomMessages.forEach(m => {
    const d = document.createElement('div'); d.className = 'msg' + (m.from === myClientId ? ' me' : '');
    const n = document.createElement('b'); n.textContent = m.from === myClientId ? 'You' : m.name;
    const t = document.createElement('span'); t.textContent = m.text;
    d.appendChild(n); d.appendChild(t); list.appendChild(d);
  });
  list.scrollTop = list.scrollHeight;
}
function openChat() { chatOpen = true; unread = 0; updateChatBadge(); $('chatSheet').classList.remove('hidden'); $('chatFab').classList.add('hidden'); renderChat(); }
function closeChat() { chatOpen = false; $('chatSheet').classList.add('hidden'); $('chatFab').classList.toggle('hidden', !roomCode); }
let lastSend = 0;
function sendChat() {
  const text = stripText($('chatInput').value);
  if (!text || !roomCode) return;
  if (Date.now() - lastSend < 700) return toast('Slow down a little');
  lastSend = Date.now();
  const m = { id: myClientId + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), from: myClientId, name: myNickname, text, ts: Date.now() };
  $('chatInput').value = '';
  addMsg(m); renderChat();
  if (roomSubscription) roomSubscription.send({ type: 'broadcast', event: 'CHAT_MSG', payload: m });
  if (isHost) syncRoomState();
}
function handleChat(m) {
  if (!validMsg(m)) return;
  const who = lobby.find(p => p.clientId === m.from && !p.isBot);
  if (!who || who.clientId === myClientId) return;
  if (isHost) {
    const now = Date.now(), hits = (chatHits[who.clientId] || []).filter(t => now - t < 5000);
    if (hits.length >= 6) return;
    hits.push(now); chatHits[who.clientId] = hits;
  }
  const clean = { id: m.id, from: who.clientId, name: who.name, text: stripText(m.text), ts: m.ts };
  if (!clean.text || !addMsg(clean)) return;
  onNewMsg(clean); if (chatOpen) renderChat();
  if (isHost) syncRoomState();
}
$('chatFab').onclick = openChat; $('chatClose').onclick = closeChat; $('chatSend').onclick = sendChat;
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

/* ---------- SETTINGS + PROFILE PAGE ---------- */
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
function getStats() { return Object.assign({ played: 0, won: 0, streak: 0, best: 0 }, store.get('xg_stats') || {}); }
function recordResult(won) {
  const st = getStats(); st.played++;
  if (won) { st.won++; st.streak++; st.best = Math.max(st.best, st.streak); } else st.streak = 0;
  store.set('xg_stats', st);
}
function renderStats() {
  const st = getStats(), box = $('statsBox'); box.innerHTML = '';
  [['🎮 Matches played', st.played], ['🏆 Matches won', st.won], ['📈 Win rate', st.played ? Math.round(100 * st.won / st.played) + '%' : '-'], ['🔥 Win streak', st.streak], ['⭐ Best streak', st.best]].forEach(([a, b]) => {
    const row = document.createElement('div'); row.className = 'stat';
    const l = document.createElement('span'); l.textContent = a; const r = document.createElement('b'); r.textContent = String(b);
    row.appendChild(l); row.appendChild(r); box.appendChild(row);
  });
}
function buildAvatars() {
  const g = $('avGrid'); g.innerHTML = '';
  AVATARS.forEach(a => {
    const b = document.createElement('button'); b.className = 'avb' + (a === myAvatar ? ' on' : ''); b.textContent = a;
    b.onclick = () => { myAvatar = a; localStorage.setItem('xg_avatar', a); buildAvatars(); };
    g.appendChild(b);
  });
}
function syncSettingsUI() {
  $('musicVol').value = settings.music; $('sfxVol').value = settings.sfx; $('voiceVol').value = settings.voice;
  $('musicTog').textContent = settings.musicOn ? '🎵' : '🔕'; $('musicTog').className = 'ib ' + (settings.musicOn ? 'blue' : 'red');
  $('sfxTog').textContent = settings.sfxOn ? '🔊' : '🔇'; $('sfxTog').className = 'ib ' + (settings.sfxOn ? 'blue' : 'red');
  $('vibeTog').textContent = settings.vibe ? 'On' : 'Off'; $('vibeTog').className = 'ib ' + (settings.vibe ? 'blue' : 'red');
  $('speedBtn').textContent = cap(settings.speed); $('setLevelBtn').textContent = cap(botLevel); $('setThemeBtn').textContent = TH().n;
}
function openSettings() { $('setNick').value = myNickname; $('setBio').value = myBio; $('setLink').value = myLink; buildAvatars(); renderStats(); syncSettingsUI(); $('settingsPage').classList.remove('hidden'); }
$('setBtn').onclick = openSettings;
$('setClose').onclick = () => $('settingsPage').classList.add('hidden');
$('setSave').onclick = () => {
  const v = stripName($('setNick').value);
  if (!v) return toast('Please enter a nickname');
  const rawLink = $('setLink').value.trim(), link = cleanLink(rawLink);
  if (rawLink && !link) return toast('Link must start with https://');
  myBio = stripBio($('setBio').value); myLink = link;
  localStorage.setItem('xg_bio', myBio); localStorage.setItem('xg_link', myLink);
  myNickname = v; localStorage.setItem('xg_perm_nickname', v); $('myNickDisplay').textContent = v;
  toast('Profile saved! Your name updates in the next room you join.');
};
$('musicVol').oninput = () => { settings.music = +$('musicVol').value; saveSettings(); };
$('sfxVol').oninput = () => { settings.sfx = +$('sfxVol').value; saveSettings(); };
$('sfxVol').onchange = () => { clack(); };
$('voiceVol').oninput = () => { settings.voice = +$('voiceVol').value; saveSettings(); };
$('musicTog').onclick = toggleMusic;
$('sfxTog').onclick = toggleSfx;
$('vibeTog').onclick = () => { settings.vibe = !settings.vibe; saveSettings(); syncSettingsUI(); buzz(30); };
$('speedBtn').onclick = () => openModal('Bot speed', [{ value: 'fast', label: 'Fast' }, { value: 'normal', label: 'Normal' }, { value: 'slow', label: 'Slow' }], settings.speed, v => { settings.speed = v; saveSettings(); syncSettingsUI(); });
$('setLevelBtn').onclick = () => openModal('Select Bot Difficulty', LEVEL_ITEMS, botLevel, v => { botLevel = v; localStorage.setItem('xg_level', v); renderSettingsButtons(); syncSettingsUI(); if (isHost && roomCode) syncRoomState(); });
$('setThemeBtn').onclick = () => openModal('Select Board Theme', Object.keys(THEMES).map(k => ({ value: k, label: THEMES[k].n })), themeKey, v => { setTheme(v); syncSettingsUI(); });

/* ---------- RESUME / RECONNECT ---------- */
async function resumeSession() {
  const s = store.get(SESSION_KEY);
  if (!s || !s.roomCode || !myNickname) return false;
  if (Date.now() - s.savedAt > MAX_SESSION_AGE) { clearSession(); return false; }
  const { data } = await sb.from('game_rooms').select('updated_at').eq('room_code', s.roomCode).maybeSingle();
  if (!data || Date.now() - Date.parse(data.updated_at) > MAX_SESSION_AGE) { clearSession(); return false; }
  await joinRoomByCode(s.roomCode);
  return true;
}
async function reconnect() {
  if (!roomCode) return;
  if (!roomSubscription || roomSubscription.state !== 'joined') listenToRoom();
  if (isHost) syncRoomState(); else await fetchLatestState();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reconnect(); });
window.addEventListener('online', reconnect);

window.addEventListener('load', async () => {
  applyAudio(); initProfile(); setTheme(themeKey);
  const roomParam = (new URLSearchParams(window.location.search).get('room') || '').toUpperCase();
  if (roomParam && /^XG-[A-Z0-9]{3,8}$/.test(roomParam) && myNickname) { $('codeIn').value = roomParam; joinRoomByCode(roomParam); }
  else if (myNickname) await resumeSession();
});

/* ---------- GAME CORE (Dominoes) ---------- */
function fullSet() {
  const t = [];
  for (let i = 0; i <= 6; i++) for (let j = i; j <= 6; j++) t.push({ a: i, b: j, d: i === j });
  for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
  return t;
}

function newMatch() {
  $('lobby').classList.add('hidden'); $('game').classList.remove('hidden');
  sNS = 0; sWE = 0; scores = { S: 0, W: 0, N: 0, E: 0 }; handNo = 1; lastWin = null; matchOver = false;
  newHand();
}

function seatsInPlay() { return ['S', 'W', 'N', 'E'].filter(pos => lobby.some(l => l.pos === pos)); }
function nextSeat(pos) {
  const present = ['S', 'E', 'N', 'W'].filter(q => players.some(p => p.pos === q));
  return present[(present.indexOf(pos) + 1) % present.length];
}

function newHand() {
  epoch++;
  passMiss = { S: new Set(), W: new Set(), N: new Set(), E: new Set() };
  const deck = fullSet(), seats = seatsInPlay();
  players = seats.map((pos, i) => {
    const o = lobby.find(l => l.pos === pos);
    return { clientId: o.clientId, name: o.name, pos, av: o.av || '', hand: deck.slice(i * 7, i * 7 + 7), ai: o.isBot };
  });
  bone = deck.slice(seats.length * 7);
  center = null; L = R = null; lb = []; rb = []; passes = 0; active = true;
  needD6 = lastWin === null;
  if (needD6) {
    let best = null;
    players.forEach(p => p.hand.forEach(t => { const k = t.d ? 100 + t.a : t.a + t.b; if (!best || k > best.k) best = { k, pos: p.pos, a: t.a, b: t.b }; }));
    openTile = { a: best.a, b: best.b }; turn = best.pos;
    log(byPos(turn).name + ' holds the highest tile and poses first [' + best.a + '|' + best.b + '].');
  } else { openTile = null; turn = lastWin; log('Hand ' + handNo + ': ' + byPos(turn).name + ' poses first.'); }
  refresh(); syncRoomState(); maybeAi();
}

function isValid(t) {
  if (!center) return needD6 ? (!!openTile && t.a === openTile.a && t.b === openTile.b) : true;
  return t.a === L || t.b === L || t.a === R || t.b === R;
}

function play(i, side) {
  if (!isHost) {
    if (roomSubscription) roomSubscription.send({ type: 'broadcast', event: 'ACTION_MOVE', payload: { type: 'PLAY', index: i, side, clientId: myClientId } });
    return;
  }
  const p = byPos(turn), t = p.hand.splice(i, 1)[0]; passes = 0;
  if (side === 'first') { center = { a: t.a, b: t.b, d: t.d }; L = t.a; R = t.b; }
  else if (side === 'left') { const o = t.a === L ? { a: t.a, b: t.b, d: t.d } : { a: t.b, b: t.a, d: t.d }; L = o.b; lb.push(o); }
  else { const o = t.a === R ? { a: t.a, b: t.b, d: t.d } : { a: t.b, b: t.a, d: t.d }; R = o.b; rb.push(o); }
  (t.d || !p.hand.length) ? slam() : clack();
  log('💥 ' + p.name + ' slammed [' + t.a + '|' + t.b + ']');
  if (!p.hand.length) return win(p.pos, p.name + ' went out!');
  next();
}

function pass() {
  if (!isHost) {
    if (roomSubscription) roomSubscription.send({ type: 'broadcast', event: 'ACTION_MOVE', payload: { type: 'PASS', clientId: myClientId } });
    return;
  }
  const p = byPos(turn); passes++; knock();
  if (center) { passMiss[p.pos].add(L); passMiss[p.pos].add(R); }
  log('✋ ' + p.name + ' knocked (passed).');
  if (passes >= players.length) return blocked();
  next();
}

function next() { turn = nextSeat(turn); refresh(); syncRoomState(); maybeAi(); }

function drawFor(p) {
  const t = bone.pop(); p.hand.push(t); clack();
  log('🦴 ' + p.name + ' drew from the boneyard (' + bone.length + ' left).');
  refresh(); syncRoomState(); maybeAi();
}

function maybeAi() {
  if (!isHost) return;
  const e = epoch, cur = byPos(turn);
  if (active && cur && cur.ai) setTimeout(() => { if (e === epoch && active) aiTurn(); }, ({ fast: 500, normal: 900, slow: 1400 })[settings.speed] || 900);
}

function aiTurn() {
  const p = byPos(turn);
  if (!p) return;
  const opts = [];
  p.hand.forEach((t, i) => {
    if (!isValid(t)) return;
    if (!center) opts.push({ i, side: 'first', t });
    else {
      if (t.a === L || t.b === L) opts.push({ i, side: 'left', t });
      if (t.a === R || t.b === R) opts.push({ i, side: 'right', t });
    }
  });
  if (!opts.length) { if (center && bone.length) return drawFor(p); return pass(); }
  let best;
  if (botLevel === 'easy') best = opts[Math.floor(Math.random() * opts.length)];
  else if (botLevel === 'hard') best = hardPick(p, opts);
  else { opts.forEach(o => { o.s = o.t.a + o.t.b + (Math.random() - .5) * 3; }); best = opts.sort((x, y) => y.s - x.s)[0]; }
  play(best.i, best.side);
}

function hardPick(p, opts) {
  const mate = gameMode === 'partners' ? MATE[p.pos] : null;
  let bestScore = -1e9, best = opts[0];
  opts.forEach(o => {
    const t = o.t; let nl = L, nr = R;
    if (o.side === 'first') { nl = t.a; nr = t.b; }
    else if (o.side === 'left') nl = t.a === L ? t.b : t.a;
    else nr = t.a === R ? t.b : t.a;
    const rest = p.hand.filter((_, k) => k !== o.i);
    let s = (t.a + t.b) * 1.2 + (t.d ? 2 : 0);
    s += rest.filter(x => x.a === nl || x.b === nl || x.a === nr || x.b === nr).length * 2.5;
    ['S', 'W', 'N', 'E'].forEach(q => {
      if (q === p.pos) return;
      const m = passMiss[q], hit = (m.has(nl) ? 1 : 0) + (m.has(nr) ? 1 : 0);
      s += (q === mate ? -5 : 4) * hit;
    });
    if (!rest.length) s += 100;
    s += Math.random();
    if (s > bestScore) { bestScore = s; best = o; }
  });
  return best;
}

function blocked() {
  const pScores = {};
  players.forEach(p => { pScores[p.pos] = p.hand.reduce((a, t) => a + t.a + t.b, 0); });
  const tie = () => {
    active = false; log('🤝 Blocked and tied. Replaying hand.'); const e = epoch; syncRoomState();
    setTimeout(() => { if (e === epoch) { handNo++; newHand(); } }, 3000);
  };
  if (gameMode === 'partners') {
    const ns = pScores.N + pScores.S, we = pScores.W + pScores.E;
    if (ns < we) win('S', 'Blocked! N/S win (' + ns + ' vs ' + we + ' pips)');
    else if (we < ns) win('E', 'Blocked! E/W win (' + we + ' vs ' + ns + ' pips)');
    else tie();
  } else {
    const sorted = Object.keys(pScores).sort((a, b) => pScores[a] - pScores[b]);
    if (pScores[sorted[0]] < pScores[sorted[1]]) win(sorted[0], 'Blocked! ' + byPos(sorted[0]).name + ' wins (' + pScores[sorted[0]] + ' pips)');
    else tie();
  }
}

function win(pos, why) {
  fanfare(); active = false; lastWin = pos;
  if (gameMode === 'partners') {
    const ns = pos === 'N' || pos === 'S';
    if (ns) { if (sWE > 0 && sNS === 0) { toast('BREAK! Score reset to 0-0'); sWE = 0; } sNS++; }
    else { if (sNS > 0 && sWE === 0) { toast('BREAK! Score reset to 0-0'); sNS = 0; } sWE++; }
    log('🎉 ' + why);
    if (sNS >= 6 || sWE >= 6) {
      matchOver = true; log('🏆 Match over: Team ' + (sNS >= 6 ? 'N/S' : 'E/W') + ' wins six love!');
      refresh(); syncRoomState(); return;
    }
  } else {
    scores[pos] = (scores[pos] || 0) + 1;
    log('🎉 ' + why);
    if (scores[pos] >= 6) {
      matchOver = true; log('🏆 Match over: ' + byPos(pos).name + ' wins six love!');
      refresh(); syncRoomState(); return;
    }
  }
  refresh(); syncRoomState(); const e = epoch;
  setTimeout(() => { if (e === epoch) { handNo++; newHand(); } }, 3500);
}

/* ---------- HAND UI ---------- */
let selIdx = null;
function selectTile(i) {
  if (!active || turn !== mySeatPos) return toast('Not your turn');
  const me = byPos(mySeatPos);
  if (!me || !me.hand) return;
  const t = me.hand[i];
  if (!isValid(t)) return toast(!center && needD6 ? 'Hand 1 must start with [' + (openTile ? openTile.a + '|' + openTile.b : '6|6') + ']' : "That tile doesn't fit");
  if (!center) return play(i, 'first');
  const ml = t.a === L || t.b === L, mr = t.a === R || t.b === R;
  if (ml && mr) {
    selIdx = i; $('lv').textContent = L; $('rv').textContent = R; $('endBar').classList.remove('hidden');
    $('goL').onclick = () => { selIdx = null; play(i, 'left'); };
    $('goR').onclick = () => { selIdx = null; play(i, 'right'); };
    renderHand();
  } else play(i, ml ? 'left' : 'right');
}
$('passBtn').onclick = () => { if (active && turn === mySeatPos) pass(); };
$('drawBtn').onclick = () => {
  if (!active || turn !== mySeatPos) return;
  if (isHost) { const me = byPos(mySeatPos); if (me && center && !me.hand.some(isValid) && bone.length) drawFor(me); }
  else if (roomSubscription) roomSubscription.send({ type: 'broadcast', event: 'ACTION_MOVE', payload: { type: 'DRAW', clientId: myClientId } });
};

function renderHand() {
  const box = $('hand'); box.innerHTML = '';
  const me = byPos(mySeatPos);
  if (!me || !me.hand) { $('passBtn').classList.add('hidden'); $('drawBtn').classList.add('hidden'); $('endBar').classList.add('hidden'); return; }
  const mine = active && turn === mySeatPos;
  me.hand.forEach((t, i) => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 68;
    const x = c.getContext('2d'); x.setTransform(2, 0, 0, 2, 0, 0);
    drawTile(x, 30, 17, t.a, t.b, false, 1.3, false);
    if (mine && center && !isValid(t)) c.className = 'dim';
    if (selIdx === i) c.className = 'sel';
    c.onclick = () => selectTile(i);
    box.appendChild(c);
  });
  const canMove = me.hand.some(isValid);
  $('passBtn').classList.toggle('hidden', !(mine && center && !canMove && !bone.length));
  $('drawBtn').classList.toggle('hidden', !(mine && center && !canMove && bone.length > 0));
  $('drawBtn').textContent = '🦴 Draw (' + bone.length + ' left)';
  if (!(mine && selIdx !== null)) $('endBar').classList.add('hidden');
}

/* ---------- CANVAS BOARD ---------- */
const cv = $('board'), ctx = cv.getContext('2d');
const W = 400, H = 360, MARGIN = 30, CY = 180;
const PIPS = { 0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function pips(c, x, y, w, h, n, s) {
  c.fillStyle = TH().pip;
  PIPS[n].forEach(i => { c.beginPath(); c.arc(x + w * (0.2 + 0.3 * (i % 3)), y + h * (0.2 + 0.3 * ((i / 3) | 0)), 1.8 * s, 0, 7); c.fill(); });
}

function drawTile(c, x, y, a, b, vert, s, flip) {
  s = s || 1;
  const w = vert ? 20 * s : 40 * s, h = vert ? 40 * s : 20 * s, th = TH();
  c.save(); c.translate(x, y);
  c.shadowColor = th.glow || 'rgba(0,0,0,0.35)'; c.shadowBlur = (th.glow ? 9 : 4) * s; c.shadowOffsetY = th.glow ? 0 : 2 * s;
  rr(c, -w / 2, -h / 2, w, h, 4 * s); c.fillStyle = th.tile; c.fill();
  c.shadowColor = 'transparent'; c.lineWidth = 1; c.strokeStyle = th.edge; c.stroke();
  c.strokeStyle = th.line; c.beginPath();
  if (vert) { c.moveTo(-w / 2 + 2 * s, 0); c.lineTo(w / 2 - 2 * s, 0); }
  else { c.moveTo(0, -h / 2 + 2 * s); c.lineTo(0, h / 2 - 2 * s); }
  c.stroke();
  const first = flip ? b : a, second = flip ? a : b;
  if (vert) { pips(c, -w / 2, -h / 2, w, h / 2, first, s); pips(c, -w / 2, 0, w, h / 2, second, s); }
  else { pips(c, -w / 2, -h / 2, w / 2, h, first, s); pips(c, 0, -h / 2, w / 2, h, second, s); }
  c.restore();
}

function layoutChain(tiles, startX, y0, dir, rowDir) {
  let x = startX, y = y0;
  const out = [], limitR = W - MARGIN - 12, limitL = MARGIN + 12, verticalStep = 50;
  tiles.forEach(t => {
    let isVert = t.d, tw = isVert ? 20 : 40, th = isVert ? 40 : 20;
    const stepX = isVert ? 20 : 40;
    const willOverflow = dir > 0 ? (x + dir * stepX > limitR) : (x + dir * stepX < limitL);

    if (willOverflow) {
      if (t.d) {
        const cx = x + dir * (tw / 2), cy = y;
        out.push({ t, cx, cy, vert: true, flip: false });
        y += rowDir * verticalStep; dir = -dir; x = cx;
      } else {
        const cx = x + dir * (tw / 2), cy = y + rowDir * (verticalStep / 2), flip = rowDir < 0;
        out.push({ t, cx, cy, vert: true, flip });
        y += rowDir * verticalStep; dir = -dir; x = cx;
      }
    } else {
      const cx = x + dir * (tw / 2), cy = y, flip = !isVert && (dir < 0);
      out.push({ t, cx, cy, vert: isVert, flip });
      x += dir * tw;
    }
  });
  return { out, x, y, dir };
}

function endTag(x, y, dir, txt) {
  const w = 26, h = 13;
  let cx = x + dir * (w / 2 + 6);
  rr(ctx, cx - w / 2, y - h / 2, w, h, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = '#7c5a1c'; ctx.stroke();
  ctx.fillStyle = '#fcd34d'; ctx.font = '700 8px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, cx, y + 0.5);
}

function renderOutsideSeats() {
  const grid = $('seatOverlayOutside'); grid.innerHTML = '';
  grid.style.gridTemplateColumns = 'repeat(' + Math.max(1, players.length) + ',1fr)';
  ['S', 'W', 'N', 'E'].forEach(pos => {
    const p = byPos(pos); if (!p) return;
    const name = String(p.name || '?');
    const card = document.createElement('div');
    card.className = 'seat-card-out' + (pos === turn && active ? ' active' : '') + (speaking.has(p.clientId) ? ' speaking' : '');
    card.style.cssText = 'cursor:pointer;min-height:44px';
    const avatar = document.createElement('div'); avatar.className = 'p-avatar' + (p.ai ? ' bot' : ''); avatar.textContent = p.av || name.charAt(0).toUpperCase();
    const nameEl = document.createElement('div'); nameEl.className = 'p-name'; nameEl.textContent = name;
    const tilesEl = document.createElement('div'); tilesEl.className = 'p-tiles'; tilesEl.textContent = p.hand ? p.hand.length + '🀠' : '';
    card.appendChild(avatar); card.appendChild(nameEl); card.appendChild(tilesEl);
    card.onclick = () => playerMenu(p, true);
    grid.appendChild(card);
  });
}

function refresh() {
  if (gameHidden()) return;
  renderOutsideSeats();
  $('sNS').textContent = sNS; $('sWE').textContent = sWE;
  $('handLbl').textContent = 'Hand ' + handNo;
  $('modeLbl').textContent = MODE_NAME[gameMode] || 'Cut Throat';
  const cur = byPos(turn);
  $('turnLbl').textContent = cur ? (cur.pos === mySeatPos ? 'Your hand' : cur.name + "'s turn") : '';
  $('againBtn').classList.toggle('hidden', !matchOver || !isHost);
  $('roomBtn').classList.toggle('hidden', !matchOver || !roomCode);

  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.save(); ctx.scale(2, 2);
  const th = TH();
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, th.top); bgGrad.addColorStop(1, th.bot);
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

  if (!center) {
    if (needD6 && openTile) drawTile(ctx, W / 2, CY, openTile.a, openTile.b, openTile.a === openTile.b, 1, false);
    ctx.restore(); renderHand(); return;
  }

  const leftRes = layoutChain(lb.slice().reverse(), W / 2, CY, -1, 1);
  const rightRes = layoutChain(rb, W / 2, CY, 1, -1);

  drawTile(ctx, W / 2, CY, center.a, center.b, center.d, 1, false);
  leftRes.out.forEach(item => drawTile(ctx, item.cx, item.cy, item.t.a, item.t.b, item.vert, 1, item.flip));
  rightRes.out.forEach(item => drawTile(ctx, item.cx, item.cy, item.t.a, item.t.b, item.vert, 1, item.flip));

  if (active) {
    endTag(leftRes.x, leftRes.y, leftRes.dir, String(L));
    endTag(rightRes.x, rightRes.y, rightRes.dir, String(R));
  }
  ctx.restore(); renderHand();
}

$('againBtn').onclick = () => { if (isHost) newMatch(); };
