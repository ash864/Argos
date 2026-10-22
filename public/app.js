const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

let chats = store.get('argos.chats', []);
let current = null;      // active chat object
let abort = null;        // in-flight request controller
let config = { needsCode: false };

const hour = new Date().getHours();
$('greeting').textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

// ---------- markdown (small, safe: escapes first) ----------
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function markdown(src) {
  const out = [];
  const parts = src.split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) { // code fence (odd parts); drop optional language line
      out.push(`<pre><code>${esc(part.replace(/^[^\n]*\n/, ''))}</code></pre>`);
      return;
    }
    let list = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const para of part.split(/\n{2,}/)) {
      for (const line of para.split('\n')) {
        let m;
        if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
        else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
        else if ((m = line.match(/^#{1,3}\s+(.*)/))) { close(); out.push(`<h3>${inline(m[1])}</h3>`); }
        else if (line.trim()) { close(); out.push(`<p>${inline(line)}</p>`); }
      }
      close();
    }
  });
  return out.join('');
}

// ---------- rendering ----------
const SPARK = '<svg class="avatar" viewBox="0 0 24 24"><path fill="url(#sg)" stroke="none" d="M12 2c.5 4.5 5.5 9.5 10 10-4.5.5-9.5 5.5-10 10-.5-4.5-5.5-9.5-10-10 4.5-.5 9.5-5.5 10-10z"/></svg>';
function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = `msg ${role === 'user' ? 'user' : 'bot'}`;
  if (role === 'user') el.textContent = text;
  else { el.innerHTML = `${SPARK}<div class="body"></div>`; el.querySelector('.body').innerHTML = markdown(text); }
  $('messages').appendChild(el);
  return el;
}
const scrollDown = () => { $('chat').scrollTop = $('chat').scrollHeight; };

function renderChat() {
  $('messages').innerHTML = '';
  $('welcome').hidden = Boolean(current && current.messages.length);
  if (current) current.messages.forEach((m) => addMessage(m.role, m.content));
  scrollDown();
  renderHistory();
}

function renderHistory() {
  const ul = $('history');
  ul.innerHTML = '';
  for (const c of chats) {
    const li = document.createElement('li');
    if (c === current) li.className = 'active';
    const t = document.createElement('button');
    t.className = 'title'; t.textContent = c.title;
    t.onclick = () => { if (!abort) { current = c; renderChat(); closeDrawer(); } };
    const d = document.createElement('button');
    d.className = 'del'; d.setAttribute('aria-label', 'Delete chat');
    d.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    d.onclick = () => {
      if (abort) return;
      chats = chats.filter((x) => x !== c);
      if (current === c) current = null;
      store.set('argos.chats', chats); renderChat();
    };
    li.append(t, d); ul.appendChild(li);
  }
}

// ---------- drawer ----------
const openDrawer = () => { $('drawer').classList.add('open'); $('scrim').hidden = false; };
const closeDrawer = () => { $('drawer').classList.remove('open'); $('scrim').hidden = true; };
$('menu').onclick = openDrawer;
$('scrim').onclick = closeDrawer;
const newChat = () => { if (abort) return; current = null; renderChat(); closeDrawer(); $('input').focus(); };
$('newChat').onclick = newChat;
$('newTop').onclick = newChat;

// ---------- sending ----------
function setBusy(busy) {
  $('send').hidden = busy; $('stop').hidden = !busy;
}

async function send(text) {
  text = text.trim();
  if (!text || abort) return;
  if (!current) {
    current = { title: text.slice(0, 40), messages: [] };
    chats.unshift(current);
  }
  current.messages.push({ role: 'user', content: text });
  $('welcome').hidden = true;
  addMessage('user', text);
  $('input').value = ''; autosize();

  const bot = addMessage('bot', '');
  const body = bot.querySelector('.body');
  const avatar = bot.querySelector('.avatar');
  avatar.classList.add('thinking');
  renderHistory(); scrollDown();

  abort = new AbortController();
  setBusy(true);
  let reply = '';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.needsCode) {
      let code = store.get('argos.code', '');
      if (!code) { code = prompt('Enter your Argos access code') || ''; store.set('argos.code', code); }
      headers['X-Access-Code'] = code;
    }
    const res = await fetch('/api/chat', { method: 'POST', headers, signal: abort.signal, body: JSON.stringify({ messages: current.messages }) });
    if (res.status === 401) { store.set('argos.code', ''); throw new Error('Wrong access code. Try again.'); }
    if (!res.ok) throw new Error(`Request failed (${res.status})`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split('\n\n'); buf = events.pop();
      for (const e of events) {
        if (!e.startsWith('data: ')) continue;
        const d = JSON.parse(e.slice(6));
        if (d.error) throw new Error(d.error);
        if (d.text) { reply += d.text; avatar.classList.remove('thinking'); body.innerHTML = markdown(reply); scrollDown(); }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') body.insertAdjacentHTML('beforeend', `<p class="err">${esc(err.message)}</p>`);
  } finally {
    avatar.classList.remove('thinking');
    if (reply) current.messages.push({ role: 'assistant', content: reply });
    else current.messages.pop(); // nothing came back: drop the unanswered user turn so history stays alternating
    if (!current.messages.length) chats = chats.filter((c) => c !== current), current = null;
    store.set('argos.chats', chats.slice(0, 50));
    abort = null; setBusy(false); renderHistory();
  }
}

$('composer').onsubmit = (e) => { e.preventDefault(); send($('input').value); };
$('stop').onclick = () => abort && abort.abort();
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && matchMedia('(hover: hover)').matches) { e.preventDefault(); send($('input').value); }
});
function autosize() { const i = $('input'); i.style.height = 'auto'; i.style.height = `${i.scrollHeight}px`; }
$('input').addEventListener('input', autosize);
document.querySelectorAll('.chip').forEach((c) => (c.onclick = () => send(c.textContent)));

// ---------- voice input ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('mic').hidden = true;
else {
  let rec = null;
  $('mic').onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.interimResults = true; rec.lang = navigator.language;
    const base = $('input').value;
    rec.onresult = (e) => { $('input').value = (base + ' ' + [...e.results].map((r) => r[0].transcript).join('')).trim(); autosize(); };
    rec.onend = () => { rec = null; $('mic').classList.remove('listening'); };
    rec.onerror = () => rec && rec.stop();
    $('mic').classList.add('listening'); rec.start();
  };
}

// ---------- boot ----------
fetch('/api/config').then((r) => r.json()).then((c) => (config = c)).catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
renderChat();
