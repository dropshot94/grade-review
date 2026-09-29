// Compass grade collector. Runs inside Compass, in your own logged-in browser,
// as a bookmarklet or pasted into the browser console.
// Two ways to use it:
//  - On a seminar's student list: "Collect this page" reads every student's report.
//  - On the page where you pick a seminar: "Collect many seminars" opens each chosen
//    seminar in a work window inside this page and reads every report in each.
// It sends nothing anywhere: records stay in this browser until you download them.
(function () {
  'use strict';
  var KEY = 'gradeCollector.v1';
  var VERSION = '3';
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
  function docsIn(doc) {
    var out = [doc];
    var frames = doc.querySelectorAll('iframe, frame');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i] === helperFrame) continue;
      try { if (frames[i].contentDocument && visible(frames[i])) out.push(frames[i].contentDocument); } catch (e) { /* cross-origin */ }
    }
    return out;
  }
  function cellsOf(tr) { return Array.prototype.filter.call(tr.children, function (c) { return /^(TD|TH)$/.test(c.tagName); }); }
  async function waitFor(fn, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) {
      var v;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      await sleep(150);
    }
    return null;
  }

  // ---------- student list table ----------
  function headerOf(table) {
    var rows = table.querySelectorAll('tr');
    for (var i = 0; i < rows.length && i < 3; i++) {
      var names = cellsOf(rows[i]).map(txt);
      if (names.some(function (n) { return /student\s*name/i.test(n); })) return { row: rows[i], names: names };
    }
    return null;
  }
  function dataRows(table, headerRow) {
    return Array.prototype.filter.call(table.querySelectorAll('tr'), function (tr) {
      if (tr === headerRow) return false;
      if (tr.closest('table') !== table) return false;
      var cells = cellsOf(tr);
      return cells.length >= 3 && cells.some(function (c) { return c.tagName === 'TD'; }) && visible(tr) && txt(tr).length > 0;
    });
  }
  function findGradeTables(doc) {
    var found = [];
    var tables = doc.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (!visible(t)) continue;
      var h = headerOf(t);
      if (!h) continue;
      var bodyTable = t;
      var bodyRows = dataRows(t, h.row);
      if (!bodyRows.length) {
        // DataTables with scrolling splits the header and body into two tables.
        var wrap = t.closest('.dataTables_scroll, .dataTables_wrapper');
        var other = wrap && wrap.querySelector('.dataTables_scrollBody table');
        if (other) { bodyTable = other; bodyRows = dataRows(other, null); }
      }
      if (bodyRows.length) found.push({ names: h.names, rows: bodyRows, table: bodyTable });
    }
    return found;
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
  function findReport(doc) {
    var ds = docsIn(doc);
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
        if (!/Faculty Instructor/i.test(txt(root))) root = t.parentElement || t;
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
      elements: elements
    };
  }
  function closeReport(rep) {
    var doc = rep.root.ownerDocument, win = doc.defaultView;
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
      var $ = win.jQuery;
      if ($ && $.fn && $.fn.modal) { try { $(box).modal('hide'); } catch (e) { /* ignore */ } }
      doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    }
  }
  function lastNameOf(rowName) {
    var toks = rowName.split(/\s+/).filter(function (t) { return !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(t); });
    return toks.length ? toks[toks.length - 1].toLowerCase() : '';
  }

  // ---------- read every student on one list ----------
  var stopFlag = false, running = false;

  // getDoc returns the document that holds the student list (this page, or the work window).
  async function collectList(getDoc, label) {
    var doc = getDoc();
    var tables = findGradeTables(doc);
    if (!tables.length) return { ok: 0, problems: 0, noTable: true };
    var jobs = [];
    tables.forEach(function (t) { t.rows.forEach(function (tr) { jobs.push({ names: t.names, tr: tr }); }); });
    var state = load(), ok = 0, problems = 0, prevText = '';
    var open = findReport(doc);
    if (open) { closeReport(open); await sleep(400); }

    for (var i = 0; i < jobs.length; i++) {
      if (stopFlag) break;
      var job = jobs[i];
      var cells = rowRecord(job.names, job.tr);
      var nameKey = Object.keys(cells).find(function (k) { return /student\s*name/i.test(k); });
      var rowName = nameKey ? cells[nameKey] : '';
      status(label + 'Reading ' + (i + 1) + ' of ' + jobs.length + ': ' + rowName);
      var rec = { collectedAt: new Date().toISOString(), page: doc.location ? doc.location.pathname : '', rowName: rowName, rowCells: cells, warnings: [] };

      clickTarget(job.tr).click();
      var rep = await waitFor(function () {
        var r = findReport(getDoc());
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
        Object.keys(parsed).forEach(function (k2) { rec[k2] = parsed[k2]; });
        var ln = lastNameOf(rowName);
        if (ln && prevText.toLowerCase().indexOf(ln) < 0) rec.warnings.push('The report did not show the name "' + rowName + '". It may belong to another student.');
        if (!parsed.elements.length) rec.warnings.push('Could not read the element table in the report.');
        closeReport(rep);
        await waitFor(function () { var r2 = findReport(getDoc()); return !r2 || !visible(r2.table); }, 4000);
      } else {
        rec.warnings.push('The report did not open. Only the student list row was saved.');
        problems++;
      }
      var id = [rec.course || '', rec.seminar || '', rowName].join('|').toLowerCase();
      state = load();
      state.records[id] = rec;
      save(state);
      refresh();
      ok++;
      await sleep(350);
    }
    return { ok: ok, problems: problems, total: jobs.length };
  }

  async function collectThisPage() {
    if (running) return;
    running = true; stopFlag = false;
    var res = await collectList(function () { return document; }, '');
    running = false;
    var total = Object.keys(load().records).length;
    if (res.noTable) status('No student list found on this page. On the page where you pick a seminar, use Collect many seminars.', true);
    else if (stopFlag) status('Stopped. ' + res.ok + ' read this run.');
    else status('Done. Read ' + res.ok + ' students' + (res.problems ? ' (' + res.problems + ' with problems)' : '') + '. ' + total + ' saved in total.');
    refresh();
  }

  // ---------- many seminars ----------
  // Choices: groups of similar links or clickable items, and drop-down lists.
  // Anything that can pick a seminar: links, buttons, clickable rows and cells.
  var CHOICE_SEL = 'a, button, [onclick], [role="button"], input[type="button"], input[type="submit"], input[type="image"]';
  function linkInfo(el, doc) {
    var href = el.getAttribute('href') || '';
    var oc = el.getAttribute('onclick') || '';
    if (el.tagName === 'A' && href && !/^(#|javascript:)/i.test(href)) {
      var u;
      try { u = new URL(href, doc.baseURI); } catch (e) { return null; }
      if (u.origin !== location.origin) return null;
      var names = []; u.searchParams.forEach(function (v, k) { if (names.indexOf(k) < 0) names.push(k); });
      return { sig: 'link:' + u.pathname + '?' + names.sort().join('&'), url: u.href };
    }
    var code = oc || href.replace(/^javascript:/i, '');
    if (code) {
      var fn = code.match(/([A-Za-z_$][\w$.]*)\s*\(/);
      return { sig: 'click:' + el.tagName + ':' + (fn ? fn[1] : '?'), url: null };
    }
    // A button in a table row with a script attached some other way (for example, an edit icon).
    if (el.closest('tr') && el.tagName !== 'TR' && el.tagName !== 'TD') {
      return { sig: 'rowbutton:' + el.tagName + ':' + (typeof el.className === 'string' ? el.className.trim() : ''), url: null };
    }
    return null;
  }
  function headerNames(table) {
    var row = table.querySelector('thead tr') || table.querySelector('tr');
    return row ? cellsOf(row).map(txt) : [];
  }
  // Name a choice. Icon-only buttons in a table take their name from the row: "Seminar 4 · Course".
  function labelFor(el) {
    var own = txt(el) || el.value || '';
    var tr = el.closest('tr');
    if (tr && (own.length < 4 || /^(edit|view|open|select|go|details?)$/i.test(own))) {
      var cells = cellsOf(tr), heads = headerNames(tr.closest('table'));
      var sem = '', course = '';
      cells.forEach(function (c, i) {
        if (c.contains(el)) return;
        var h = heads[i] || '', v = txt(c);
        if (!v) return;
        if (/semin/i.test(h) && !sem) sem = 'Seminar ' + v;
        else if (/course/i.test(h) && !course) course = v;
      });
      if (sem || course) return [sem, course].filter(Boolean).join(' \u00b7 ');
      var rowText = cells.filter(function (c) { return !c.contains(el); }).map(txt).filter(Boolean).join(' \u00b7 ');
      if (rowText) return rowText.slice(0, 100);
    }
    return (own || el.getAttribute('title') || el.getAttribute('aria-label') || '').slice(0, 100);
  }
  function findLinkGroups(doc) {
    var groups = {}, order = [];
    var els = doc.querySelectorAll(CHOICE_SEL);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (panel.contains(el) || !visible(el)) continue;
      if (el.parentElement && el.parentElement.closest(CHOICE_SEL)) continue; // inner part of another choice
      var text = labelFor(el);
      if (!text) continue;
      var info = linkInfo(el, doc);
      if (!info) continue;
      if (!groups[info.sig]) { groups[info.sig] = []; order.push(info.sig); }
      var g = groups[info.sig];
      if (info.url && g.some(function (x) { return x.url === info.url; })) continue;
      g.push({ text: text, url: info.url, index: g.length });
    }
    return order.filter(function (s) { return groups[s].length >= 2; }).map(function (s) {
      return { kind: 'links', sig: s, items: groups[s] };
    });
  }
  function selectLabel(sel, doc) {
    if (sel.id) {
      var l = doc.querySelector('label[for="' + sel.id.replace(/"/g, '') + '"]');
      if (l && txt(l)) return txt(l);
    }
    var p = sel.closest('label');
    if (p && txt(p)) return txt(p).slice(0, 40);
    var prev = sel.previousElementSibling;
    if (prev && txt(prev) && txt(prev).length < 40) return txt(prev);
    return sel.name || sel.id || 'drop-down list';
  }
  function findSelects(doc) {
    var out = [];
    var sels = doc.querySelectorAll('select');
    for (var i = 0; i < sels.length; i++) {
      var s = sels[i];
      if (panel.contains(s) || !visible(s) || s.options.length < 2) continue;
      out.push({
        kind: 'select', index: i, name: s.name, id: s.id, label: selectLabel(s, doc),
        items: Array.prototype.map.call(s.options, function (o) { return { text: txt(o) || o.value, value: o.value }; })
          .filter(function (o) { return o.value !== '' && !/^(-+|select|choose|all)\b/i.test(o.text); })
      });
    }
    return out.filter(function (s) { return s.items.length >= 2; });
  }
  function scoreGroup(g) {
    var hay = (g.sig || g.label || '') + ' ' + g.items.map(function (x) { return x.text; }).join(' ');
    return (/semin|\bsem\b/i.test(hay) ? 1000 : 0) + g.items.length;
  }

  // Work window: an iframe on this page, or a pop-up if Compass refuses to load in a frame.
  var helperFrame = null, helperPopup = null;
  function helperWin() { return helperPopup || (helperFrame && helperFrame.contentWindow); }
  function helperDoc() { var w = helperWin(); return w && w.document; }
  function openHelper() {
    if (helperFrame || helperPopup) return;
    helperFrame = document.createElement('iframe');
    helperFrame.title = 'Grade collector work window';
    helperFrame.style.cssText = 'position:fixed;left:12px;top:12px;width:calc(100vw - 400px);height:calc(100vh - 24px);' +
      'z-index:2147483646;background:#fff;border:2px solid #1c5cab;border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.25)';
    document.body.appendChild(helperFrame);
  }
  function closeHelper() {
    if (helperFrame) { helperFrame.remove(); helperFrame = null; }
    if (helperPopup) { try { helperPopup.close(); } catch (e) { /* ignore */ } helperPopup = null; }
  }
  function docReady(oldDoc) {
    var w = helperWin();
    try {
      var d = w.document;
      if (d && d !== oldDoc && d.readyState === 'complete' && w.location.href !== 'about:blank') return d;
    } catch (e) {
      throw new Error('blocked');
    }
    return null;
  }
  // Load a page in the work window; switch to a pop-up if a frame is refused.
  async function helperGo(url) {
    var oldDoc = null;
    try { oldDoc = helperDoc(); } catch (e) { /* ignore */ }
    try {
      if (helperPopup) helperPopup.location.href = url;
      else helperFrame.src = url;
      var d = await waitForNav(oldDoc, 30000);
      if (d) return d;
      throw new Error('blocked');
    } catch (e) {
      if (helperPopup) throw new Error('The work window could not load ' + url);
      helperFrame.remove(); helperFrame = null;
      helperPopup = window.open(url, 'gradeCollectorWork', 'width=1200,height=900');
      if (!helperPopup) throw new Error('Compass will not load inside this page, and the browser blocked the pop-up. Allow pop-ups for this site and try again.');
      status('Using a pop-up window for Compass pages. Keep it open.');
      var d2 = await waitForNav(null, 30000);
      if (!d2) throw new Error('The pop-up window could not load ' + url);
      return d2;
    }
  }
  async function waitForNav(oldDoc, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) {
      var d = docReady(oldDoc); // throws if blocked
      if (d) return d;
      await sleep(200);
    }
    return null;
  }
  function listSignature(doc) {
    var t = findGradeTables(doc);
    return t.length ? t.map(function (x) { return x.rows.map(txt).join('|'); }).join('||') : '';
  }
  // Run an action in the work window, then wait for a new page or a changed student list.
  async function helperAct(action) {
    var before = helperDoc(), sigBefore = listSignature(before);
    action(before);
    return await waitFor(function () {
      var d = docReady(before);
      if (d) return d;
      var cur = helperDoc();
      var sig = listSignature(cur);
      return sig && sig !== sigBefore ? cur : null;
    }, 30000);
  }
  function findSelectIn(doc, choice) {
    if (choice.id && doc.getElementById(choice.id)) return doc.getElementById(choice.id);
    if (choice.name && doc.getElementsByName(choice.name)[0]) return doc.getElementsByName(choice.name)[0];
    return doc.querySelectorAll('select')[choice.index] || null;
  }
  function submitFor(sel) {
    var form = sel.form;
    var scope = form || sel.parentElement;
    var btn = scope && scope.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
    if (!btn && scope) {
      var cands = scope.querySelectorAll('button, input[type="button"], a');
      for (var i = 0; i < cands.length; i++) if (/^(go|submit|view|show|search|select|open|display)$/i.test(txt(cands[i]) || cands[i].value || '')) { btn = cands[i]; break; }
    }
    if (btn) btn.click();
    else if (form) { if (form.requestSubmit) form.requestSubmit(); else form.submit(); }
  }

  // Open one choice in the work window and wait for its student list.
  async function openChoice(choice, item, startUrl, otherSelects) {
    if (choice.kind === 'links' && item.url) {
      await helperGo(item.url);
    } else {
      await helperGo(startUrl);
      var d = helperDoc();
      if (choice.kind === 'links') {
        var el = null, els = d.querySelectorAll(CHOICE_SEL);
        for (var i = 0; i < els.length && !el; i++) {
          var info = linkInfo(els[i], d);
          if (info && info.sig === choice.sig && visible(els[i]) && labelFor(els[i]) === item.text) el = els[i];
        }
        if (!el) throw new Error('Could not find "' + item.text + '" after reloading the page.');
        await helperAct(function () { el.click(); });
      } else {
        // Copy the other drop-down values from this page, then pick the item.
        otherSelects.forEach(function (o) {
          var s = findSelectIn(d, o);
          if (s && s.value !== o.value) { s.value = o.value; s.dispatchEvent(new d.defaultView.Event('change', { bubbles: true })); }
        });
        await sleep(300);
        var sel = findSelectIn(helperDoc(), choice);
        if (!sel) throw new Error('Could not find the drop-down list after reloading the page.');
        await helperAct(function (doc) {
          var s2 = findSelectIn(doc, choice);
          s2.value = item.value;
          s2.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
          s2.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
          // If the change did not start loading a new page, press the form's button.
          setTimeout(function () {
            try { if (helperDoc() === doc && doc.readyState === 'complete') submitFor(s2); } catch (e) { /* page moved on */ }
          }, 700);
        });
      }
    }
    var ok = await waitFor(function () { return findGradeTables(helperDoc()).length > 0; }, 20000);
    if (!ok) throw new Error('No student list appeared for "' + item.text + '".');
  }

  async function collectMany(choice, items) {
    if (running) return;
    running = true; stopFlag = false;
    var startUrl = location.href;
    var otherSelects = findSelects(document).filter(function (s) { return !(choice.kind === 'select' && s.index === choice.index); })
      .map(function (s) { var el = document.querySelectorAll('select')[s.index]; return { id: s.id, name: s.name, index: s.index, value: el.value }; });
    var done = 0, students = 0, issues = [];
    openHelper();
    for (var i = 0; i < items.length; i++) {
      if (stopFlag) break;
      var item = items[i];
      var label = 'Seminar ' + (i + 1) + ' of ' + items.length + ' (' + item.text + '). ';
      status(label + 'Opening…');
      try {
        await openChoice(choice, item, startUrl, otherSelects);
        var res = await collectList(helperDoc, label);
        if (res.noTable) issues.push(item.text + ': no student list');
        else {
          students += res.ok;
          if (res.problems) issues.push(item.text + ': ' + res.problems + ' reports did not open');
        }
        done++;
      } catch (e) {
        issues.push(item.text + ': ' + e.message);
        if (/blocked the pop-up/.test(e.message)) break;
      }
      refresh();
    }
    closeHelper();
    running = false;
    var total = Object.keys(load().records).length;
    status((stopFlag ? 'Stopped. ' : 'Done. ') + done + ' of ' + items.length + ' seminars, ' + students + ' students read. ' +
      total + ' saved in total.' + (issues.length ? ' Problems: ' + issues.join('; ') + '.' : ''), issues.length > 0);
    refresh();
  }

  function showChooser() {
    if (running) return;
    var choices = findLinkGroups(document).concat(findSelects(document));
    choices.sort(function (a, b) { return scoreGroup(b) - scoreGroup(a); });
    var box = panel.querySelector('[data-role="chooser"]');
    if (!choices.length) {
      status('No seminar links or drop-down lists found here. Open the page where you pick a seminar, then try again.', true);
      return;
    }
    function describe(c) {
      var sample = c.items.slice(0, 3).map(function (x) { return x.text; }).join(', ');
      return (c.kind === 'select' ? 'List "' + c.label + '": ' : 'Links: ') + sample + (c.items.length > 3 ? ', …' : '') + ' (' + c.items.length + ')';
    }
    box.innerHTML =
      '<div style="margin:8px 0 4px;font-weight:600">Which seminars?</div>' +
      '<select data-role="source" style="width:100%;margin-bottom:6px;font:inherit">' +
      choices.slice(0, 8).map(function (c, i) { return '<option value="' + i + '">' + esc(describe(c)) + '</option>'; }).join('') + '</select>' +
      '<div style="margin-bottom:4px"><a href="#" data-act="all">All</a> · <a href="#" data-act="none">None</a></div>' +
      '<div data-role="items" style="max-height:240px;overflow:auto;border:1px solid #ddd;border-radius:4px;padding:4px 6px"></div>' +
      '<div style="display:flex;gap:6px;margin-top:6px"><button data-act="start" style="' + btn(true) + '">Start</button>' +
      '<button data-act="cancel" style="' + btn() + '">Cancel</button></div>' +
      '<div style="margin-top:6px;color:#555;font-size:12px">A work window opens over this page. Leave this tab open until it finishes.</div>';
    box.style.display = 'block';
    panel.style.width = '380px';
    function fill() {
      var c = choices[Number(box.querySelector('[data-role="source"]').value)];
      box.querySelector('[data-role="items"]').innerHTML = c.items.map(function (x, i) {
        return '<label style="display:block"><input type="checkbox" data-i="' + i + '" checked> ' + esc(x.text) + '</label>';
      }).join('');
    }
    fill();
    box.querySelector('[data-role="source"]').onchange = fill;
    box.__start = function () {
      var c = choices[Number(box.querySelector('[data-role="source"]').value)];
      var picked = Array.prototype.filter.call(box.querySelectorAll('[data-i]'), function (x) { return x.checked; })
        .map(function (x) { return c.items[Number(x.getAttribute('data-i'))]; });
      if (!picked.length) { status('Tick at least one seminar.', true); return; }
      hideChooser();
      collectMany(c, picked);
    };
  }
  function hideChooser() {
    var box = panel.querySelector('[data-role="chooser"]');
    box.style.display = 'none'; box.innerHTML = '';
    panel.style.width = '340px';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

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
  function allRecords() { var st = load(); return Object.keys(st.records).map(function (k) { return st.records[k]; }); }
  function downloadJson() {
    var recs = allRecords();
    if (!recs.length) { status('Nothing collected yet.', true); return; }
    download('compass-grades-' + stamp() + '.json',
      JSON.stringify({ format: 'compass-grade-export', version: 1, collector: VERSION, exportedAt: new Date().toISOString(), records: recs }, null, 1),
      'application/json');
  }
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv() {
    var recs = allRecords();
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
  function maskUrl(s) {
    try {
      var u = new URL(s, document.baseURI);
      var names = []; u.searchParams.forEach(function (v, k) { names.push(k + '=9'); });
      return (u.origin === location.origin ? '' : u.origin) + u.pathname + (names.length ? '?' + names.join('&') : '') + (u.hash ? '#x' : '');
    } catch (e) { return mask(s); }
  }
  function maskCode(s) { return String(s).replace(/'[^']*'|"[^"]*"/g, "'x'").replace(/\d+/g, '9').slice(0, 120); }
  function mask(s) { return String(s).replace(/[A-Za-z]/g, 'x').replace(/\d/g, '9').slice(0, 80); }
  function diagnostics() {
    function walk(el, depth) {
      if (depth > 30 || !el || el.nodeType !== 1 || el === panel || el === helperFrame) return null;
      var node = { tag: el.tagName.toLowerCase() };
      if (el.id) node.id = el.id;
      if (el.className && typeof el.className === 'string') node.cls = el.className;
      ['role', 'type', 'name', 'method', 'target', 'data-toggle', 'data-bs-toggle', 'data-target', 'data-dismiss', 'aria-label', 'title'].forEach(function (a) {
        if (el.hasAttribute(a)) node[a] = el.getAttribute(a);
      });
      ['onclick', 'onchange', 'onsubmit'].forEach(function (a) { if (el.hasAttribute(a)) node[a] = maskCode(el.getAttribute(a)); });
      if (el.hasAttribute('href')) node.href = /^javascript:/i.test(el.getAttribute('href')) ? maskCode(el.getAttribute('href')) : maskUrl(el.getAttribute('href'));
      if (el.hasAttribute('action')) node.action = maskUrl(el.getAttribute('action'));
      if (el.tagName === 'SELECT') node.options = el.options.length;
      node.vis = visible(el);
      var own = Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); }).length;
      if (own) {
        var t = Array.prototype.map.call(el.childNodes, function (n) { return n.nodeType === 3 ? n.textContent : ''; }).join(' ').trim();
        // Keep only fixed labels. Everything else becomes a length.
        node.text = /^(student name|oral|strategic thinking|writing|overall|element|evaluation|evaluator's comments|course evaluation report|faculty instructor:?|academic program:?|course:?|seminar:?|term:?|date:?|signature:?|print|close|go|submit|view|search|select|back|home|×)$/i.test(t) ? t : '[' + t.length + ' chars]';
      }
      if (el.tagName === 'OPTION') delete node.text;
      var kids = [];
      if (el.tagName !== 'SELECT') for (var i = 0; i < el.children.length; i++) { var k = walk(el.children[i], depth + 1); if (k) kids.push(k); }
      if (kids.length) node.kids = kids;
      return node;
    }
    var out = {
      collector: VERSION,
      url: maskUrl(location.href),
      frames: document.querySelectorAll('iframe, frame').length,
      jquery: !!window.jQuery, gradeTables: findGradeTables(document).length, reportOpen: !!findReport(document),
      linkGroups: findLinkGroups(document).map(function (g) { return { sig: g.sig.replace(/\d+/g, '9'), count: g.items.length }; }),
      selects: findSelects(document).map(function (s) { return { name: s.name, id: s.id, options: s.items.length }; }),
      body: walk(document.body, 0)
    };
    download('compass-structure-' + stamp() + '.json', JSON.stringify(out, null, 1), 'application/json');
    status('Saved a structure file. It has no names or grades, only page layout. Send it if the collector fails.');
  }

  // ---------- panel ----------
  var panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Grade collector');
  panel.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;width:340px;max-height:calc(100vh - 24px);overflow:auto;background:#fff;color:#111;' +
    'border:1px solid #888;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.25);font:13px/1.4 system-ui,Segoe UI,sans-serif;padding:12px;';
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
    '<strong style="font-size:14px">Grade collector</strong>' +
    '<button data-act="hide" aria-label="Close" style="border:0;background:none;font-size:18px;cursor:pointer">×</button></div>' +
    '<div data-role="count" style="margin-bottom:6px;color:#444"></div>' +
    '<div data-role="status" aria-live="polite" style="min-height:36px;margin-bottom:8px;color:#333"></div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
    '<button data-act="collect" style="' + btn(true) + '">Collect this page</button>' +
    '<button data-act="many" style="' + btn(true) + '">Collect many seminars</button>' +
    '<button data-act="stop" style="' + btn() + '">Stop</button>' +
    '<button data-act="json" style="' + btn() + '">Download for review</button>' +
    '<button data-act="csv" style="' + btn() + '">Download CSV</button>' +
    '<button data-act="clear" style="' + btn() + '">Clear saved data</button>' +
    '<button data-act="diag" style="' + btn() + '">Structure file</button></div>' +
    '<div data-role="chooser" style="display:none"></div>' +
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
    if (!act) return;
    if (e.target.tagName === 'A') e.preventDefault();
    var box = panel.querySelector('[data-role="chooser"]');
    if (act === 'collect') collectThisPage();
    else if (act === 'many') showChooser();
    else if (act === 'start') box.__start();
    else if (act === 'cancel') hideChooser();
    else if (act === 'all' || act === 'none') box.querySelectorAll('[data-i]').forEach(function (x) { x.checked = act === 'all'; });
    else if (act === 'stop') { stopFlag = true; status('Stopping after the current student…'); }
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
  var n = 0;
  findGradeTables(document).forEach(function (t) { n += t.rows.length; });
  status(n ? 'Found ' + n + ' students on this page. Click Collect this page.'
    : 'No student list on this page. If this is where you pick a seminar, click Collect many seminars.');
  window.__gradeCollector = { show: function () { panel.style.display = 'block'; refresh(); }, collect: collectThisPage };
})();
