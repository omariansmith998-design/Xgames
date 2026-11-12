function openFrame(src) {
  frameReady = false;
  $('gf').src = src;
  $('gameFrame').classList.remove('hidden');
}/* ---------- LUDO CONNECTION ---------- */
window.addEventListener('message', e => {
  if (e.source !== $('gf').contentWindow) return;
  const d = e.data || {};
  if (d.t === 'ready') {
    frameReady = true;
    if ($('gf').src.indexOf('net=1') > -1) {
      toFrame({ t: 'init', seats: lobby.map(p => ({ id: p.clientId, name: p.name, bot: !!p.isBot })), mode: ludoMode, lv: botLevel, host: isHost, me: myClientId });
      if (!isHost && gs) toFrame({ t: 'state', g: gs });
    }
  } else if (d.t === 'state' && isHost) { gs = d.g; syncRoomState(); }
  else if (d.t === 'act' && !isHost && roomSubscription) roomSubscription.send({ type: 'broadcast', event: 'GAME_ACT', payload: { clientId: myClientId, a: d.a } });
  else if (d.t === 'kick' && isHost) { lobby = lobby.filter(p => p.clientId !== d.id); syncRoomState(); }
  else if (d.t === 'quit') { if (roomCode && isHost) backToRoom(); else if (roomCode) leaveToHome(); else closeFrame(); }
});
$('gfMic').onclick = () => $('micBtn').click();

/* ---------- BUG LIST ---------- */
const bugs = [];
function bugAdd(kind, text) {
  bugs.push(kind + ': ' + text);
  const b = $('bugBtn'); b.textContent = '🐞 ' + bugs.length; b.classList.remove('hidden');
}
$('bugBtn').onclick = () => alert(bugs.join('\n\n') || 'No errors');
