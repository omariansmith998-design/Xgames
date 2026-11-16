/* Xgames Arcade: in-app rules sheet (build 5)
   Drop-in: add <script src="rules.js"></script> after app.js in index.html.
   Adds a 📖 button to the header and a bottom sheet with one tab per game.
   Non-blocking: no dark overlay, nothing pauses while it is open.
   Future games: XGRules.register('draughts', { title, sections:[{h, li:[...]}] }) */
(function () {
  'use strict';
  const RULES = {};
  let built = false, sheet, tabsEl, bodyEl, btn, active = 'dominoes';

  RULES.dominoes = {
    title: 'Yard Dominoes',
    sections: [
      { h: '🎯 The basics', open: true, li: [
        'Double-six set of **28 tiles**. Everyone gets **7**. With fewer than 4 players (Boneyard mode) the leftover tiles form the **boneyard**.',
        'Play a tile that matches a number on **either end** of the chain. Tap the tile; if it fits both ends you pick **Left** or **Right**.',
        'Doubles go crosswise and land with a slam.'] },
      { h: '🚀 Who starts', li: [
        'First hand: whoever holds the **highest double** (or the highest tile if nobody has a double) poses first, and must start with that exact tile.',
        'After that, the **winner of the last hand** poses first with any tile.'] },
      { h: '✋ Knocking & the boneyard', li: [
        'Can\'t play? If the boneyard has tiles you **draw** until you can. When it\'s empty (always the case with 4 players) you **knock** (pass).',
        'Knocks are public. Smart players notice which numbers you\'re missing.'] },
      { h: '🏁 Winning a hand', li: [
        'Play all your tiles first and you win the hand for **1 point**.',
        '**Blocked** (everyone knocks in a row): lowest pip total wins. In Partners it\'s the team total. A tie replays the hand.'] },
      { h: '🏆 Winning the match', li: [
        'First to **6** wins, a "six love".',
        '**Cut Throat:** every player for themselves, one point per hand won.',
        '**Partners (2v2):** North/South vs East/West, partners sit across. Points go to the team.',
        '**Break:** in Partners, if a team on 0 wins a hand while the other team has points, the other team\'s score is wiped back to 0.'] },
      { h: '🤖 Bots', li: [
        '**Easy** plays randomly. **Medium** likes big tiles. **Hard** remembers what each player knocked on and tries to block them (but never blocks its own partner).'] }
    ]
  };

  RULES.ludo = {
    title: 'Ludo',
    sections: [
      { h: '🎯 Goal & dice', open: true, li: [
        'Get all **4 tokens home** first. No exact roll needed to finish.',
        'Each turn you roll **two dice**. Use each die on any token, or tap **Total** to move one token both dice at once.',
        'Split dice freely: with a 3 and a 2, token A can take the 3 and token B the 2.',
        'A **6** on a die brings a token out of the yard (single die only, not the Total) and earns **another throw**.'] },
      { h: '⚔️ Captures', li: [
        'Land on an enemy token to **send it home**. Tokens on a ★ are safe.',
        'A capture **stops that token dead**. It can\'t use the other die in the same roll. The leftover die can only move a **different** token.',
        'Using the Total, your token stops at the first square where one die alone would land on an enemy, captures there, and the other die stays free for another token.'] },
      { h: '🧱 Blocks & safe stars', li: [
        '**Two of your tokens** on one square make a block. Nobody can pass it.',
        '★ squares (including each start square) can\'t be captured on.'] },
      { h: '🔒 Lock on the Stop', li: [
        'Get **two tokens** onto your gold-ringed Stop square before anyone can enter home. Until you make the lock, home stays closed to you.'] },
      { h: '⚡ Auto-play', li: [
        'One token on the board and no 6 rolled: the **Total** plays itself.',
        'Only one possible move: it plays itself too.',
        'Otherwise pick a die or Total, then tap a glowing token.'] }
    ]
  };

  const CSS = '#xgrSheet{position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:460px;max-height:52vh;display:flex;flex-direction:column;background:rgba(20,23,36,.97);border:1px solid #334155;border-bottom:0;border-radius:16px 16px 0 0;box-shadow:0 -8px 24px rgba(0,0,0,.5);z-index:160;transition:transform .2s}' +
    '#xgrSheet.xgr-off{transform:translateY(105%);pointer-events:none;visibility:hidden}' +
    '.xgr-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #23273a}' +
    '.xgr-tabs{display:flex;gap:6px;overflow-x:auto}' +
    '.xgr-tab{min-height:36px;padding:2px 14px;font-size:13px;background:#1e2433;color:#94a3b8;white-space:nowrap}' +
    '.xgr-tab.on{background:#3a2a14;color:#fbbf24;outline:2px solid #fbbf24}' +
    '.xgr-x{min-height:36px;padding:2px 14px;font-size:13px;background:#334155;flex:none}' +
    '.xgr-body{overflow-y:auto;padding:6px 12px 16px;-webkit-user-select:text;user-select:text}' +
    '.xgr-body details{border-bottom:1px solid #1e2433;padding:6px 0}' +
    '.xgr-body summary{font-weight:800;font-size:13px;color:#a5b4fc;cursor:pointer;min-height:32px;display:flex;align-items:center}' +
    '.xgr-body ul{margin:4px 0 6px;padding-left:18px;font-size:12.5px;line-height:1.55;color:#cbd5e1}' +
    '.xgr-body b{color:#fff}';

  function rich(el, s) {
    s.split('**').forEach((part, i) => {
      if (!part) return;
      if (i % 2) { const b = document.createElement('b'); b.textContent = part; el.appendChild(b); }
      else el.appendChild(document.createTextNode(part));
    });
  }

  function current() {
    try {
      if (typeof roomCode !== 'undefined' && roomCode && typeof gameId !== 'undefined' && RULES[gameId]) return gameId;
      if (typeof qGame !== 'undefined' && RULES[qGame] && typeof gameHidden === 'function' && gameHidden()) return qGame;
    } catch (e) {}
    return 'dominoes';
  }

  function renderBody() {
    bodyEl.textContent = '';
    const g = RULES[active]; if (!g) return;
    g.sections.forEach(sec => {
      const d = document.createElement('details'); if (sec.open) d.open = true;
      const sm = document.createElement('summary'); sm.textContent = sec.h; d.appendChild(sm);
      const ul = document.createElement('ul');
      sec.li.forEach(t => { const li = document.createElement('li'); rich(li, t); ul.appendChild(li); });
      d.appendChild(ul); bodyEl.appendChild(d);
    });
    bodyEl.scrollTop = 0;
  }

  function buildTabs() {
    tabsEl.textContent = '';
    Object.keys(RULES).forEach(id => {
      const t = document.createElement('button');
      t.className = 'xgr-tab' + (id === active ? ' on' : '');
      t.textContent = RULES[id].title;
      t.addEventListener('click', () => { active = id; buildTabs(); renderBody(); });
      tabsEl.appendChild(t);
    });
  }

  const isOpen = () => !sheet.classList.contains('xgr-off');
  function open(id) {
    active = RULES[id] ? id : current();
    buildTabs(); renderBody(); sheet.classList.remove('xgr-off');
  }
  function close() { sheet.classList.add('xgr-off'); }

  function init() {
    if (built) return; built = true;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    sheet = document.createElement('div'); sheet.id = 'xgrSheet'; sheet.className = 'xgr-off';
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Game rules');
    const head = document.createElement('div'); head.className = 'xgr-head';
    tabsEl = document.createElement('div'); tabsEl.className = 'xgr-tabs';
    const x = document.createElement('button'); x.className = 'xgr-x'; x.textContent = '✕ Close';
    x.addEventListener('click', close);
    head.appendChild(tabsEl); head.appendChild(x);
    bodyEl = document.createElement('div'); bodyEl.className = 'xgr-body';
    sheet.appendChild(head); sheet.appendChild(bodyEl);
    document.body.appendChild(sheet);

    btn = document.createElement('button');
    btn.id = 'rulesBtn'; btn.className = 'ib purple'; btn.textContent = '📖';
    btn.setAttribute('aria-label', 'Rules');
    btn.addEventListener('click', () => { if (isOpen()) close(); else open(current()); });
    const hub = document.getElementById('hubBtn');
    if (hub && hub.parentNode) hub.parentNode.insertBefore(btn, hub);
    else { btn.style.cssText = 'position:fixed;right:10px;top:10px;z-index:60'; document.body.appendChild(btn); }

    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    buildTabs();
  }

  window.XGRules = { open, close, register(id, def) { RULES[id] = def; if (built) buildTabs(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
