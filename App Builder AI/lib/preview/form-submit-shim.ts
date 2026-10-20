/**
 * Auto-wires any `<form data-aw-form="name">` element in a static preview to
 * submit via fetch to this project's public form-submission endpoint,
 * instead of doing a full page navigation (which static HTML has no server
 * to handle). The project id is read from the `<base href>` tag that
 * `injectPreviewBaseHref` already adds to every served page, so templates
 * don't need per-project placeholder substitution.
 *
 * Downloaded/exported HTML has no `<base>` tag and never receives this
 * script, so templates that want forms to keep working after export should
 * also ship their own inline fallback script (see
 * prisma/seed-website-templates.ts's contact-form section) that only
 * activates when this shim never attached (checked via `data-aw-handled`).
 */
export const FORM_SUBMIT_SHIM_SCRIPT = `<script>
(function () {
  if (window.__appweaverFormShimInstalled) return;
  window.__appweaverFormShimInstalled = true;

  function projectIdFromBase() {
    var base = document.querySelector('base[href]');
    if (!base) return null;
    var match = base.getAttribute('href').match(/\\/api\\/projects\\/([^/]+)\\/(?:preview|live)\\//);
    return match ? match[1] : null;
  }

  function setStatus(form, message, isError) {
    var statusEl = form.querySelector('[data-aw-form-status]');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle('aw-form-error', Boolean(isError));
  }

  function attach(form) {
    if (form.hasAttribute('data-aw-handled')) return;
    form.setAttribute('data-aw-handled', 'true');

    var projectId = projectIdFromBase();
    if (!projectId) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var formName = form.getAttribute('data-aw-form') || 'contact';
      var formData = new FormData(form);
      var data = {};
      formData.forEach(function (value, key) {
        data[key] = value;
      });

      var submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) submitBtn.setAttribute('disabled', 'true');
      setStatus(form, 'Sending…', false);

      var utm = {};
      try {
        var qs = new URLSearchParams((window.parent !== window ? window.parent.location.search : '') || window.location.search);
        ['source', 'medium', 'campaign', 'content'].forEach(function (k) {
          var v = qs.get('utm_' + k);
          if (v) utm[k] = v.slice(0, 80);
        });
      } catch (e) {}

      fetch('/api/projects/' + projectId + '/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formName: formName, data: data, utm: utm }),
      })
        .then(function (res) {
          return res.json().then(function (body) {
            return { ok: res.ok, body: body };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            setStatus(
              form,
              (result.body && result.body.error) || 'Could not send your message.',
              true,
            );
            return;
          }
          setStatus(form, 'Thanks! Your message has been sent.', false);
          form.reset();
        })
        .catch(function () {
          setStatus(form, 'Could not send your message. Please try again.', true);
        })
        .finally(function () {
          if (submitBtn) submitBtn.removeAttribute('disabled');
        });
    });
  }

  function attachAll() {
    document.querySelectorAll('form[data-aw-form]').forEach(attach);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachAll);
  } else {
    attachAll();
  }
})();
</script>`;

/** Injects the form-submit shim as the first script in `<head>`. */
export function injectFormSubmitShim(html: string) {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(
      /<head([^>]*)>/i,
      `<head$1>\n  ${FORM_SUBMIT_SHIM_SCRIPT}`,
    );
  }

  return `${FORM_SUBMIT_SHIM_SCRIPT}\n${html}`;
}
