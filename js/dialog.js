/*
 * AhPah Video Pro - modal dialogs. `AVP.dialog.form` builds a small form from field
 * descriptions; `AVP.dialog.info` shows read-only HTML. Only one dialog is open at a time.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const $ = (sel) => document.querySelector(sel);

  let current = null;

  function close() {
    $('#modal').classList.add('hidden');
    $('#modalBody').innerHTML = '';
    $('#modalFoot').innerHTML = '';
    current = null;
  }

  function fieldHtml(f) {
    const id = 'f_' + f.k;
    const label = f.label ? `<label class="df-label" for="${id}">${AVP.esc(f.label)}</label>` : '';
    const hint = f.hint ? `<div class="df-hint">${AVP.esc(f.hint)}</div>` : '';
    let input = '';
    switch (f.type) {
      case 'select':
        input =
          `<select id="${id}" data-k="${f.k}">` +
          f.options.map((o) => `<option value="${AVP.esc(o.v)}"${o.v === f.value ? ' selected' : ''}>${AVP.esc(o.label)}</option>`).join('') +
          '</select>';
        break;
      case 'checkbox':
        return `<div class="df-row"><label class="df-check"><input type="checkbox" id="${id}" data-k="${f.k}"${f.value ? ' checked' : ''}> ${AVP.esc(f.label)}</label>${hint}</div>`;
      case 'textarea':
        input = `<textarea id="${id}" data-k="${f.k}" rows="${f.rows || 3}">${AVP.esc(f.value)}</textarea>`;
        break;
      case 'color':
        input = `<input type="color" id="${id}" data-k="${f.k}" value="${AVP.esc(f.value)}">`;
        break;
      case 'number':
        input = `<input type="number" id="${id}" data-k="${f.k}" value="${f.value}" min="${f.min}" max="${f.max}" step="${f.step || 'any'}">`;
        break;
      case 'html':
        return `<div class="df-row df-html">${f.html}</div>`;
      default:
        input = `<input type="text" id="${id}" data-k="${f.k}" value="${AVP.esc(f.value)}">`;
    }
    return `<div class="df-row">${label}${input}${hint}</div>`;
  }

  function readValues(fields) {
    const out = {};
    fields.forEach((f) => {
      if (f.type === 'html') return;
      const el = document.getElementById('f_' + f.k);
      if (!el) return;
      if (f.type === 'checkbox') out[f.k] = el.checked;
      else if (f.type === 'number') out[f.k] = parseFloat(el.value);
      else out[f.k] = el.value;
    });
    return out;
  }

  AVP.dialog = {
    close,

    form(opts) {
      close();
      current = opts;
      $('#modalTitle').textContent = opts.title || '';
      $('#modalBody').innerHTML = (opts.intro ? `<p class="muted">${AVP.esc(opts.intro)}</p>` : '') + opts.fields.map(fieldHtml).join('');
      const foot = $('#modalFoot');
      foot.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = opts.cancel || 'Cancel';
      cancel.addEventListener('click', close);
      const ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.textContent = opts.ok || 'OK';
      ok.addEventListener('click', () => {
        const values = readValues(opts.fields);
        close();
        if (opts.onOk) opts.onOk(values);
      });
      foot.appendChild(cancel);
      foot.appendChild(ok);
      $('#modal').classList.remove('hidden');
      const first = $('#modalBody input, #modalBody select, #modalBody textarea');
      if (first) first.focus();
      $('#modalBody').onkeydown = (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
          e.preventDefault();
          ok.click();
        }
      };
      if (opts.onChange) {
        $('#modalBody').oninput = () => opts.onChange(readValues(opts.fields), (k, v) => setValue(k, v));
      } else $('#modalBody').oninput = null;
    },

    info(title, html) {
      close();
      $('#modalTitle').textContent = title;
      $('#modalBody').innerHTML = html;
      const foot = $('#modalFoot');
      const ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.textContent = 'Close';
      ok.addEventListener('click', close);
      foot.appendChild(ok);
      $('#modal').classList.remove('hidden');
    },

    isOpen: () => !$('#modal').classList.contains('hidden'),
  };

  // Lets a live form update one of its fields (e.g. a computed size).
  function setValue(k, v) {
    const el = document.getElementById('f_' + k);
    if (el) el.value = v;
  }

  AVP.dialog.setValue = setValue;

  AVP.dialog.init = function () {
    $('#modalClose').addEventListener('click', close);
    $('#modal').addEventListener('mousedown', (e) => {
      if (e.target.id === 'modal') close();
    });
  };
})();
