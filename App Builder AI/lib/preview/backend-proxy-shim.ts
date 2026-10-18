/**
 * Sends the preview's backend calls to the sandboxed backend container.
 *
 * Generated frontends call a same-origin `/api/...` (or the dev URLs
 * http://localhost:8080 / :8000). Inside the editor preview those requests are
 * rewritten to this project's authenticated backend proxy. When no backend is
 * running the proxy answers 503, so the frontend's built-in sample-data
 * fallback takes over. Exported projects never receive this script.
 */
export const BACKEND_PROXY_SHIM_SCRIPT = `<script>
(function () {
  if (window.__appweaverBackendShim) return;
  window.__appweaverBackendShim = true;

  var source = (document.querySelector('base[href]') || {}).href || location.href;
  var match = source.match(/\\/api\\/projects\\/([^/]+)\\/preview\\/([^/?#]+)/);
  if (!match) return;
  var prefix = '/api/projects/' + match[1] + '/backend/' + match[2] + '/proxy';

  function rewrite(input) {
    try {
      var url = new URL(input, location.href);
      var devBackend =
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
        (url.port === '8080' || url.port === '8000');
      var sameOriginApi =
        url.origin === location.origin &&
        url.pathname.indexOf('/api/') === 0 &&
        url.pathname.indexOf('/api/projects/') !== 0;
      if (devBackend || sameOriginApi) {
        return prefix + url.pathname + url.search;
      }
    } catch (e) {}
    return null;
  }

  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    var raw = typeof input === 'string' || input instanceof URL ? String(input) : input && input.url;
    var target = raw ? rewrite(raw) : null;
    if (!target) return nativeFetch.call(this, input, init);
    if (typeof input === 'string' || input instanceof URL) {
      return nativeFetch.call(this, target, init);
    }
    return nativeFetch.call(this, new Request(target, input), init);
  };

  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var target = rewrite(String(url));
    var args = Array.prototype.slice.call(arguments);
    if (target) args[1] = target;
    return nativeOpen.apply(this, args);
  };
})();
</script>`;

export function injectBackendProxyShim(html: string) {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(
      /<head([^>]*)>/i,
      `<head$1>\n  ${BACKEND_PROXY_SHIM_SCRIPT}`,
    );
  }

  return `${BACKEND_PROXY_SHIM_SCRIPT}\n${html}`;
}
