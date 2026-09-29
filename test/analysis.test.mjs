import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRecord, analyze, parsePersonName, ratingScore, gradePoints, statedGrades, toCsv, mergeRecords, parseExport,
} from '../src/analysis.js';
import { makeSampleExport } from '../src/sample.js';

const R = { P: 'Performed to Standards', S: 'Superior Performance', D: 'Distinguished Performance' };

// One seminar shaped like a real Director Dashboard list. All names are made up.
function seminar(rows, { course = 'Course One', sem = '1', faculty = 'Adair, Pat L COL' } = {}) {
  return rows.map(([rank, first, last, oral, st, wr, grade, comment]) => normalizeRecord({
    rowName: `${rank} ${first} ${last}`,
    rowCells: { 'Student Name': `${rank} ${first} ${last}`, Oral: R[oral], 'Strategic Thinking': R[st], Writing: R[wr], Overall: grade },
    name: `${last}, ${first}, ${rank}`,
    course, seminar: sem, faculty, signature: '//Electronically Approved//',
    elements: [
      { element: 'Strategic Thinking', rating: R[st], comment: `ST text ${st}` },
      { element: 'Writing', rating: R[wr], comment: `WR text ${wr}` },
      { element: 'Oral', rating: R[oral], comment: `OR text ${oral}` },
      { element: 'Overall', rating: grade, comment: comment ?? `${first} did well in the course and earned a final grade of (${grade}).` },
    ],
  }));
}

test('rating and grade scales', () => {
  assert.equal(ratingScore('Distinguished Performance'), 4);
  assert.equal(ratingScore('Superior Performance'), 3);
  assert.equal(ratingScore('Performed to Standards'), 2);
  assert.equal(ratingScore('Did Not Meet Standards'), 0);
  assert.equal(ratingScore('Needs Improvement'), 1);
  assert.equal(ratingScore('Something else'), null);
  assert.equal(gradePoints('A-'), 3.7);
  assert.equal(gradePoints('(B+)'), 3.3);
  assert.equal(gradePoints('B−'), 2.7);
  assert.equal(gradePoints('P'), null);
});

test('names from report and dashboard formats', () => {
  assert.deepEqual(parsePersonName('Stanton, Avery Q, LTC').last, 'Stanton');
  assert.deepEqual(parsePersonName('Stanton, Avery Q, LTC').first, 'Avery');
  const row = parsePersonName('', 'Lt Col Jordan M Hale');
  assert.equal(row.last, 'Hale'); assert.equal(row.first, 'Jordan');
  const jr = parsePersonName('', 'LTC Riley Evan Nash Jr');
  assert.equal(jr.last, 'Nash');
  const two = parsePersonName('Exposito Vance II, Drew, LTC');
  assert.equal(two.last, 'Exposito Vance'); assert.equal(two.first, 'Drew');
});

test('stated grade in comments', () => {
  assert.deepEqual(statedGrades('earning a final grade of (B+). He earned a (B) on his course paper.'), ['B+']);
  assert.deepEqual(statedGrades('Overall grade: A-'), ['A-']);
  assert.deepEqual(statedGrades('The overall grade is a reflection of effort.'), []);
  assert.deepEqual(statedGrades('final grade of Distinguished'), []);
});

test('elements follow dashboard column order', () => {
  const [r] = seminar([['LTC', 'Avery', 'Stanton', 'P', 'S', 'P', 'B+']]);
  assert.deepEqual(r.elements.map(e => e.name), ['Oral', 'Strategic Thinking', 'Writing']);
});

test('same ratings, different grade; and inversions', () => {
  const recs = seminar([
    ['LTC', 'Avery', 'Stanton', 'P', 'S', 'P', 'B+'],
    ['LTC', 'Jordan', 'Hale', 'S', 'S', 'S', 'B+'],
    ['LTC', 'Casey', 'Monroe', 'S', 'S', 'S', 'A-'],
    ['LTC', 'Blake', 'Corwin', 'S', 'S', 'S', 'A-'],
    ['LTC', 'Quinn', 'Whitlock', 'S', 'S', 'S', 'A-'],
    ['LTC', 'Parker', 'Galloway', 'P', 'S', 'S', 'A-'],
    ['LTC', 'Rowan', 'Thorne', 'P', 'S', 'S', 'B+'],
  ]);
  const { flags } = analyze(recs);
  const pattern = flags.filter(f => f.type === 'pattern');
  const hale = recs.find(r => r.last === 'Hale');
  assert.ok(pattern.some(f => f.keys[0] === hale.key && f.severity === 'medium'), 'Hale got B+ where most S/S/S got A-');
  // P/S/S split 1-1: both flagged as no clear norm.
  assert.equal(pattern.filter(f => f.severity === 'low').length, 2);
  const inv = flags.filter(f => f.type === 'inversion');
  assert.ok(inv.some(f => f.keys[0] === hale.key && f.keys.includes(recs.find(r => r.last === 'Galloway').key)));
});

test('comment checks', () => {
  const recs = seminar([
    ['LTC', 'Avery', 'Stanton', 'P', 'S', 'P', 'B+', 'Avery earned a final grade of (A-).'],
    ['LTC', 'Jordan', 'Hale', 'S', 'S', 'S', 'A-', 'Avery did very well and earned a final grade of (A-) in this course.'],
    ['LTC', 'Casey', 'Monroe', 'S', 'S', 'S', 'A-', ''],
  ]);
  const { flags } = analyze(recs);
  const t = type => flags.filter(f => f.type === type);
  assert.equal(t('comment-grade').length, 1);
  assert.equal(t('comment-grade')[0].keys[0], recs[0].key);
  assert.equal(t('comment-name').length, 1);
  assert.equal(t('comment-name')[0].severity, 'high');
  assert.ok(t('comment-missing').some(f => f.keys[0] === recs[2].key));
});

test('rubric text under the wrong rating', () => {
  const rub = 'Integrates key concepts and challenges assumptions; identifies significant implications of approaches.';
  const dist = 'Integrates concepts across courses without prompting and frames original, well defended judgments.';
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push(['LTC', 'Name' + i, 'Last' + i, 'S', 'S', 'S', 'A-']);
  rows.push(['LTC', 'Odd', 'Case', 'S', 'D', 'S', 'A-']);
  for (let i = 0; i < 3; i++) rows.push(['LTC', 'Dn' + i, 'Dl' + i, 'S', 'D', 'S', 'A']);
  const recs = seminar(rows);
  for (const r of recs) {
    const st = r.elements.find(e => e.name === 'Strategic Thinking');
    st.comment = st.score === 3 ? rub : dist;
  }
  recs.find(r => r.last === 'Case').elements.find(e => e.name === 'Strategic Thinking').comment = rub;
  const flags = analyze(recs).flags.filter(f => f.type === 'comment-rubric');
  assert.equal(flags.length, 1);
  assert.equal(flags[0].keys[0], recs.find(r => r.last === 'Case').key);
});

test('seminar level and calibration flags', () => {
  const recs = [];
  const base = [['S', 'S', 'S', 'A-'], ['P', 'S', 'P', 'B+'], ['P', 'P', 'P', 'B'], ['S', 'D', 'S', 'A-'], ['S', 'S', 'P', 'B+'], ['P', 'S', 'S', 'B+']];
  for (let sem = 1; sem <= 4; sem++) {
    const rows = base.map(([o, s, w, g], i) => {
      const lenient = sem === 4 ? { 'A-': 'A', 'B+': 'A-', 'B': 'B+' }[g] : g;
      return ['LTC', `F${sem}x${i}`, `L${sem}x${i}`, o, s, w, lenient];
    });
    recs.push(...seminar(rows, { sem: String(sem), faculty: `Fac ${sem}` }));
  }
  const { flags, courses } = analyze(recs);
  const s4 = courses[0].seminars.find(s => s.seminar === '4');
  assert.ok(s4.calibration > 0.25);
  assert.ok(flags.some(f => f.type === 'calibration' && f.seminar === '4' && f.severity === 'high'));
  assert.ok(flags.some(f => f.type === 'seminar-level' && f.seminar === '4'));
  assert.ok(!flags.some(f => f.type === 'calibration' && f.seminar === '1'));
});

test('dashboard and report disagree', () => {
  const [r] = seminar([['LTC', 'Avery', 'Stanton', 'P', 'S', 'P', 'B+']]);
  const raw = {
    rowName: 'LTC Avery Stanton', rowCells: { 'Student Name': 'LTC Avery Stanton', Oral: R.S, Overall: 'B+' },
    name: 'Stanton, Avery, LTC', course: 'C', seminar: '1', faculty: 'X',
    elements: [{ element: 'Oral', rating: R.P, comment: 'x' }, { element: 'Overall', rating: 'B+', comment: 'y' }],
  };
  const n = normalizeRecord(raw);
  assert.equal(n.warnings.length, 1);
  assert.ok(analyze([n]).flags.some(f => f.type === 'data' && f.severity === 'high'));
  assert.ok(r);
});

test('merge keeps the latest collection', () => {
  const [a] = seminar([['LTC', 'Avery', 'Stanton', 'P', 'S', 'P', 'B+']]);
  const b = { ...a, grade: 'A-', collectedAt: '2026-10-01' };
  const merged = mergeRecords([[a], [b]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].grade, 'A-');
});

test('sample data finds every planted problem', () => {
  const recs = parseExport(JSON.stringify(makeSampleExport()));
  const { flags } = analyze(recs);
  for (const type of ['comment-grade', 'comment-name', 'comment-rubric', 'comment-missing', 'low-multi', 'calibration', 'seminar-level', 'pattern', 'inversion']) {
    assert.ok(flags.some(f => f.type === type), `no ${type} flag`);
  }
});

test('csv export escapes and guards formulas', () => {
  const [r] = seminar([['LTC', 'Avery', 'Stanton', 'P', 'S', 'P', 'B+', '=HYPERLINK("x") said "hi", then left']]);
  const csv = toCsv([r], new Map());
  assert.ok(csv.includes(`"'=HYPERLINK(""x"") said ""hi"", then left"`));
});
