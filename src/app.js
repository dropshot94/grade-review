// Grade Review page. Runs offline; the page's security policy blocks all network requests.
/* global COLLECTOR_SRC, analyze, parseExport, normalizeRecord, mergeRecords, makeSampleExport, toCsv,
   GRADE_BUCKETS, GRADE_ORDER, FLAG_TYPES, SEVERITY_ORDER, DEFAULT_SETTINGS, RATING_SHORT, gradeBucket, profileOf */

const LOG_KEY = 'gradeReview.log.v1';
const SETTINGS_KEY = 'gradeReview.settings.v1';
const BUCKET_CLASS = { 'A': 'g-A', 'A-': 'g-Am', 'B+': 'g-Bp', 'B': 'g-B', 'B- or lower': 'g-Bm' };
const SEV_LABEL = { high: 'High', medium: 'Check', low: 'Note' };
const SEV_ICON = {
  high: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 15.5 14.5H.5z"/><path fill="#fff" d="M7.2 5.5h1.6v4.6H7.2zM7.2 11.2h1.6v1.6H7.2z"/></svg>',
  medium: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path fill="#000" d="M7.2 3.8h1.6v5.2H7.2zM7.2 10.4h1.6V12H7.2z"/></svg>',
  low: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="currentColor" d="M7.2 7h1.6v5H7.2zM7.2 4h1.6v1.6H7.2z"/></svg>',
};
const STATUS = ['Not reviewed', 'Reviewed, no issues', 'Query faculty', 'Resolved'];

const state = {
  records: [],
  sources: [],
  result: null,
  tab: 'overview',
  course: '',
  settings: loadJson(SETTINGS_KEY, {}),
  log: loadJson(LOG_KEY, {}),
  flagFilter: { sev: { high: true, medium: true, low: false }, type: '', seminar: '', text: '' },
  studentFilter: { seminar: '', text: '', flagged: false, profile: '', grade: '' },
  sort: { overview: { col: 'seminar', dir: 1 }, students: { col: 'seminar', dir: 1 } },
};

function loadJson(key, dflt) {
  try { const t = localStorage.getItem(key); return t ? JSON.parse(t) : dflt; } catch (e) { return dflt; }
}
function saveJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage blocked: keep in memory */ }
}

const $ = sel => document.querySelector(sel);
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(x, d = 2) { return x == null || isNaN(x) ? '–' : x.toFixed(d); }
function signed(x, d = 2) { return x == null ? '–' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d); }
function pct(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }
function letterFor(points) {
  if (points == null) return '';
  const table = [['A', 3.85], ['A-', 3.5], ['B+', 3.15], ['B', 2.85], ['B-', 2.5], ['C+', 2.15], ['C', 1.85]];
  for (const [g, min] of table) if (points >= min) return g;
  return 'below C';
}
function sevBadge(sev) { return `<span class="sev ${sev}">${SEV_ICON[sev]}${SEV_LABEL[sev]}</span>`; }
function logKey(course, seminar) { return `${course}|${seminar}`; }
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function today() { return new Date().toISOString().slice(0, 10); }

// ---------- data ----------
function recompute() {
  state.result = state.records.length ? analyze(state.records, { ...DEFAULT_SETTINGS, ...state.settings }) : null;
  if (state.result && !state.result.courses.some(c => c.name === state.course)) {
    state.course = state.result.courses.length === 1 ? state.result.courses[0].name : '';
  }
  render();
}
function addRecords(list, label) {
  state.records = mergeRecords([state.records, list]);
  state.sources.push(label);
  recompute();
}
async function loadFiles(files) {
  let added = 0;
  for (const f of files) {
    try {
      const recs = parseExport(await f.text());
      state.records = mergeRecords([state.records, recs]);
      state.sources.push(f.name);
      added += recs.length;
    } catch (e) {
      alert(`Could not read ${f.name}: ${e.message}\nUse the "Download for review" file from the collector.`);
    }
  }
  if (added) { toast(`Loaded ${added} records.`); recompute(); }
}

function coursesInView() {
  if (!state.result) return [];
  return state.result.courses.filter(c => !state.course || c.name === state.course);
}
function flagsInView() {
  return state.result.flags.filter(f => !state.course || f.course === state.course);
}
function recordByKey(key) { return state.records.find(r => r.key === key); }

// ---------- render ----------
function render() {
  const hasData = !!state.result;
  $('#clearBtn').hidden = !hasData;
  $('#exportBtn').hidden = !hasData;
  $('#sourceInfo').textContent = hasData
    ? `${state.records.length} student records from ${state.sources.length} file${state.sources.length > 1 ? 's' : ''}`
    : 'No data loaded';
  if (!hasData) { renderWelcome(); return; }

  const flags = flagsInView();
  const tabs = [
    ['overview', 'Seminars'], ['patterns', 'Rating patterns'],
    ['flags', `Flags (${flags.filter(f => f.severity !== 'low').length})`],
    ['students', 'Students'], ['log', 'Review log'], ['setup', 'Collect more'],
  ];
  const courseOpts = state.result.courses.length > 1
    ? `<option value="">All courses</option>` : '';
  $('#app').innerHTML = `
    <nav class="tabs" role="tablist">${tabs.map(([id, label]) =>
      `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${esc(label)}</button>`).join('')}</nav>
    <div class="filters">
      <label>Course <select id="courseSel">${courseOpts}${state.result.courses.map(c =>
        `<option ${c.name === state.course ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    </div>
    <div id="view"></div>`;
  $('#courseSel').value = state.course;
  const view = $('#view');
  if (state.tab === 'overview') view.innerHTML = coursesInView().map(renderCourseOverview).join('');
  else if (state.tab === 'patterns') view.innerHTML = coursesInView().map(renderPatterns).join('');
  else if (state.tab === 'flags') view.innerHTML = renderFlags();
  else if (state.tab === 'students') view.innerHTML = renderStudents();
  else if (state.tab === 'log') view.innerHTML = renderLog();
  else if (state.tab === 'setup') view.innerHTML = renderSetup(false);
  wireSetup();
}

function renderWelcome() {
  $('#app').innerHTML = renderSetup(true);
  wireSetup();
}

function renderSetup(welcome) {
  return `
  <div class="card">
    <h2>${welcome ? 'Review Compass grades before you approve them' : 'Collect more grades'}</h2>
    <p class="lede">This page compares every seminar's grades, finds grades that do not match their ratings or comments,
    and keeps a review log. It runs only in this browser. It cannot send data anywhere.</p>
    <ol class="steps">
      <li><strong>Install the collector (one time).</strong> Drag this button to your browser's bookmarks bar:
        <div style="margin:8px 0"><a class="bookmarklet" id="bm" href="#">Collect grades</a></div>
        <span class="muted">If the bookmarks bar is hidden, press Ctrl+Shift+B. If your browser blocks bookmarklets,
        <button class="link" id="copyCode">copy the collector code</button>, open Compass, press F12, choose Console, paste, and press Enter.</span></li>
      <li><strong>Collect from Compass.</strong> Log in and open the Director Dashboard page where you pick a seminar.
        Click <em>Collect grades</em>. A panel opens. Click <em>Collect many seminars</em>, tick the seminars, and click <em>Start</em>.
        A work window opens over the page and reads every student's report in each seminar. Leave the tab open until it says Done.
        <br><span class="muted">To read only the seminar on screen, open its student list and click <em>Collect this page</em>.
        The panel keeps everything you collect, across seminars and courses.</span></li>
      <li><strong>Download.</strong> In the panel, click <em>Download for review</em>. Then click <em>Clear saved data</em>.</li>
      <li><strong>Load the file here.</strong>
        <div class="drop" id="drop" style="margin-top:8px">Drop the file here, or
          <button class="primary" id="pickBtn2">Choose file</button>
          ${welcome ? ' &nbsp; or &nbsp; <button id="sampleBtn">Try sample data</button>' : ''}</div></li>
    </ol>
  </div>
  <div class="card">
    <h3 style="margin-top:0">If the collector fails</h3>
    <p class="lede" style="margin:0">Click <em>Structure file</em> in the collector panel while a report is open. It saves the page layout
    with every name, grade, and comment removed. Send that file to whoever maintains this tool so they can adjust the collector.</p>
  </div>`;
}

function wireSetup() {
  const bm = $('#bm');
  if (bm) {
    bm.setAttribute('href', 'javascript:' + encodeURIComponent(COLLECTOR_SRC));
    bm.addEventListener('click', e => { e.preventDefault(); toast('Drag this button to your bookmarks bar. Click it on the Compass page.'); });
  }
}

// ----- Seminars (overview) -----
function distBar(sem) {
  const total = sem.graded || 0;
  if (!total) return '<span class="muted">No grades</span>';
  return `<div class="bar" role="img" aria-label="${esc(GRADE_BUCKETS.map(b => `${b}: ${sem.buckets[b].length}`).join(', '))}">` +
    GRADE_BUCKETS.filter(b => sem.buckets[b].length).map(b =>
      `<span class="${BUCKET_CLASS[b]}" style="flex:${sem.buckets[b].length}" data-tip="${esc(`${b}: ${sem.buckets[b].length} of ${total} (${pct(sem.buckets[b].length / total)})`)}"></span>`).join('') +
    '</div>';
}
function legend() {
  return `<div class="legend">${GRADE_BUCKETS.map(b => `<span><i class="${BUCKET_CLASS[b]}"></i>${esc(b)}</span>`).join('')}</div>`;
}

function renderCourseOverview(course) {
  const flags = state.result.flags.filter(f => f.course === course.name);
  const graded = course.records.filter(r => r.points != null);
  const aShare = graded.length ? graded.filter(r => r.points >= 3.7).length / graded.length : null;
  const s = state.settings.seminarThreshold ?? DEFAULT_SETTINGS.seminarThreshold;
  const c = state.settings.calibrationThreshold ?? DEFAULT_SETTINGS.calibrationThreshold;
  const reviewed = course.seminars.filter(x => (state.log[logKey(course.name, x.seminar)] || {}).status > 0).length;

  const cols = [
    ['seminar', 'Seminar'], ['faculty', 'Faculty'], ['n', 'Students', 'num'], ['dist', 'Grade distribution'],
    ['mean', 'Mean', 'num'], ['diff', 'vs rest', 'num'], ['aShare', 'A range', 'num'],
    ['ratingMean', 'Ratings avg', 'num'], ['calibration', 'Grades vs ratings', 'num'],
    ['uniqueComments', 'Own comments', 'num'], ['flags', 'Flags', 'num'], ['status', 'Review'],
  ];
  const sort = state.sort.overview;
  const rows = course.seminars.map(sem => {
    const sf = flags.filter(f => f.seminar === sem.seminar && f.severity !== 'low');
    const entry = state.log[logKey(course.name, sem.seminar)] || {};
    return { sem, sf, status: entry.status || 0 };
  });
  const val = (r, col) => {
    if (col === 'seminar') return isNaN(parseFloat(r.sem.seminar)) ? r.sem.seminar : parseFloat(r.sem.seminar);
    if (col === 'faculty') return r.sem.faculty.join('; ');
    if (col === 'flags') return r.sf.length;
    if (col === 'status') return r.status;
    if (col === 'dist') return r.sem.mean;
    return r.sem[col];
  };
  rows.sort((a, b) => {
    const x = val(a, sort.col), y = val(b, sort.col);
    if (x == null) return 1; if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });

  return `<div class="card">
    <h2>${esc(course.name)}</h2>
    <div class="kpis">
      <div class="kpi"><div class="v">${course.n}</div><div class="l">students</div></div>
      <div class="kpi"><div class="v">${course.seminars.length}</div><div class="l">seminars</div></div>
      <div class="kpi"><div class="v">${fmt(course.mean)}</div><div class="l">mean grade points (${letterFor(course.mean)})</div></div>
      <div class="kpi"><div class="v">${pct(aShare)}</div><div class="l">A or A-</div></div>
      ${course.records.some(r => r.passFail) ? `<div class="kpi"><div class="v">${course.records.filter(r => r.passFail).length}</div><div class="l">pass/fail (not in means)</div></div>` : ''}
      <div class="kpi"><div class="v">${flags.filter(f => f.severity === 'high').length}</div><div class="l">high flags</div></div>
      <div class="kpi"><div class="v">${reviewed} / ${course.seminars.length}</div><div class="l">seminars reviewed</div></div>
    </div>
    <p class="lede"><strong>How to read this.</strong> <em>vs rest</em> compares a seminar's mean with all other seminars.
    <em>Ratings avg</em> is the mean element rating (2 = Standards, 3 = Superior, 4 = Distinguished); a strong seminar shows high ratings and high grades.
    <em>Grades vs ratings</em> compares each grade with what other seminars gave for the same element ratings; a positive number means this seminar grades higher for the same ratings.
    <em>Own comments</em> is the share of overall comments not copied word for word from a classmate's.
    Bold numbers pass your thresholds (${s.toFixed(2)} and ${c.toFixed(2)} points). Click a row to see its students.</p>
    ${legend()}
    <div class="table-wrap"><table class="data" data-sort-table="overview">
      <thead><tr>${cols.map(([id, label, cls]) =>
        `<th class="sortable ${cls || ''}" data-sort="${id}" aria-sort="${sort.col === id ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(label)}${sort.col === id ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(({ sem, sf, status }) => `
        <tr class="clickable" data-open-seminar="${esc(sem.seminar)}" data-course="${esc(course.name)}">
          <td><strong>${esc(sem.seminar)}</strong></td>
          <td>${esc(sem.faculty.join('; ') || '–')}</td>
          <td class="num">${sem.n}</td>
          <td>${distBar(sem)}</td>
          <td class="num">${fmt(sem.mean)}</td>
          <td class="num ${sem.diff != null && Math.abs(sem.diff) >= s ? 'out' : ''}">${signed(sem.diff)}</td>
          <td class="num">${pct(sem.aShare)}</td>
          <td class="num">${fmt(sem.ratingMean)}</td>
          <td class="num ${sem.calibration != null && Math.abs(sem.calibration) >= c ? 'out' : ''}" ${sem.calibration == null ? 'data-tip="Too few students with comparable ratings in other seminars."' : `data-tip="Based on ${sem.calibrationN} students"`}>${signed(sem.calibration)}</td>
          <td class="num">${pct(sem.uniqueComments)}</td>
          <td class="num">${sf.length ? `<span class="nowrap">${sf.some(f => f.severity === 'high') ? sevBadge('high') : sevBadge('medium')} ${sf.length}</span>` : '0'}</td>
          <td class="nowrap">${esc(STATUS[status])}</td>
        </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

// ----- Rating patterns -----
function renderPatterns(course) {
  const grades = GRADE_ORDER.filter(g => course.profiles.some(p => p.counts[g]));
  const max = Math.max(1, ...course.profiles.flatMap(p => Object.values(p.counts)));
  const mixed = course.profiles.filter(p => p.grades.length > 1).length;
  return `<div class="card matrix">
    <h2>${esc(course.name)}: grades given for each rating pattern</h2>
    <p class="lede">Each row is one combination of element ratings (${course.elements.map(esc).join(' / ')}).
    Each cell counts the students with that pattern who got that grade. Where a row has more than one grade,
    faculty graded the same ratings differently. ${mixed} of ${course.profiles.length} patterns are mixed. Click a cell to see the students.</p>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Ratings (${course.elements.map(esc).join(' / ')})</th>${grades.map(g => `<th class="num">${esc(g)}</th>`).join('')}<th class="num">Students</th><th></th></tr></thead>
      <tbody>${course.profiles.map(p => `
        <tr class="${p.grades.length > 1 ? 'mixed' : ''}">
          <th scope="row">${esc(p.label)}</th>
          ${grades.map(g => {
            const n = p.counts[g] || 0;
            if (!n) return '<td class="cell empty">·</td>';
            const share = 12 + Math.round(70 * n / max);
            const names = p.records.filter(r => r.grade === g).map(r => `${r.name} (Sem ${r.seminar})`);
            return `<td class="cell" style="background:color-mix(in srgb, var(--seq) ${share}%, var(--surface));color:${share > 45 ? '#fff' : 'inherit'}"
              data-pattern="${esc(p.key)}" data-grade="${esc(g)}" data-course="${esc(course.name)}"
              data-tip="${esc(`${p.label} → ${g}: ${n}\n${names.slice(0, 12).join('\n')}${names.length > 12 ? `\n+${names.length - 12} more` : ''}`)}">${n}</td>`;
          }).join('')}
          <td class="num">${p.n}</td>
          <td>${p.grades.length > 1 ? '<span class="tag">Mixed</span>' : ''}</td>
        </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

// ----- Flags -----
function renderFlags() {
  const ff = state.flagFilter;
  const all = flagsInView();
  const semOpts = [...new Set(all.map(f => f.seminar))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const typeCounts = {};
  for (const f of all) typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
  const text = ff.text.toLowerCase();
  const shown = all.filter(f => ff.sev[f.severity] && (!ff.type || f.type === ff.type) && (!ff.seminar || f.seminar === ff.seminar) &&
    (!text || `${f.title} ${f.detail} ${f.keys.map(k => (recordByKey(k) || {}).name).join(' ')}`.toLowerCase().includes(text)));
  const cur = { ...DEFAULT_SETTINGS, ...state.settings };
  const sevCount = s => all.filter(f => f.severity === s).length;

  return `
  <div class="filters">
    ${['high', 'medium', 'low'].map(s => `<label><input type="checkbox" data-sev="${s}" ${ff.sev[s] ? 'checked' : ''}> ${sevBadge(s)} (${sevCount(s)})</label>`).join('')}
    <label>Type <select id="flagType"><option value="">All types</option>${Object.keys(FLAG_TYPES).filter(t => typeCounts[t]).map(t =>
      `<option value="${t}" ${ff.type === t ? 'selected' : ''}>${esc(FLAG_TYPES[t].label)} (${typeCounts[t]})</option>`).join('')}</select></label>
    <label>Seminar <select id="flagSem"><option value="">All</option>${semOpts.map(s => `<option ${ff.seminar === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    <label>Search <input type="search" id="flagText" value="${esc(ff.text)}" placeholder="Name or word"></label>
  </div>
  <details class="settings card"><summary>Thresholds</summary>
    <div class="grid">
      <label>Seminar vs rest (points) <input type="number" step="0.05" min="0.05" id="setSem" value="${cur.seminarThreshold}"></label>
      <label>Grades vs ratings (points) <input type="number" step="0.05" min="0.05" id="setCal" value="${cur.calibrationThreshold}"></label>
      <label>Low grade at or below <select id="setLow">${['B', 'B-', 'C+', 'C'].map(g => `<option ${cur.lowGrade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
    </div>
  </details>
  <p class="muted">${shown.length} of ${all.length} flags shown. <em>High</em> flags are likely errors. <em>Check</em> flags need a look. <em>Note</em> flags are context. Use <em>Add to query</em> to put a flag on the seminar's list for the faculty.</p>
  ${shown.map(renderFlag).join('') || '<div class="card empty-state">No flags match these filters.</div>'}`;
}

function renderFlag(f) {
  const entry = state.log[logKey(f.course, f.seminar)] || {};
  const queued = (entry.queries || []).some(q => q.flag === f.id + '|' + f.title);
  return `<div class="flag ${queued ? 'queued' : ''}">
    <div class="top">${sevBadge(f.severity)} <span class="title">${esc(f.title)}</span>
      <span class="where">${esc(FLAG_TYPES[f.type].label)} · ${state.course ? '' : esc(f.course) + ' · '}Seminar ${esc(f.seminar)}</span></div>
    <div class="detail">${esc(f.detail)}</div>
    ${f.keys.length ? `<div class="who">${f.keys.map(k => { const r = recordByKey(k); return r ? `<button class="link" data-student="${esc(k)}">${esc(r.name)}</button>` : ''; }).join('')}</div>` : ''}
    <div class="row-actions">
      <button data-queue="${esc(f.id)}">${queued ? 'Remove from query' : 'Add to query'}</button>
      ${FLAG_TYPES[f.type].scope === 'seminar' ? `<button data-open-seminar="${esc(f.seminar)}" data-course="${esc(f.course)}">Show students</button>` : ''}
    </div>
  </div>`;
}

// ----- Students -----
function renderStudents() {
  const sf = state.studentFilter;
  const courses = coursesInView();
  const elementNames = [];
  for (const c of courses) for (const e of c.elements) if (!elementNames.includes(e)) elementNames.push(e);
  let recs = courses.flatMap(c => c.records);
  const semOpts = [...new Set(recs.map(r => r.seminar))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const text = sf.text.toLowerCase();
  const fk = state.result.flagsByKey;
  recs = recs.filter(r => (!sf.seminar || r.seminar === sf.seminar) && (!text || `${r.name} ${r.rowName} ${r.faculty}`.toLowerCase().includes(text)) &&
    (!sf.flagged || (fk.get(r.key) || []).some(f => f.severity !== 'low')) &&
    (!sf.profile || r.profile.key === sf.profile) && (!sf.grade || r.grade === sf.grade));
  const sort = state.sort.students;
  const val = (r, col) => {
    if (col === 'seminar') return isNaN(parseFloat(r.seminar)) ? r.seminar : parseFloat(r.seminar);
    if (col === 'name') return r.last.toLowerCase();
    if (col === 'grade') return r.points;
    if (col === 'flags') return (fk.get(r.key) || []).filter(f => f.severity !== 'low').length;
    if (col === 'course') return r.course;
    const e = r.elements.find(x => x.name === col);
    return e ? e.score : null;
  };
  recs.sort((a, b) => {
    const x = val(a, sort.col), y = val(b, sort.col);
    if (x == null) return 1; if (y == null) return -1;
    return ((x < y ? -1 : x > y ? 1 : 0) * sort.dir) || a.last.localeCompare(b.last);
  });
  const cols = [...(state.course ? [] : [['course', 'Course']]), ['seminar', 'Seminar'], ['name', 'Student'],
    ...elementNames.map(e => [e, e]), ['grade', 'Overall'], ['flags', 'Flags', 'num']];
  const th = ([id, label, cls]) => `<th class="sortable ${cls || ''}" data-sort="${esc(id)}" aria-sort="${sort.col === id ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(label)}${sort.col === id ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;

  return `
  <div class="filters">
    <label>Seminar <select id="stuSem"><option value="">All</option>${semOpts.map(s => `<option ${sf.seminar === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    <label>Search <input type="search" id="stuText" value="${esc(sf.text)}" placeholder="Student or faculty"></label>
    <label><input type="checkbox" id="stuFlagged" ${sf.flagged ? 'checked' : ''}> Flagged only</label>
    ${sf.profile || sf.grade ? `<span class="tag">Pattern filter on</span> <button class="link" id="stuClearPattern">Clear pattern filter</button>` : ''}
  </div>
  <p class="muted">${recs.length} students. Click a row to read the full report.</p>
  <div class="table-wrap card" style="padding:0"><table class="data" data-sort-table="students">
    <thead><tr>${cols.map(th).join('')}</tr></thead>
    <tbody>${recs.map(r => {
      const fl = (fk.get(r.key) || []).filter(f => f.severity !== 'low');
      return `<tr class="clickable" data-student="${esc(r.key)}">
        ${state.course ? '' : `<td>${esc(r.course)}</td>`}
        <td>${esc(r.seminar)}</td><td>${esc(r.name)}</td>
        ${elementNames.map(n => { const e = r.elements.find(x => x.name === n); return `<td>${e ? esc(e.rating) : '–'}</td>`; }).join('')}
        <td><strong>${esc(r.grade || '–')}</strong></td>
        <td class="num">${fl.length ? `<span class="nowrap">${fl.some(f => f.severity === 'high') ? sevBadge('high') : sevBadge('medium')} ${fl.length}</span>` : ''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function openStudent(key) {
  const r = recordByKey(key);
  if (!r) return;
  const fl = state.result.flagsByKey.get(key) || [];
  const other = state.records.filter(x => x.person === r.person && x.key !== r.key);
  const dlg = $('#studentDlg');
  dlg.innerHTML = `
    <div class="dhead"><h2>${esc(r.name)}</h2><button id="dlgClose" aria-label="Close">Close</button></div>
    <div class="dbody">
      <div class="meta">
        <span><strong>Course:</strong> ${esc(r.course)}</span><span><strong>Seminar:</strong> ${esc(r.seminar)}</span>
        <span><strong>Faculty:</strong> ${esc(r.faculty || '–')}</span><span><strong>Date:</strong> ${esc(r.date || '–')}</span>
        <span><strong>Program:</strong> ${esc(r.program || '–')}</span><span><strong>Signature:</strong> ${esc(r.signature || '–')}</span>
      </div>
      ${fl.length ? `<div class="card" style="padding:10px 12px">${fl.map(f => `<div style="margin:4px 0">${sevBadge(f.severity)} <strong>${esc(f.title)}</strong><br><span class="muted">${esc(f.detail)}</span></div>`).join('')}</div>` : '<p class="muted">No flags for this student.</p>'}
      <table class="data el-table"><thead><tr><th>Element</th><th>Evaluation</th><th>Evaluator's comments</th></tr></thead><tbody>
        ${r.elements.map(e => `<tr><td>${esc(e.name)}</td><td>${esc(e.rating)}</td><td>${esc(e.comment) || '<span class="muted">No comment</span>'}</td></tr>`).join('')}
        <tr><td>Overall</td><td>${esc(r.grade || '–')}</td><td>${esc(r.overallComment) || '<span class="muted">No comment</span>'}</td></tr>
      </tbody></table>
      ${other.length ? `<h3>Other courses</h3><ul>${other.map(o => `<li><button class="link" data-student="${esc(o.key)}">${esc(o.course)}</button>: ${esc(o.grade || '–')} (Seminar ${esc(o.seminar)})</li>`).join('')}</ul>` : ''}
    </div>`;
  if (!dlg.open) dlg.showModal();
}

// ----- Review log -----
function renderLog() {
  const courses = coursesInView();
  return `
  <div class="card">
    <h2>Review log</h2>
    <p class="lede">Mark each seminar as you review it. Queries you add from the Flags tab appear under the seminar.
    The log stays in this browser (not in the grade file). Export it before you clear your browser.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      <button class="primary" id="copyQueries">Copy query list</button>
      <button id="dlQueries">Download query list (.txt)</button>
      <button id="dlLog">Download review log (.csv)</button>
      <button id="clearLog">Clear review log</button>
    </div>
  </div>
  ${courses.map(c => `<div class="card"><h2>${esc(c.name)}</h2>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Seminar</th><th>Faculty</th><th class="num">Flags</th><th>Status</th><th style="width:45%">Notes and queries</th></tr></thead>
      <tbody>${c.seminars.map(s => {
        const k = logKey(c.name, s.seminar);
        const e = state.log[k] || {};
        const sf = state.result.flags.filter(f => f.course === c.name && f.seminar === s.seminar && f.severity !== 'low');
        return `<tr>
          <td><strong>${esc(s.seminar)}</strong></td><td>${esc(s.faculty.join('; ') || '–')}</td>
          <td class="num">${sf.length}</td>
          <td><select data-status="${esc(k)}">${STATUS.map((t, i) => `<option value="${i}" ${(e.status || 0) === i ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
          <td>
            ${(e.queries || []).map((q, i) => `<div class="nowrap" style="white-space:normal">- ${esc(q.text)} <button class="link" data-unqueue="${esc(k)}" data-idx="${i}">remove</button></div>`).join('')}
            <textarea class="note" data-note="${esc(k)}" placeholder="Notes">${esc(e.note || '')}</textarea>
          </td></tr>`;
      }).join('')}</tbody>
    </table></div></div>`).join('')}`;
}

function queryText() {
  const lines = [`Grade review queries (${today()})`];
  for (const c of state.result.courses) {
    const sems = c.seminars.filter(s => {
      const e = state.log[logKey(c.name, s.seminar)] || {};
      return (e.queries || []).length || e.status === 2 || (e.note || '').trim();
    });
    if (!sems.length) continue;
    lines.push(`- ${c.name}`);
    for (const s of sems) {
      const e = state.log[logKey(c.name, s.seminar)] || {};
      lines.push(`\t- Seminar ${s.seminar}${s.faculty.length ? ` (${s.faculty.join('; ')})` : ''}: ${STATUS[e.status || 0]}`);
      for (const q of e.queries || []) lines.push(`\t\t- ${q.text}`);
      if ((e.note || '').trim()) lines.push(`\t\t- Note: ${e.note.trim().replace(/\s+/g, ' ')}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : 'No queries or notes yet.';
}

function logCsv() {
  const rows = [['Course', 'Seminar', 'Faculty', 'Status', 'Queries', 'Notes']];
  for (const c of state.result.courses) for (const s of c.seminars) {
    const e = state.log[logKey(c.name, s.seminar)] || {};
    rows.push([c.name, s.seminar, s.faculty.join('; '), STATUS[e.status || 0], (e.queries || []).map(q => q.text).join(' | '), e.note || '']);
  }
  return rows.map(r => r.map(v => { const x = String(v); return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; }).join(',')).join('\r\n');
}

function toggleQuery(flagId) {
  const f = state.result.flags.find(x => x.id === flagId);
  if (!f) return;
  const k = logKey(f.course, f.seminar);
  const e = state.log[k] || (state.log[k] = {});
  e.queries = e.queries || [];
  const tag = f.id + '|' + f.title;
  const idx = e.queries.findIndex(q => q.flag === tag);
  if (idx >= 0) e.queries.splice(idx, 1);
  else {
    const who = f.keys.map(key => (recordByKey(key) || {}).name).filter(Boolean);
    const whoText = who.length ? (who.length > 3 ? `${who.slice(0, 3).join('; ')} and ${who.length - 3} more` : who.join('; ')) + ': ' : '';
    e.queries.push({ flag: tag, text: `${whoText}${f.title}. ${f.detail}` });
    if (!e.status) e.status = 2;
  }
  saveJson(LOG_KEY, state.log);
}

// ---------- events ----------
function sortBy(table, col) {
  const s = state.sort[table];
  if (s.col === col) s.dir = -s.dir; else { s.col = col; s.dir = 1; }
  render();
}

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-tab], [data-sort], [data-open-seminar], [data-student], td.cell[data-pattern], #pickBtn2');
  if (!t) return;
  if (t.id === 'pickBtn' || t.id === 'pickBtn2') { $('#fileInput').click(); return; }
  if (t.id === 'sampleBtn') { addRecords(parseExport(JSON.stringify(makeSampleExport())), 'sample data'); toast('Loaded made-up sample data.'); return; }
  if (t.id === 'clearBtn') {
    if (confirm('Unload all grade data from this page? Your review log stays.')) { state.records = []; state.sources = []; recompute(); }
    return;
  }
  if (t.id === 'exportBtn') { download(`grade-review-${today()}.csv`, toCsv(state.records, state.result.flagsByKey), 'text/csv'); return; }
  if (t.id === 'copyCode') { copy(COLLECTOR_SRC, 'Collector code copied. Paste it into the console on the Compass page.'); return; }
  if (t.id === 'dlgClose') { $('#studentDlg').close(); return; }
  if (t.id === 'copyQueries') { copy(queryText(), 'Query list copied.'); return; }
  if (t.id === 'dlQueries') { download(`grade-queries-${today()}.txt`, queryText(), 'text/plain'); return; }
  if (t.id === 'dlLog') { download(`grade-review-log-${today()}.csv`, logCsv(), 'text/csv'); return; }
  if (t.id === 'clearLog') { if (confirm('Delete all review statuses, notes, and queries?')) { state.log = {}; saveJson(LOG_KEY, state.log); render(); } return; }
  if (t.id === 'stuClearPattern') { state.studentFilter.profile = ''; state.studentFilter.grade = ''; render(); return; }
  if (t.dataset.tab) { state.tab = t.dataset.tab; render(); return; }
  if (t.dataset.sort) { sortBy(t.closest('table').dataset.sortTable, t.dataset.sort); return; }
  if (t.dataset.queue) { toggleQuery(t.dataset.queue); render(); return; }
  if (t.dataset.unqueue) {
    const entry = state.log[t.dataset.unqueue];
    entry.queries.splice(Number(t.dataset.idx), 1);
    saveJson(LOG_KEY, state.log); render(); return;
  }
  if (t.dataset.student) { openStudent(t.dataset.student); return; }
  if (t.dataset.openSeminar != null) {
    state.course = t.dataset.course;
    Object.assign(state.studentFilter, { seminar: t.dataset.openSeminar, text: '', flagged: false, profile: '', grade: '' });
    state.tab = 'students'; render(); return;
  }
  if (t.dataset.pattern) {
    state.course = t.dataset.course;
    Object.assign(state.studentFilter, { seminar: '', text: '', flagged: false, profile: t.dataset.pattern, grade: t.dataset.grade });
    state.tab = 'students'; render();
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fileInput') { loadFiles([...t.files]); t.value = ''; return; }
  if (t.id === 'courseSel') { state.course = t.value; state.studentFilter.seminar = ''; state.flagFilter.seminar = ''; render(); return; }
  if (t.dataset.sev) { state.flagFilter.sev[t.dataset.sev] = t.checked; render(); return; }
  if (t.id === 'flagType') { state.flagFilter.type = t.value; render(); return; }
  if (t.id === 'flagSem') { state.flagFilter.seminar = t.value; render(); return; }
  if (t.id === 'stuSem') { state.studentFilter.seminar = t.value; render(); return; }
  if (t.id === 'stuFlagged') { state.studentFilter.flagged = t.checked; render(); return; }
  if (t.id === 'setSem' || t.id === 'setCal' || t.id === 'setLow') {
    const v = t.id === 'setLow' ? t.value : parseFloat(t.value);
    if (t.id !== 'setLow' && !(v > 0)) return;
    state.settings[{ setSem: 'seminarThreshold', setCal: 'calibrationThreshold', setLow: 'lowGrade' }[t.id]] = v;
    saveJson(SETTINGS_KEY, state.settings);
    recompute();
    return;
  }
  if (t.dataset.status) {
    const e2 = state.log[t.dataset.status] || (state.log[t.dataset.status] = {});
    e2.status = Number(t.value); saveJson(LOG_KEY, state.log);
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.note) {
    const e2 = state.log[t.dataset.note] || (state.log[t.dataset.note] = {});
    e2.note = t.value; saveJson(LOG_KEY, state.log);
    return;
  }
  if (t.id === 'flagText' || t.id === 'stuText') {
    const pos = t.selectionStart;
    if (t.id === 'flagText') state.flagFilter.text = t.value; else state.studentFilter.text = t.value;
    render();
    const n = $('#' + t.id); n.focus(); n.setSelectionRange(pos, pos);
  }
});

function copy(text, msg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast(msg), () => fallbackCopy(text, msg));
  } else fallbackCopy(text, msg);
}
function fallbackCopy(text, msg) {
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast(msg); } catch (e) { alert('Copy failed. Select the text and copy it by hand.'); }
  ta.remove();
}

// Drag and drop anywhere.
['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); document.body.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'dragleave' && e.relatedTarget) return;
  document.body.classList.remove('dragging');
  if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files.length) loadFiles([...e.dataTransfer.files]);
}));

// Tooltip for any element with data-tip.
const tip = $('#tip');
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.style.display = 'none'; return; }
  tip.textContent = t.dataset.tip; tip.style.display = 'block';
});
document.addEventListener('mousemove', e => {
  if (tip.style.display !== 'block') return;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = e.clientY + 16 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 16;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});
$('#studentDlg').addEventListener('click', e => { if (e.target.id === 'studentDlg') e.target.close(); });

render();
