/**
 * Click-to-edit shim injected into static HTML previews. When the parent
 * editor enables "visual edit" mode (via postMessage), this script adds
 * hover/selection outlines and a small floating toolbar that lets the user
 * edit text inline, change image/link attributes, or delete an element —
 * all without leaving the live preview. Edits are reported back to the
 * parent via postMessage; the parent persists them to disk and reloads the
 * preview, so this script never writes to the artifact's files itself.
 */
export const VISUAL_EDIT_SHIM_SCRIPT = `<script>
(function () {
  if (window.__appweaverVisualEditInstalled) return;
  window.__appweaverVisualEditInstalled = true;

  var active = false;
  var selected = null;
  var hovered = null;
  var toolbar = null;
  var editingText = null;
  var originalTextBeforeEdit = '';

  function post(message) {
    try {
      window.parent.postMessage(
        Object.assign({ source: 'appweaverai-preview' }, message),
        '*',
      );
    } catch (e) {}
  }

  function closestEditable(el) {
    while (el && el !== document.body) {
      if (el.hasAttribute && el.hasAttribute('data-aw-id')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function ensureStyle() {
    if (document.getElementById('__aw-visual-edit-style')) return;
    var style = document.createElement('style');
    style.id = '__aw-visual-edit-style';
    style.textContent =
      '[data-aw-hover]{outline:2px solid rgba(255,90,30,0.65) !important;outline-offset:2px;cursor:pointer !important;}' +
      '[data-aw-selected]{outline:2px solid #ff5a1e !important;outline-offset:2px;}' +
      '.__aw-toolbar{position:fixed;z-index:2147483647;display:flex;gap:4px;background:#111;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.45);font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
      '.__aw-toolbar button{all:unset;cursor:pointer;color:#f5f5f5;background:transparent;padding:4px 8px;border-radius:6px;white-space:nowrap;}' +
      '.__aw-toolbar button:hover{background:rgba(255,255,255,.12);}' +
      '.__aw-toolbar button.__aw-danger:hover{background:rgba(255,70,70,.25);color:#ff7373;}' +
      '.__aw-panel{position:fixed;z-index:2147483647;background:#111;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.45);font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;gap:6px;min-width:220px;}' +
      '.__aw-panel label{color:#aaa;font-size:11px;}' +
      '.__aw-panel input{background:#1c1c1c;border:1px solid rgba(255,255,255,.15);color:#f5f5f5;border-radius:6px;padding:5px 7px;font-size:12px;}' +
      '.__aw-panel .__aw-row{display:flex;gap:6px;justify-content:flex-end;margin-top:4px;}';
    document.head.appendChild(style);
  }

  function removeToolbar() {
    if (toolbar && toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
    toolbar = null;
  }

  function clearSelection() {
    if (selected) selected.removeAttribute('data-aw-selected');
    selected = null;
    removeToolbar();
  }

  function positionNear(panel, el) {
    var rect = el.getBoundingClientRect();
    panel.style.left = Math.max(8, rect.left) + 'px';
    panel.style.top = Math.max(8, rect.top - 8) + 'px';
    requestAnimationFrame(function () {
      var panelRect = panel.getBoundingClientRect();
      var desiredTop = rect.top - panelRect.height - 8;
      panel.style.top = (desiredTop < 4 ? rect.bottom + 8 : desiredTop) + 'px';
      var maxLeft = window.innerWidth - panelRect.width - 8;
      if (parseFloat(panel.style.left) > maxLeft) {
        panel.style.left = Math.max(8, maxLeft) + 'px';
      }
    });
  }

  function commit(elementId, patch) {
    post({ type: 'visual-edit-commit', elementId: elementId, patch: patch });
  }

  function startTextEdit(el) {
    editingText = el;
    originalTextBeforeEdit = el.textContent || '';
    el.setAttribute('contenteditable', 'true');
    el.focus();
    try {
      document.execCommand('selectAll', false, null);
    } catch (e) {}
    removeToolbar();
  }

  function finishTextEdit(commitChange) {
    if (!editingText) return;
    var el = editingText;
    el.removeAttribute('contenteditable');
    var next = el.textContent || '';
    editingText = null;
    if (commitChange && next.trim() !== originalTextBeforeEdit.trim()) {
      commit(el.getAttribute('data-aw-id'), { kind: 'text', text: next });
    } else if (!commitChange) {
      el.textContent = originalTextBeforeEdit;
    }
  }

  function addButton(bar, label, onClick, danger) {
    var btn = document.createElement('button');
    if (danger) btn.className = '__aw-danger';
    btn.textContent = label;
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    bar.appendChild(btn);
  }

  function buildToolbar(el) {
    removeToolbar();
    ensureStyle();
    var bar = document.createElement('div');
    bar.className = '__aw-toolbar';
    var tag = el.tagName.toLowerCase();

    if (tag === 'img') {
      addButton(bar, 'Edit image', function () {
        showImagePanel(el);
      });
    } else if (el.children.length === 0) {
      addButton(bar, 'Edit text', function () {
        startTextEdit(el);
      });
    }

    if (tag === 'a') {
      addButton(bar, 'Edit link', function () {
        showLinkPanel(el);
      });
    }

    addButton(bar, 'Style', function () {
      showStylePanel(el);
    });

    addButton(bar, 'Ask AI', function () {
      showAskAiPanel(el);
    });

    addButton(bar, 'Save as template', function () {
      showSaveTemplatePanel(el);
    });

    addButton(
      bar,
      'Delete',
      function () {
        var id = el.getAttribute('data-aw-id');
        clearSelection();
        commit(id, { kind: 'delete' });
      },
      true,
    );

    document.body.appendChild(bar);
    positionNear(bar, el);
    toolbar = bar;
  }

  function showFieldPanel(el, fields, onSave) {
    removeToolbar();
    var panel = document.createElement('div');
    panel.className = '__aw-panel';
    var inputs = {};

    fields.forEach(function (field) {
      var label = document.createElement('label');
      label.textContent = field.label;
      var input = document.createElement('input');
      input.value = field.value || '';
      input.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
      });
      inputs[field.key] = input;
      panel.appendChild(label);
      panel.appendChild(input);
    });

    var row = document.createElement('div');
    row.className = '__aw-row';

    var cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    cancel.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      removeToolbar();
    });

    var save = document.createElement('button');
    save.textContent = 'Save';
    save.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    save.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var values = {};
      Object.keys(inputs).forEach(function (key) {
        values[key] = inputs[key].value;
      });
      onSave(values);
      removeToolbar();
    });

    row.appendChild(cancel);
    row.appendChild(save);
    panel.appendChild(row);

    document.body.appendChild(panel);
    positionNear(panel, el);
    toolbar = panel;

    var firstInput = inputs[fields[0].key];
    if (firstInput) firstInput.focus();
  }

  function showStylePanel(el) {
    var props = [
      ['color', 'Text color (e.g. #0d9488)'],
      ['background-color', 'Background color'],
      ['font-size', 'Font size (e.g. 32px)'],
      ['font-family', 'Font (e.g. Georgia, serif)'],
      ['padding', 'Spacing inside (e.g. 16px 24px)'],
      ['margin', 'Spacing outside (e.g. 24px 0)'],
      ['text-align', 'Alignment (left, center, right)'],
    ];
    showFieldPanel(
      el,
      props.map(function (p) {
        return {
          key: p[0],
          label: p[1],
          value: el.style.getPropertyValue(p[0]),
        };
      }),
      function (values) {
        var style = {};
        props.forEach(function (p) {
          style[p[0]] = values[p[0]] || null;
        });
        commit(el.getAttribute('data-aw-id'), { kind: 'style', style: style });
      },
    );
  }

  function showAskAiPanel(el) {
    showFieldPanel(
      el,
      [{ key: 'instruction', label: 'What should AI change here?', value: '' }],
      function (values) {
        if (!values.instruction) return;
        var html = el.outerHTML.replace(/ data-aw-[a-z-]+(="[^"]*")?/g, '');
        post({
          type: 'visual-edit-ask-ai',
          instruction: values.instruction,
          tag: el.tagName.toLowerCase(),
          html: html,
        });
      },
    );
  }

  function showSaveTemplatePanel(el) {
    var id = el.getAttribute('data-aw-id');
    showFieldPanel(
      el,
      [{ key: 'name', label: 'Template name', value: '' }],
      function (values) {
        if (!values.name) return;
        post({
          type: 'visual-edit-save-template',
          elementId: id,
          name: values.name,
        });
      },
    );
  }

  function showImagePanel(el) {
    showFieldPanel(
      el,
      [
        { key: 'src', label: 'Image URL', value: el.getAttribute('src') },
        { key: 'alt', label: 'Alt text', value: el.getAttribute('alt') },
      ],
      function (values) {
        commit(el.getAttribute('data-aw-id'), {
          kind: 'attrs',
          attrs: { src: values.src || null, alt: values.alt || null },
        });
      },
    );
  }

  function showLinkPanel(el) {
    showFieldPanel(
      el,
      [{ key: 'href', label: 'Link URL', value: el.getAttribute('href') }],
      function (values) {
        commit(el.getAttribute('data-aw-id'), {
          kind: 'attrs',
          attrs: { href: values.href || null },
        });
      },
    );
  }

  document.addEventListener(
    'mouseover',
    function (e) {
      if (!active) return;
      var target = closestEditable(e.target);
      if (hovered && hovered !== target) hovered.removeAttribute('data-aw-hover');
      if (target && target !== selected) target.setAttribute('data-aw-hover', '');
      hovered = target;
    },
    true,
  );

  document.addEventListener(
    'mouseout',
    function () {
      if (hovered) hovered.removeAttribute('data-aw-hover');
      hovered = null;
    },
    true,
  );

  document.addEventListener(
    'click',
    function (e) {
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();

      var target = closestEditable(e.target);

      if (editingText && editingText !== target) {
        finishTextEdit(true);
      }

      if (!target) {
        clearSelection();
        return;
      }

      if (selected && selected !== target) {
        selected.removeAttribute('data-aw-selected');
      }
      selected = target;
      target.removeAttribute('data-aw-hover');
      target.setAttribute('data-aw-selected', '');
      buildToolbar(target);
    },
    true,
  );

  document.addEventListener(
    'focusout',
    function (e) {
      if (editingText && e.target === editingText) {
        setTimeout(function () {
          if (editingText) finishTextEdit(true);
        }, 0);
      }
    },
    true,
  );

  document.addEventListener(
    'keydown',
    function (e) {
      if (!active) return;
      if (editingText) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finishTextEdit(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finishTextEdit(false);
        }
        return;
      }
      if (e.key === 'Escape' && selected) {
        clearSelection();
      }
    },
    true,
  );

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.source !== 'appweaverai-editor') return;
    if (data.type === 'toggle-visual-edit') {
      active = !!data.enabled;
      ensureStyle();
      if (!active) {
        if (editingText) finishTextEdit(true);
        clearSelection();
        if (hovered) {
          hovered.removeAttribute('data-aw-hover');
          hovered = null;
        }
      }
    }
  });

  post({ type: 'visual-edit-ready' });
})();
</script>`;

/** Injects the visual-edit shim as the first script in `<head>`. */
export function injectVisualEditShim(html: string) {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(
      /<head([^>]*)>/i,
      `<head$1>\n  ${VISUAL_EDIT_SHIM_SCRIPT}`,
    );
  }

  return `${VISUAL_EDIT_SHIM_SCRIPT}\n${html}`;
}
