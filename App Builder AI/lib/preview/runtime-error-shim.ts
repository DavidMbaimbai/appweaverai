/**
 * Catches runtime errors inside the preview iframe (uncaught exceptions,
 * unhandled promise rejections, and console.error calls — which covers
 * React's own render-error logging) and forwards them to the parent window
 * via postMessage so the editor can offer an "Fix with Agent" action. This
 * closes the loop beyond compile-time bundle validation: errors that only
 * surface once the app actually runs are now visible to the user (and,
 * eventually, the agent) instead of silently breaking the preview.
 */
export const RUNTIME_ERROR_SHIM_SCRIPT = `<script>
(function () {
  if (window.__appweaverErrorShimInstalled) return;
  window.__appweaverErrorShimInstalled = true;

  var reported = Object.create(null);

  function report(message, stack) {
    try {
      var key = String(message || '') + '|' + String(stack || '').slice(0, 200);
      var now = Date.now();
      var last = reported[key];
      if (last && now - last < 4000) return;
      reported[key] = now;
      window.parent.postMessage(
        {
          source: 'appweaverai-preview',
          type: 'runtime-error',
          message: String(message || 'Unknown error'),
          stack: stack ? String(stack) : undefined,
        },
        '*',
      );
    } catch (e) {
      // Ignore — never let error reporting itself throw.
    }
  }

  window.addEventListener('error', function (event) {
    if (event.error) {
      report(event.error.message || event.message, event.error.stack);
    } else {
      var location = event.filename
        ? event.filename + ':' + event.lineno + ':' + event.colno
        : undefined;
      report(event.message, location);
    }
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    if (reason instanceof Error) {
      report(reason.message, reason.stack);
    } else {
      try {
        report(typeof reason === 'string' ? reason : JSON.stringify(reason));
      } catch (e) {
        report(String(reason));
      }
    }
  });

  var originalConsoleError = window.console ? window.console.error : null;
  if (originalConsoleError) {
    window.console.error = function () {
      try {
        var args = Array.prototype.slice.call(arguments);
        var message = args
          .map(function (arg) {
            if (arg instanceof Error) return arg.message;
            if (typeof arg === 'string') return arg;
            try {
              return JSON.stringify(arg);
            } catch (e) {
              return String(arg);
            }
          })
          .join(' ');
        report(message);
      } catch (e) {
        // Ignore.
      }
      originalConsoleError.apply(window.console, arguments);
    };
  }
})();
</script>`;

/** Injects the runtime error shim as the first script in `<head>`. */
export function injectRuntimeErrorShim(html: string) {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(
      /<head([^>]*)>/i,
      `<head$1>\n  ${RUNTIME_ERROR_SHIM_SCRIPT}`,
    );
  }

  return `${RUNTIME_ERROR_SHIM_SCRIPT}\n${html}`;
}
