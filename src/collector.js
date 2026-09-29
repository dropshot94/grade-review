// Compass grade collector. Runs inside the Compass Director Dashboard page, in your own
// logged-in browser, as a bookmarklet or pasted into the browser console.
// It opens each student's Course Evaluation Report, reads it, and closes it.
// It sends nothing anywhere: records stay in this browser until you download them.
(function () {
  'use strict';
  var KEY = 'gradeCollector.v1';
  if (window.__gradeCollector) { window.__gradeCollector.show(); return; }

  // ---------- storage (this browser only) ----------
  var memory = { records: {} };
  function load() {
    try { var t = localStorage.getItem(KEY); return t ? JSON.parse(t) : { records: {} }; }
    catch (e) { return memory; }
  }
  function save(state) {
    memory = state;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* memory only */ }
  }
  function clearStore() {
    memory = { records: {} };
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  // ---------- helpers ----------
  function txt(el) { return (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim(); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function visible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    var cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }
  function docs() {
    var out = [document];
    var frames = document.querySelectorAll('iframe, frame');
    for (var i = 0; i < frames.length; i++) {
      try { if (frames[i].contentDocument && visible(frames[i])) out.push(frames[i].contentDocument); } catch (e) { /* cross-origin */ }
    }
    return out;
  }
  function cellsOf(tr) { return Array.prototype.filter.call(tr.children, function (c) { return /^(TD|TH)$/.test(c.tagName); }); }

  // ---------- dashboard table ----------
  function headerOf(table) {
    var rows = table.querySelectorAll('tr');
    for (var i = 0; i < rows.length && i < 3; i++) {
      var names = cellsOf(rows[i]).map(txt);
      if (names.some(function (n) { return /student\s*name/i.test(n); })) return { row: rows[i], names: names };
    }
    return null;
  }
  function findGradeTables() {
    var found = [];
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (!visible(t)) continue;
      var h = headerOf(t);
      if (!h) continue;
      var bodyTable = t;
      // DataTables with scrolling splits the header and body into two tables.
      var bodyRows = dataRows(t, h.row);
      if (!bodyRows.length) {
        var wrap = t.closest('.dataTables_scroll, .dataTables_wrapper');
        var other = wrap && wrap.querySelector('.dataTables_scrollBody table');
        if (other) { bodyTable = other; bodyRows = dataRows(other, null); }
      }
      if (bodyRows.length) found.push({ names: h.names, rows: bodyRows, table: bodyTable });
    }
    return found;
  }
  function dataRows(table, headerRow) {
    return Array.prototype.filter.call(table.querySelectorAll('tr'), function (tr) {
      if (tr === headerRow) return false;
      if (tr.closest('table') !== table) return false;
      var cells = cellsOf(tr);
      return cells.length >= 3 && cells.some(function (c) { return c.tagName === 'TD'; }) && visible(tr) && txt(tr).length > 0;
    });
  }
  function rowRecord(names, tr) {
    var cells = cellsOf(tr), out = {};
    for (var i = 0; i < names.length && i < cells.length; i++) if (names[i]) out[names[i]] = txt(cells[i]);
    return out;
  }
  function clickTarget(tr) {
    var el = tr.querySelector('a, button, [onclick], [role="button"], input[type="button"], input[type="image"]');
    if (el) return el;
    var first = cellsOf(tr)[0];
    return (first && (first.querySelector('i, img, span, svg') || first)) || tr;
  }

  // ---------- Course Evaluation Report ----------
  function findReport() {
    var ds = docs();
    for (var d = 0; d < ds.length; d++) {
      var tables = ds[d].querySelectorAll('table');
      for (var i = 0; i < tables.length; i++) {
        var t = tables[i];
        if (!visible(t)) continue;
        var first = t.querySelector('tr');
        var head = first ? cellsOf(first).map(txt).join(' | ') : '';
        if (!/element/i.test(head) || !/evaluation/i.test(head)) continue;
        var root = t;
        while (root.parentElement && !/Faculty Instructor/i.test(txt(root))) root = root.parentElement;
        if (!root.parentElement && !/Faculty Instructor/i.test(txt(root))) root = t.parentElement || t;
        return { root: root, table: t };
      }
    }
    return null;
  }
  function field(lines, label, stopLabels) {
    var re = new RegExp('(?:^|\\s)' + label + '\\s*:\\s*(.*)$', 'i');
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(re);
      if (m) {
        var v = m[1];
        for (var j = 0; j < stopLabels.length; j++) {
          var k = v.search(new RegExp('\\s' + stopLabels[j] + '\\s*:', 'i'));
          if (k >= 0) v = v.slice(0, k);
        }
        return v.replace(/\s+/g, ' ').trim();
      }
    }
    return '';
  }
  function parseReport(rep) {
    var lines = (rep.root.innerText || '').split(/\n+/).map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).filter(Boolean);
    var name = '';
    var heads = rep.root.querySelectorAll('h1, h2, h3, h4, h5, strong, b');
    for (var i = 0; i < heads.length; i++) {
      var h = txt(heads[i]);
      if (h && !/course evaluation report|:$/i.test(h) && /,/.test(h)) { name = h; break; }
    }
    if (!name) {
      var at = lines.findIndex(function (l) { return /course evaluation report/i.test(l); });
      if (at >= 0 && lines[at + 1] && !/:/.test(lines[at + 1])) name = lines[at + 1];
    }
    var elements = [];
    var trs = rep.table.querySelectorAll('tr');
    for (var r = 0; r < trs.length; r++) {
      var c = cellsOf(trs[r]);
      if (c.length < 2) continue;
      var el = txt(c[0]);
      if (!el || /^element$/i.test(el)) continue;
      elements.push({ element: el, rating: txt(c[1]), comment: c[2] ? txt(c[2]) : '' });
    }
    return {
      name: name,
      program: field(lines, 'Academic Program', ['Term']),
      term: field(lines, 'Term', []),
      course: field(lines, 'Course', ['Seminar']),
      seminar: field(lines, 'Seminar', []),
      faculty: field(lines, 'Faculty Instructor', []),
      date: field(lines, 'Date', []),
      signature: field(lines, 'Signature', []),
      elements: elements,
      signatureText: txt(rep.root)
    };
  }
  function closeReport(rep) {
    var box = rep.root.closest('.modal, [role="dialog"], .ui-dialog, .modal-dialog, .popup, .dialog') || rep.root;
    var btn = box.querySelector('[data-dismiss="modal"], [data-bs-dismiss="modal"], .close, .btn-close, .ui-dialog-titlebar-close, [aria-label="Close"], [title="Close"]');
    if (!btn) {
      var all = box.querySelectorAll('button, a, span, div');
      for (var i = 0; i < all.length; i++) {
        var t = txt(all[i]);
        if ((t === '×' || t === 'x' || t === 'X' || /^close$/i.test(t)) && all[i].children.length === 0) { btn = all[i]; break; }
      }
    }
    if (btn) btn.click();
    else {
      var $ = window.jQuery;
      if ($ && $.fn && $.fn.modal) { try { $(box).modal('hide'); } catch (e) { /* ignore */ } }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    }
  }
  async function waitFor(fn, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) { var v = fn(); if (v) return v; await sleep(150); }
    return null;
  }
  function lastNameOf(rowName) {
    var toks = rowName.split(/\s+/).filter(function (t) { return !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(t); });
    return toks.length ? toks[toks.length - 1].toLowerCase() : '';
  }

  // ---------- run ----------
  var stopFlag = false, running = false;
  async function collect() {
    if (running) return;
    running = true; stopFlag = false;
    var tables = findGradeTables();
    if (!tables.length) {
      status('No grade table found. Open the Director Dashboard list that shows "Student Name" and grades, then try again.', true);
      running = false; return;
    }
    var jobs = [];
    tables.forEach(function (t) { t.rows.forEach(function (tr) { jobs.push({ names: t.names, tr: tr }); }); });
    var state = load(), ok = 0, problems = 0, prevText = '';
    var open = findReport();
    if (open) { closeReport(open); await sleep(400); }

    for (var i = 0; i < jobs.length; i++) {
      if (stopFlag) { status('Stopped. ' + ok + ' read this run.'); break; }
      var job = jobs[i];
      var cells = rowRecord(job.names, job.tr);
      var nameKey = Object.keys(cells).find(function (k) { return /student\s*name/i.test(k); });
      var rowName = nameKey ? cells[nameKey] : '';
      status('Reading ' + (i + 1) + ' of ' + jobs.length + ': ' + rowName);
      var rec = { collectedAt: new Date().toISOString(), page: location.pathname, rowName: rowName, rowCells: cells, warnings: [] };

      clickTarget(job.tr).click();
      var rep = await waitFor(function () {
        var r = findReport();
        if (!r) return null;
        var t = txt(r.root);
        if (t === prevText || !/Faculty Instructor/i.test(t)) return null;
        return r;
      }, 15000);
      if (rep) {
        // Let content finish loading: wait until the text stops changing.
        var last = '', same = 0;
        for (var k = 0; k < 20 && same < 2; k++) {
          await sleep(150);
          var now = txt(rep.root);
          same = now === last ? same + 1 : 0;
          last = now;
        }
        prevText = txt(rep.root);
        var parsed = parseReport(rep);
        delete parsed.signatureText;
        Object.keys(parsed).forEach(function (k2) { rec[k2] = parsed[k2]; });
        var ln = lastNameOf(rowName);
        if (ln && prevText.toLowerCase().indexOf(ln) < 0) rec.warnings.push('The report did not show the name "' + rowName + '". It may belong to another student.');
        if (!parsed.elements.length) rec.warnings.push('Could not read the element table in the report.');
        closeReport(rep);
        await waitFor(function () { var r2 = findReport(); return !r2 || !visible(r2.table); }, 4000);
      } else {
        rec.warnings.push('The report did not open. Only the dashboard row was saved.');
        problems++;
      }
      var id = [rec.course || '', rec.seminar || '', rowName].join('|').toLowerCase();
      state.records[id] = rec;
      save(state);
      ok++;
      await sleep(350);
    }
    running = false;
    var total = Object.keys(load().records).length;
    if (!stopFlag) status('Done. Read ' + ok + ' students on this page' + (problems ? ' (' + problems + ' with problems)' : '') + '. ' + total + ' saved in total. Open the next seminar or course and collect again, or download.');
    refresh();
  }

  // ---------- downloads ----------
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); }
  function downloadJson() {
    var recs = Object.keys(load().records).map(function (k) { return load().records[k]; });
    if (!recs.length) { status('Nothing collected yet.', true); return; }
    download('compass-grades-' + stamp() + '.json',
      JSON.stringify({ format: 'compass-grade-export', version: 1, exportedAt: new Date().toISOString(), records: recs }, null, 1),
      'application/json');
  }
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv() {
    var st = load(), recs = Object.keys(st.records).map(function (k) { return st.records[k]; });
    if (!recs.length) { status('Nothing collected yet.', true); return; }
    var els = [];
    recs.forEach(function (r) { (r.elements || []).forEach(function (e) { if (els.indexOf(e.element) < 0) els.push(e.element); }); });
    var head = ['Course', 'Seminar', 'Faculty', 'Student', 'Report name'].concat(els, els.map(function (e) { return e + ' comment'; }), ['Date', 'Warnings']);
    var rows = [head].concat(recs.map(function (r) {
      var get = function (n, f) { var e = (r.elements || []).find(function (x) { return x.element === n; }); return e ? e[f] : ''; };
      return [r.course, r.seminar, r.faculty, r.rowName, r.name]
        .concat(els.map(function (n) { return get(n, 'rating'); }), els.map(function (n) { return get(n, 'comment'); }), [r.date, (r.warnings || []).join(' ')]);
    }));
    download('compass-grades-' + stamp() + '.csv', rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'), 'text/csv');
  }

  // Page structure with all text removed, to fix the collector if Compass changes. No names, no grades.
  function diagnostics() {
    function mask(s) { return String(s).replace(/[A-Za-z]/g, 'x').replace(/\d/g, '9').slice(0, 80); }
    function walk(el, depth) {
      if (depth > 30 || !el || el.nodeType !== 1 || el === panel) return null;
      var node = { tag: el.tagName.toLowerCase() };
      if (el.id) node.id = el.id;
      if (el.className && typeof el.className === 'string') node.cls = el.className;
      ['role', 'type', 'data-toggle', 'data-bs-toggle', 'data-target', 'data-dismiss', 'aria-label', 'title'].forEach(function (a) {
        if (el.hasAttribute(a)) node[a] = el.getAttribute(a);
      });
      if (el.hasAttribute('onclick')) node.onclick = mask(el.getAttribute('onclick'));
      if (el.hasAttribute('href')) node.href = mask(el.getAttribute('href'));
      node.vis = visible(el);
      var own = Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); }).length;
      if (own) {
        var t = Array.prototype.map.call(el.childNodes, function (n) { return n.nodeType === 3 ? n.textContent : ''; }).join(' ').trim();
        // Keep only the fixed labels the collector looks for.
        node.text = /^(student name|oral|strategic thinking|writing|overall|element|evaluation|evaluator's comments|course evaluation report|faculty instructor:?|academic program:?|course:?|seminar:?|term:?|date:?|signature:?|print|close|×)$/i.test(t) ? t : '[' + t.length + ' chars]';
      }
      var kids = [];
      for (var i = 0; i < el.children.length; i++) { var k = walk(el.children[i], depth + 1); if (k) kids.push(k); }
      if (kids.length) node.kids = kids;
      return node;
    }
    var out = {
      url: location.origin + location.pathname,
      frames: document.querySelectorAll('iframe, frame').length,
      jquery: !!window.jQuery, gradeTables: findGradeTables().length, reportOpen: !!findReport(),
      body: walk(document.body, 0)
    };
    download('compass-structure-' + stamp() + '.json', JSON.stringify(out, null, 1), 'application/json');
    status('Saved a structure file. It has no names or grades, only page layout. Send it if the collector fails.');
  }

  // ---------- panel ----------
  var panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Grade collector');
  panel.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;width:340px;background:#fff;color:#111;' +
    'border:1px solid #888;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.25);font:13px/1.4 system-ui,Segoe UI,sans-serif;padding:12px;';
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
    '<strong style="font-size:14px">Grade collector</strong>' +
    '<button data-act="hide" aria-label="Close" style="border:0;background:none;font-size:18px;cursor:pointer">×</button></div>' +
    '<div data-role="count" style="margin-bottom:6px;color:#444"></div>' +
    '<div data-role="status" aria-live="polite" style="min-height:36px;margin-bottom:8px;color:#333"></div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
    '<button data-act="collect" style="' + btn(true) + '">Collect this page</button>' +
    '<button data-act="stop" style="' + btn() + '">Stop</button>' +
    '<button data-act="json" style="' + btn() + '">Download for review</button>' +
    '<button data-act="csv" style="' + btn() + '">Download CSV</button>' +
    '<button data-act="clear" style="' + btn() + '">Clear saved data</button>' +
    '<button data-act="diag" style="' + btn() + '">Structure file</button></div>' +
    '<div style="margin-top:8px;color:#555;font-size:12px">Data stays in this browser. Nothing is sent anywhere. Clear saved data when you finish.</div>';
  function btn(primary) {
    return 'padding:5px 9px;border-radius:5px;cursor:pointer;font:inherit;' +
      (primary ? 'background:#1c5cab;color:#fff;border:1px solid #1c5cab;' : 'background:#f3f3f1;color:#111;border:1px solid #bbb;');
  }
  function status(msg, bad) {
    var s = panel.querySelector('[data-role="status"]');
    s.textContent = msg; s.style.color = bad ? '#b00020' : '#333';
  }
  function refresh() {
    var recs = load().records, keys = Object.keys(recs);
    var courses = {}, sems = {};
    keys.forEach(function (k) { courses[recs[k].course || '?'] = 1; sems[(recs[k].course || '?') + '|' + (recs[k].seminar || '?')] = 1; });
    panel.querySelector('[data-role="count"]').textContent = keys.length + ' students saved · ' +
      Object.keys(sems).length + ' seminars · ' + Object.keys(courses).length + ' courses';
  }
  panel.addEventListener('click', function (e) {
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    if (act === 'collect') collect();
    else if (act === 'stop') stopFlag = true;
    else if (act === 'json') downloadJson();
    else if (act === 'csv') downloadCsv();
    else if (act === 'diag') diagnostics();
    else if (act === 'hide') panel.style.display = 'none';
    else if (act === 'clear') {
      if (confirm('Delete all grade data saved by the collector in this browser?')) { clearStore(); refresh(); status('Cleared.'); }
    }
  });
  document.body.appendChild(panel);
  refresh();
  var tables = findGradeTables(), n = 0;
  tables.forEach(function (t) { n += t.rows.length; });
  status(n ? 'Found ' + n + ' students on this page. Click Collect this page.' : 'No grade table found on this page yet.', !n);
  window.__gradeCollector = { show: function () { panel.style.display = 'block'; refresh(); }, collect: collect };
})();
