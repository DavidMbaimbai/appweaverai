const WIDGET = `(function () {
  var script = document.currentScript;
  if (!script) return;
  var projectId = script.getAttribute('data-project-id');
  if (!projectId || window.__awChat) return;
  window.__awChat = true;
  var origin = new URL(script.src).origin;
  var api = origin + '/api/messaging/webchat/' + encodeURIComponent(projectId);
  var title = script.getAttribute('data-title') || 'Chat with us';
  var key = 'aw-chat-visitor-' + projectId;
  var visitor = null;
  try { visitor = localStorage.getItem(key); } catch (e) {}
  if (!visitor) {
    var bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    visitor = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    try { localStorage.setItem(key, visitor); } catch (e) {}
  }
  var seen = {};
  var last = null;
  var timer = null;

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text) n.textContent = text;
    return n;
  }
  var button = el('button', 'position:fixed;right:20px;bottom:20px;z-index:2147483000;border:0;border-radius:999px;padding:12px 18px;background:#111827;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)', title);
  var panel = el('div', 'display:none;position:fixed;right:20px;bottom:76px;z-index:2147483000;width:340px;max-width:calc(100vw - 40px);height:440px;max-height:70vh;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.2);flex-direction:column;font:14px system-ui,sans-serif;color:#111827');
  var list = el('div', 'flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px');
  var notice = el('div', 'padding:0 12px 6px;font-size:12px;color:#6b7280');
  var form = el('form', 'display:flex;gap:6px;padding:10px;border-top:1px solid #e5e7eb');
  var input = el('input', 'flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px;font:inherit');
  input.maxLength = 2000;
  input.placeholder = 'Type your message';
  var send = el('button', 'border:0;border-radius:8px;padding:8px 12px;background:#111827;color:#fff;cursor:pointer', 'Send');
  send.type = 'submit';
  form.appendChild(input); form.appendChild(send);
  panel.appendChild(list); panel.appendChild(notice); panel.appendChild(form);
  document.body.appendChild(panel); document.body.appendChild(button);

  function render(messages) {
    messages.forEach(function (m) {
      if (seen[m.id]) return;
      seen[m.id] = true;
      last = m.at;
      var mine = m.role === 'visitor';
      list.appendChild(el('div', 'max-width:85%;padding:8px 10px;border-radius:10px;white-space:pre-wrap;word-break:break-word;align-self:' + (mine ? 'flex-end;background:#111827;color:#fff' : 'flex-start;background:#f3f4f6'), m.text));
    });
    list.scrollTop = list.scrollHeight;
  }
  function poll() {
    fetch(api + '?v=' + visitor + (last ? '&after=' + encodeURIComponent(last) : ''))
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.messages) render(d.messages); })
      .catch(function () {});
  }
  button.addEventListener('click', function () {
    var open = panel.style.display === 'none';
    panel.style.display = open ? 'flex' : 'none';
    if (open) { poll(); timer = setInterval(poll, 5000); input.focus(); }
    else if (timer) { clearInterval(timer); timer = null; }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    send.disabled = true;
    fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visitorId: visitor, text: text }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.messages) render(d.messages);
        notice.textContent = d.notice || d.error || '';
      })
      .catch(function () { notice.textContent = 'Could not send. Please try again.'; })
      .then(function () { send.disabled = false; });
  });
})();`;

/** Embeddable web chat widget: <script src="https://APP/api/messaging/webchat/widget" data-project-id="PROJECT_ID" async></script> */
export function GET() {
  return new Response(WIDGET, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
}
