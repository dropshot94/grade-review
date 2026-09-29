// Grade review analysis. Pure functions, no DOM, no network.
// The build step inlines this file into grade-review.html; tests import it directly.

export const GRADE_ORDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
export const GRADE_POINTS = {
  'A+': 4.0, 'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7,
  'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D+': 1.3, 'D': 1.0, 'D-': 0.7, 'F': 0,
};
// Buckets used for distribution charts. B- and below are rare, so they share one bucket.
export const GRADE_BUCKETS = ['A', 'A-', 'B+', 'B', 'B- or lower'];

export const RATING_LABELS = {
  4: 'Distinguished', 3: 'Superior', 2: 'Standards', 1: 'Below standards', 0: 'Failed',
};
export const RATING_SHORT = { 4: 'Dist', 3: 'Sup', 2: 'Std', 1: 'Below', 0: 'Fail' };

export const DEFAULT_SETTINGS = {
  seminarThreshold: 0.15,     // grade points between a seminar and the rest of the course
  calibrationThreshold: 0.15, // grade points between grades given and grades the ratings predict
  lowGrade: 'B-',             // at or below this grade counts as low
};

export const FLAG_TYPES = {
  'data':              { label: 'Data problem', scope: 'student' },
  'pattern':           { label: 'Same ratings, different grade', scope: 'student' },
  'inversion':         { label: 'Higher ratings, lower grade', scope: 'student' },
  'seminar-level':     { label: 'Seminar grades out of line', scope: 'seminar' },
  'calibration':       { label: 'Grades out of line with ratings', scope: 'seminar' },
  'comment-grade':     { label: 'Comment states a different grade', scope: 'student' },
  'comment-name':      { label: 'Comment names another student', scope: 'student' },
  'comment-rubric':    { label: 'Comment matches another rating', scope: 'student' },
  'comment-missing':   { label: 'Comment missing or short', scope: 'student' },
  'low':               { label: 'Low performance', scope: 'student' },
  'low-multi':         { label: 'Low in more than one course', scope: 'student' },
};

export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);
const RANK_TOKENS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'miss', 'prof',
  'pvt', 'cpt', 'capt', 'maj', 'ltc', 'col', 'bg', 'mg', 'ltg', 'gen', 'lt', '1lt', '2lt',
  'cdr', 'lcdr', 'lcol', 'brig', 'wg', 'gp', 'sqn', 'ldr', 'cdre', 'cmdr', 'cmde', 'cpo',
  'csm', 'sgm', 'cw2', 'cw3', 'cw4', 'cw5', 'lieutenant', 'colonel', 'commander', 'captain',
]);

export function cleanText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

export function normGrade(g) {
  const s = cleanText(g).replace(/[()]/g, '').replace(/[−–—]/g, '-').toUpperCase();
  return s;
}

export function gradePoints(g) {
  const n = normGrade(g);
  return Object.prototype.hasOwnProperty.call(GRADE_POINTS, n) ? GRADE_POINTS[n] : null;
}

export function gradeIndex(g) {
  return GRADE_ORDER.indexOf(normGrade(g));
}

export function gradeBucket(g) {
  const n = normGrade(g);
  if (n === 'A+' || n === 'A') return 'A';
  if (['A-', 'B+', 'B'].includes(n)) return n;
  if (gradePoints(n) != null) return 'B- or lower';
  return null;
}

export function ratingScore(label) {
  const l = cleanText(label).toLowerCase();
  if (!l) return null;
  if (/did not|does not|not meet|fail|unsatisf/.test(l)) return 0;
  if (/needs improvement|marginal|below|partial/.test(l)) return 1;
  if (/distinguish|outstanding|exceptional/.test(l)) return 4;
  if (/superior|exceed/.test(l)) return 3;
  if (/standard|meets|satisfactory/.test(l)) return 2;
  return null;
}

function stripRankAndSuffix(tokens) {
  const out = tokens.slice();
  while (out.length > 1 && RANK_TOKENS.has(out[0].toLowerCase().replace(/\./g, ''))) out.shift();
  while (out.length > 1 && NAME_SUFFIXES.has(out[out.length - 1].toLowerCase())) out.pop();
  return out;
}

// Report names look like "Almada, Marrio A, LTC". Dashboard names look like "LTC Marrio A Almada".
export function parsePersonName(reportName, rowName) {
  const rep = cleanText(reportName);
  if (rep.includes(',')) {
    const parts = rep.split(',').map(cleanText).filter(Boolean);
    const lastTokens = stripRankAndSuffix(parts[0].split(' '));
    const givenTokens = stripRankAndSuffix((parts[1] || '').split(' ').filter(Boolean));
    const rank = parts.length > 2 ? parts.slice(2).join(' ') : '';
    return {
      last: lastTokens.join(' '),
      first: givenTokens[0] || '',
      rank,
      display: rep,
    };
  }
  const row = cleanText(rowName || rep);
  const raw = row.split(' ').filter(Boolean);
  let rank = [];
  let i = 0;
  while (i < raw.length - 1 && RANK_TOKENS.has(raw[i].toLowerCase().replace(/\./g, ''))) rank.push(raw[i++]);
  const tokens = stripRankAndSuffix(raw.slice(i));
  const last = tokens.length > 1 ? tokens[tokens.length - 1] : tokens[0] || '';
  const first = tokens.length > 1 ? tokens[0] : '';
  const display = last ? `${last}, ${tokens.slice(0, -1).join(' ')}${rank.length ? ', ' + rank.join(' ') : ''}` : row;
  return { last, first, rank: rank.join(' '), display: cleanText(display) };
}

function isOverallElement(name) {
  return /^overall/i.test(cleanText(name));
}

// Turn one collector record into the shape the analysis uses.
export function normalizeRecord(raw) {
  const warnings = (raw.warnings || []).slice();
  const person = parsePersonName(raw.name, raw.rowName);
  const reportElements = (raw.elements || []).map(e => ({
    name: cleanText(e.element || e.name),
    rating: cleanText(e.rating || e.evaluation),
    comment: cleanText(e.comment),
  })).filter(e => e.name);

  const rowCells = raw.rowCells || {};
  const rowElementNames = Object.keys(rowCells).filter(k => !/student|name/i.test(k) && k.trim());

  let elements = reportElements.filter(e => !isOverallElement(e.name));
  let overall = reportElements.find(e => isOverallElement(e.name));
  if (!elements.length) {
    elements = rowElementNames.filter(k => !isOverallElement(k))
      .map(k => ({ name: cleanText(k), rating: cleanText(rowCells[k]), comment: '' }));
  }
  // Show elements in the dashboard's column order.
  const colIndex = n => {
    const i = rowElementNames.findIndex(k => cleanText(k).toLowerCase() === n.toLowerCase());
    return i < 0 ? 999 : i;
  };
  elements = elements.slice().sort((a, b) => colIndex(a.name) - colIndex(b.name));
  const rowOverallKey = rowElementNames.find(isOverallElement);
  if (!overall && rowOverallKey) overall = { name: 'Overall', rating: cleanText(rowCells[rowOverallKey]), comment: '' };

  // Cross-check the dashboard row against the report.
  if (reportElements.length) {
    for (const k of rowElementNames) {
      const rep = reportElements.find(e => e.name.toLowerCase() === cleanText(k).toLowerCase());
      const rowVal = cleanText(rowCells[k]);
      if (rep && rowVal && rep.rating && rep.rating.toLowerCase() !== rowVal.toLowerCase()) {
        warnings.push(`Dashboard shows ${k} "${rowVal}" but the report shows "${rep.rating}".`);
      }
    }
  }

  const grade = overall ? normGrade(overall.rating) : '';
  const course = cleanText(raw.course) || 'Unknown course';
  const seminar = cleanText(raw.seminar) || '?';
  const key = [course, seminar, person.last, person.first].join('|').toLowerCase();

  return {
    key,
    id: key,
    name: person.display || cleanText(raw.rowName) || 'Unknown student',
    rowName: cleanText(raw.rowName),
    first: person.first,
    last: person.last,
    rank: person.rank,
    person: `${person.last}|${person.first}`.toLowerCase(),
    program: cleanText(raw.program),
    term: cleanText(raw.term),
    course,
    seminar,
    faculty: cleanText(raw.faculty),
    date: cleanText(raw.date),
    signature: cleanText(raw.signature),
    elements: elements.map(e => ({ ...e, score: ratingScore(e.rating) })),
    grade,
    points: gradePoints(grade),
    overallComment: overall ? overall.comment : '',
    warnings,
    collectedAt: raw.collectedAt || '',
  };
}

// Merge record lists. A later collection of the same student and course replaces an earlier one.
export function mergeRecords(lists) {
  const map = new Map();
  for (const list of lists) {
    for (const r of list) {
      const prev = map.get(r.key);
      if (!prev || String(r.collectedAt) >= String(prev.collectedAt)) map.set(r.key, r);
    }
  }
  return [...map.values()];
}

// Accepts the collector's JSON export (object with records) or a bare array.
export function parseExport(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.records;
  if (!Array.isArray(list)) throw new Error('This file has no grade records.');
  return list.map(normalizeRecord);
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function seminarSort(a, b) {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function profileOf(record, elementNames) {
  const scores = elementNames.map(n => {
    const e = record.elements.find(x => x.name === n);
    return e ? e.score : null;
  });
  const complete = scores.every(s => s != null);
  return {
    scores,
    complete,
    key: scores.map(s => (s == null ? '-' : s)).join(''),
    label: scores.map(s => (s == null ? '?' : RATING_SHORT[s])).join(' / '),
    total: complete ? scores.reduce((a, b) => a + b, 0) : null,
  };
}

function dominates(a, b) {
  let strictly = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return false;
    if (a[i] > b[i]) strictly = true;
  }
  return strictly;
}

function normComment(s) {
  return cleanText(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordIn(text, word) {
  if (!word || word.length < 3) return false;
  return new RegExp(`(^|[^A-Za-z])${escapeRe(word)}([^A-Za-z]|$)`).test(text);
}

const STATED_GRADE_RE = /(?:[Ff]inal|[Oo]verall|[Cc]ourse)\s+[Gg]rade\s*(?:of|was|is|:)?\s*(?:an?\s+)?[("“]?\s*([A-F][+\-−]?)(?![A-Za-z+\-])/g;

export function statedGrades(comment) {
  const out = [];
  let m;
  STATED_GRADE_RE.lastIndex = 0;
  while ((m = STATED_GRADE_RE.exec(comment || ''))) out.push(normGrade(m[1]));
  return out;
}

function fmtPts(x) {
  return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);
}

export function analyze(records, userSettings) {
  const settings = { ...DEFAULT_SETTINGS, ...(userSettings || {}) };
  const lowPoints = gradePoints(settings.lowGrade);
  const flags = [];
  let flagSeq = 0;
  const addFlag = f => { flags.push({ id: `f${++flagSeq}`, keys: [], ...f }); };

  const byCourse = new Map();
  for (const r of records) {
    if (!byCourse.has(r.course)) byCourse.set(r.course, []);
    byCourse.get(r.course).push(r);
  }

  const courses = [];
  for (const [courseName, recs] of byCourse) {
    // Element order: first seen.
    const elementNames = [];
    for (const r of recs) for (const e of r.elements) if (!elementNames.includes(e.name)) elementNames.push(e.name);

    for (const r of recs) r.profile = profileOf(r, elementNames);

    const graded = recs.filter(r => r.points != null);
    const courseMean = mean(graded.map(r => r.points));

    // --- Data problems ---
    for (const r of recs) {
      const base = { course: courseName, seminar: r.seminar, keys: [r.key], type: 'data' };
      if (!r.grade) addFlag({ ...base, severity: 'high', title: 'No overall grade', detail: 'The report has no overall grade.' });
      else if (r.points == null) addFlag({ ...base, severity: 'high', title: `Unrecognized grade "${r.grade}"`, detail: 'The tool cannot place this grade on the A to F scale.' });
      const unknown = r.elements.filter(e => e.score == null);
      if (unknown.length) {
        addFlag({ ...base, severity: 'medium', title: 'Missing or unrecognized rating',
          detail: unknown.map(e => `${e.name}: "${e.rating || 'blank'}"`).join('; ') });
      }
      if (!r.faculty) addFlag({ ...base, severity: 'low', title: 'No faculty instructor listed', detail: 'The report does not name a faculty instructor.' });
      if (!r.signature) addFlag({ ...base, severity: 'low', title: 'No faculty signature', detail: 'The report signature line is blank.' });
      for (const w of r.warnings) addFlag({ ...base, severity: 'high', title: 'Collection warning', detail: w });
    }

    // --- Same ratings, different grade (course wide) ---
    const profiles = new Map();
    for (const r of graded) {
      if (!r.profile.complete) continue;
      if (!profiles.has(r.profile.key)) profiles.set(r.profile.key, { ...r.profile, records: [] });
      profiles.get(r.profile.key).records.push(r);
    }
    const profileList = [...profiles.values()].map(p => {
      const counts = {};
      for (const r of p.records) counts[r.grade] = (counts[r.grade] || 0) + 1;
      const grades = Object.keys(counts).sort((a, b) => gradeIndex(a) - gradeIndex(b));
      return { ...p, counts, grades, n: p.records.length, meanPoints: mean(p.records.map(r => r.points)) };
    }).sort((a, b) => b.total - a.total || b.key.localeCompare(a.key));

    for (const p of profileList) {
      if (p.grades.length < 2) continue;
      const ranked = p.grades.slice().sort((a, b) => p.counts[b] - p.counts[a]);
      const top = ranked[0];
      const tie = p.counts[ranked[1]] === p.counts[top];
      const split = p.grades.map(g => `${g} (${p.counts[g]})`).join(', ');
      for (const r of p.records) {
        const base = { type: 'pattern', course: courseName, seminar: r.seminar, keys: [r.key] };
        if (tie) {
          addFlag({ ...base, severity: 'low', title: `${p.label}: no clear norm`,
            detail: `Students with these ratings in this course got ${split}. This student got ${r.grade}.` });
        } else if (r.grade !== top) {
          const steps = Math.abs(gradeIndex(r.grade) - gradeIndex(top));
          addFlag({ ...base, severity: steps >= 2 ? 'high' : 'medium',
            title: `${p.label}: ${r.grade}, most got ${top}`,
            detail: `Students with these ratings in this course got ${split}. This student got ${r.grade}.` });
        }
      }
    }

    // --- Seminars ---
    const semMap = new Map();
    for (const r of recs) {
      if (!semMap.has(r.seminar)) semMap.set(r.seminar, []);
      semMap.get(r.seminar).push(r);
    }

    // Expected grade for a student = mean grade of the same ratings in OTHER seminars.
    for (const r of graded) {
      r.expected = null;
      if (!r.profile.complete) continue;
      const p = profiles.get(r.profile.key);
      const others = p.records.filter(o => o.seminar !== r.seminar);
      if (others.length >= 2) r.expected = mean(others.map(o => o.points));
    }

    const seminars = [];
    for (const [sem, srecs] of [...semMap.entries()].sort((a, b) => seminarSort(a[0], b[0]))) {
      const sg = srecs.filter(r => r.points != null);
      const buckets = {};
      for (const b of GRADE_BUCKETS) buckets[b] = [];
      for (const r of sg) buckets[gradeBucket(r.grade)].push(r);
      const others = graded.filter(r => r.seminar !== sem);
      const semMean = mean(sg.map(r => r.points));
      const othersMean = mean(others.map(r => r.points));
      const elementMeans = {};
      for (const n of elementNames) {
        elementMeans[n] = mean(srecs.map(r => r.elements.find(e => e.name === n)).filter(e => e && e.score != null).map(e => e.score));
      }
      const withExp = sg.filter(r => r.expected != null);
      const calibration = withExp.length >= 4 ? mean(withExp.map(r => r.points - r.expected)) : null;
      const faculty = [...new Set(srecs.map(r => r.faculty).filter(Boolean))];
      const s = {
        seminar: sem, course: courseName, faculty, records: srecs, n: srecs.length, graded: sg.length,
        buckets, mean: semMean, othersMean,
        diff: semMean != null && othersMean != null ? semMean - othersMean : null,
        aShare: sg.length ? sg.filter(r => r.points >= 3.7).length / sg.length : null,
        elementMeans,
        ratingMean: mean(srecs.filter(r => r.profile.complete).map(r => r.profile.total / elementNames.length)),
        calibration, calibrationN: withExp.length,
      };
      seminars.push(s);

      const facultyText = faculty.length ? ` (${faculty.join('; ')})` : '';
      if (semMap.size >= 3 && sg.length >= 5 && s.diff != null && Math.abs(s.diff) >= settings.seminarThreshold) {
        addFlag({ type: 'seminar-level', course: courseName, seminar: sem,
          severity: Math.abs(s.diff) >= settings.seminarThreshold * 2 ? 'high' : 'medium',
          title: `Seminar ${sem} grades ${s.diff > 0 ? 'above' : 'below'} the rest of the course`,
          detail: `Seminar ${sem}${facultyText} mean ${semMean.toFixed(2)} vs ${othersMean.toFixed(2)} for all other seminars (${fmtPts(s.diff)}). Check the ratings column: a strong seminar shows high ratings too.` });
      }
      if (calibration != null && Math.abs(calibration) >= settings.calibrationThreshold) {
        addFlag({ type: 'calibration', course: courseName, seminar: sem,
          severity: Math.abs(calibration) >= settings.calibrationThreshold * 2 ? 'high' : 'medium',
          title: `Seminar ${sem} grades ${calibration > 0 ? 'higher' : 'lower'} than its ratings predict`,
          detail: `Across ${withExp.length} students, seminar ${sem}${facultyText} gave grades ${fmtPts(calibration)} points from what other seminars gave for the same element ratings.` });
      }

      // --- Higher ratings, lower grade (within seminar) ---
      const comp = sg.filter(r => r.profile.complete);
      for (const a of comp) {
        const beaten = comp.filter(b => b !== a && dominates(a.profile.scores, b.profile.scores) && a.points < b.points);
        if (beaten.length) {
          addFlag({ type: 'inversion', course: courseName, seminar: sem, severity: 'medium',
            keys: [a.key, ...beaten.map(b => b.key)],
            title: `Higher ratings than ${beaten.length} classmate${beaten.length > 1 ? 's' : ''} but a lower grade`,
            detail: `${a.name}: ${a.profile.label}, ${a.grade}. ` +
              beaten.map(b => `${b.name}: ${b.profile.label}, ${b.grade}`).join('. ') + '.' });
        }
      }

      // --- Comment names another student ---
      for (const r of srecs) {
        const text = r.overallComment;
        if (!text) continue;
        const selfWords = new Set([r.first, r.last, ...r.last.split(' ')].filter(Boolean));
        const hits = srecs.filter(o => o !== r && (
          (wordIn(text, o.first) && !selfWords.has(o.first)) ||
          (wordIn(text, o.last) && !selfWords.has(o.last))));
        if (hits.length) {
          const namesSelf = wordIn(text, r.first) || wordIn(text, r.last);
          addFlag({ type: 'comment-name', course: courseName, seminar: sem, keys: [r.key],
            severity: namesSelf ? 'medium' : 'high',
            title: namesSelf ? 'Overall comment also names a classmate' : 'Overall comment names a classmate, not this student',
            detail: `Comment mentions ${hits.map(o => o.name).join('; ')}. Possible copy and paste error.` });
        }
      }
    }

    // --- Comment checks (course wide) ---
    // Rubric text: a comment that appears 3+ times under one element and rating.
    const rubric = {};
    for (const n of elementNames) {
      const seen = new Map();
      for (const r of recs) {
        const e = r.elements.find(x => x.name === n);
        if (!e || !e.comment || e.score == null) continue;
        const t = normComment(e.comment);
        if (!seen.has(t)) seen.set(t, {});
        seen.get(t)[e.score] = (seen.get(t)[e.score] || 0) + 1;
      }
      rubric[n] = [];
      for (const [t, byScore] of seen) {
        const best = Object.entries(byScore).sort((a, b) => b[1] - a[1])[0];
        if (best[1] >= 3 && t.length >= 60) rubric[n].push({ text: t, score: Number(best[0]) });
      }
    }

    for (const r of recs) {
      const base = { course: courseName, seminar: r.seminar, keys: [r.key] };

      for (const e of r.elements) {
        if (!e.comment || e.score == null) continue;
        const t = normComment(e.comment);
        const match = (rubric[e.name] || []).find(c => c.score !== e.score && (t === c.text || t.startsWith(c.text)));
        if (match) {
          addFlag({ ...base, type: 'comment-rubric', severity: 'high',
            title: `${e.name}: rated ${RATING_SHORT[e.score]}, comment is ${RATING_SHORT[match.score]} text`,
            detail: `The ${e.name} rating is "${e.rating}", but the comment matches the text other faculty used for ${RATING_LABELS[match.score]}.` });
        }
      }

      const missingEl = r.elements.filter(e => !e.comment).map(e => e.name);
      if (cleanText(r.overallComment).length < 40) {
        addFlag({ ...base, type: 'comment-missing', severity: 'medium', title: 'Overall comment missing or very short',
          detail: r.overallComment ? `Comment: "${cleanText(r.overallComment)}"` : 'No overall comment.' });
      }
      if (missingEl.length && missingEl.length < r.elements.length) {
        addFlag({ ...base, type: 'comment-missing', severity: 'low', title: 'Element comment missing',
          detail: `No comment for ${missingEl.join(', ')}.` });
      }

      const stated = statedGrades(r.overallComment);
      const wrong = stated.filter(g => g !== r.grade);
      if (r.grade && wrong.length) {
        addFlag({ ...base, type: 'comment-grade', severity: 'high',
          title: `Comment says ${wrong[0]}, grade is ${r.grade}`,
          detail: `The overall comment states a final grade of ${wrong.join(', ')}, but the recorded grade is ${r.grade}.` });
      }

      r.commentSignature = null;
      if (r.overallComment && r.overallComment.length >= 40) {
        let t = r.overallComment;
        for (const w of [r.first, r.last]) if (w && w.length >= 2) t = t.replace(new RegExp(escapeRe(w), 'g'), '\u00a7');
        r.commentSignature = normComment(t);
      }

      // Low performance
      const lowEls = r.elements.filter(e => e.score != null && e.score <= 1);
      if ((r.points != null && lowPoints != null && r.points <= lowPoints) || lowEls.length) {
        const parts = [];
        if (r.points != null && r.points <= lowPoints) parts.push(`grade ${r.grade}`);
        for (const e of lowEls) parts.push(`${e.name} ${e.rating}`);
        addFlag({ ...base, type: 'low', severity: 'medium', title: `Low performance: ${parts.join(', ')}`,
          detail: 'Confirm the faculty comments support the grade and that the student has been counseled.' });
      }
    }
    // Share of overall comments that are not word for word the same as a classmate's (names aside).
    for (const sem of seminars) {
      const counts = new Map();
      for (const r of sem.records) if (r.commentSignature) counts.set(r.commentSignature, (counts.get(r.commentSignature) || 0) + 1);
      sem.uniqueComments = sem.records.length
        ? sem.records.filter(r => r.commentSignature && counts.get(r.commentSignature) === 1).length / sem.records.length : null;
    }

    courses.push({
      name: courseName, elements: elementNames, records: recs, n: recs.length,
      mean: courseMean, seminars, profiles: profileList,
    });
  }

  // --- Low in more than one course ---
  const lowByPerson = new Map();
  for (const f of flags) {
    if (f.type !== 'low') continue;
    const r = records.find(x => x.key === f.keys[0]);
    if (!lowByPerson.has(r.person)) lowByPerson.set(r.person, new Set());
    lowByPerson.get(r.person).add(r);
  }
  for (const set of lowByPerson.values()) {
    const list = [...set];
    const courseNames = new Set(list.map(r => r.course));
    if (courseNames.size < 2) continue;
    for (const r of list) {
      addFlag({ type: 'low-multi', course: r.course, seminar: r.seminar, keys: [r.key], severity: 'high',
        title: `Low performance in ${courseNames.size} courses`,
        detail: list.map(x => `${x.course}: ${x.grade || 'no grade'}`).join('; ') });
    }
  }

  courses.sort((a, b) => a.name.localeCompare(b.name));
  const flagsByKey = new Map();
  for (const f of flags) for (const k of f.keys) {
    if (!flagsByKey.has(k)) flagsByKey.set(k, []);
    flagsByKey.get(k).push(f);
  }
  flags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.course.localeCompare(b.course) || seminarSort(a.seminar, b.seminar));
  return { courses, flags, flagsByKey, settings };
}

// Flat rows for CSV export (Excel).
export function toCsv(records, flagsByKey) {
  const elementNames = [];
  for (const r of records) for (const e of r.elements) if (!elementNames.includes(e.name)) elementNames.push(e.name);
  const head = ['Course', 'Seminar', 'Faculty', 'Student', 'Rank', ...elementNames, 'Overall', 'Points',
    'Flags', 'Flag details', ...elementNames.map(n => `${n} comment`), 'Overall comment', 'Report date'];
  const rows = [head];
  for (const r of records) {
    const fl = (flagsByKey && flagsByKey.get(r.key)) || [];
    rows.push([
      r.course, r.seminar, r.faculty, r.name, r.rank,
      ...elementNames.map(n => (r.elements.find(e => e.name === n) || {}).rating || ''),
      r.grade, r.points == null ? '' : r.points,
      fl.length, fl.map(f => `[${f.severity}] ${f.title}`).join(' | '),
      ...elementNames.map(n => (r.elements.find(e => e.name === n) || {}).comment || ''),
      r.overallComment, r.date,
    ]);
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  // Guard against spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
