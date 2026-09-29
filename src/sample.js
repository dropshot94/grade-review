// Synthetic sample data in the collector's export format. All names are made up.
// Used by the "Try sample data" button and by the tests.

export function makeSampleExport(seed = 7) {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pick = a => a[Math.floor(rand() * a.length)];

  const FIRST = ['Alex', 'Jordan', 'Casey', 'Morgan', 'Riley', 'Taylor', 'Avery', 'Quinn', 'Parker', 'Reese',
    'Drew', 'Harper', 'Rowan', 'Emerson', 'Blake', 'Cameron', 'Hayden', 'Jamie', 'Kendall', 'Logan',
    'Micah', 'Peyton', 'Sawyer', 'Skyler', 'Tatum', 'Elliot', 'Finley', 'Marlowe', 'Sutton', 'Wren'];
  const LAST = ['Abbott', 'Barlow', 'Calder', 'Dunmore', 'Ellery', 'Fairbank', 'Galloway', 'Hartwell', 'Ingram',
    'Jessup', 'Kirkland', 'Lockhart', 'Merriam', 'Norwood', 'Oakes', 'Pembrook', 'Quimby', 'Radley', 'Stanton',
    'Thorne', 'Upton', 'Vance', 'Whitlock', 'Yardley', 'Ashby', 'Brandt', 'Corwin', 'Delancey', 'Eastman',
    'Fenwick', 'Gilchrist', 'Holloway', 'Iverson', 'Jarrell', 'Kessler', 'Lindqvist', 'Mercer', 'Nash', 'Orton',
    'Prescott', 'Rourke', 'Sherwood', 'Tolliver', 'Underhill', 'Vickery', 'Wexford', 'Ainsley', 'Bramwell',
    'Crowther', 'Dexter', 'Everly', 'Fitzhugh', 'Granger', 'Hensley', 'Kimball', 'Langford', 'Maddox', 'Pryor',
    'Redmond', 'Sinclair', 'Talbot', 'Wardell', 'Yates', 'Ballard', 'Carrow', 'Donnelly', 'Emmett', 'Forsyth',
    'Garrick', 'Hadley', 'Irwin', 'Kendrick', 'Lowell', 'Marsh', 'Newbury', 'Osgood', 'Pickett', 'Rhodes',
    'Sayer', 'Tremont', 'Whitaker', 'Ashford', 'Beckett', 'Crane', 'Dorsey', 'Elwood', 'Fowler', 'Gentry',
    'Harlan', 'Keene', 'Larkin', 'Mayfield', 'Nolan', 'Orwell', 'Pruitt', 'Ramsey', 'Stroud', 'Temple',
    'Wainwright', 'Aldridge', 'Bristow', 'Colby', 'Darrow', 'Eldridge', 'Frost', 'Gale', 'Hollis', 'Jett',
    'Kerr', 'Lyle', 'Monroe', 'Nye', 'Pratt', 'Royce', 'Shaw', 'Tate', 'Voss', 'Wick', 'York', 'Zane', 'Blythe',
    'Cutler', 'Dane', 'Foss', 'Grier', 'Hume', 'Kidd', 'Lane', 'Moss'];
  const RANKS = ['LTC', 'LTC', 'LTC', 'LTC', 'COL', 'CDR', 'Lt Col', 'Mr', 'Ms'];
  const RATINGS = { 4: 'Distinguished Performance', 3: 'Superior Performance', 2: 'Performed to Standards', 1: 'Needs Improvement' };
  const ELEMENTS = ['Oral', 'Strategic Thinking', 'Writing'];
  const RUBRIC = {
    'Oral': {
      4: 'Contributions consistently shape the seminar dialogue; delivery is clear, compelling, and tailored to a senior audience.',
      3: 'Contributions often advance the seminar dialogue; delivery is clear and organized with few prompts from faculty.',
      2: 'Contributions are relevant and organized; delivery is clear, though listeners sometimes ask for clarification.',
      1: 'Contributions are infrequent or unfocused; delivery often leaves the audience unsure of the main point.',
    },
    'Strategic Thinking': {
      4: 'Integrates concepts across courses without prompting and frames original, well defended judgments on complex issues.',
      3: 'Integrates key concepts and challenges assumptions; identifies significant implications of competing approaches.',
      2: 'Applies key concepts accurately and recognizes major implications, with some prompting from faculty.',
      1: 'Applies concepts unevenly and often misses the implications of competing approaches to an issue.',
    },
    'Writing': {
      4: 'Written work is precise and persuasive, argues a focused thesis, and draws on strong evidence throughout.',
      3: 'Written work is clear and well organized, argues a sound thesis, and supports most claims with good evidence.',
      2: 'Written work is informative and focused, argues a thesis, and supports most claims with relevant sources.',
      1: 'Written work lacks a clear thesis or support; errors in grammar or citation detract from the meaning.',
    },
  };
  const COURSES = ['Foundations Theories and Concepts', 'Strategic Leadership'];
  const FACULTY_LAST = ['Adair', 'Beale', 'Conroy', 'Dillard', 'Easton', 'Farrow', 'Goss', 'Hale', 'Irby', 'Judd',
    'Kemp', 'Lister', 'Mott', 'Nevins', 'Ogle', 'Penn'];

  const nSem = 8, perSem = 15;
  const usedNames = new Set();
  const students = [];
  for (let sem = 1; sem <= nSem; sem++) {
    const usedFirst = new Set();
    for (let i = 0; i < perSem; i++) {
      let first, last;
      do { first = pick(FIRST); } while (usedFirst.has(first));
      do { last = pick(LAST); } while (usedNames.has(last));
      usedFirst.add(first);
      usedNames.add(last);
      students.push({ sem, first, last, mid: String.fromCharCode(65 + Math.floor(rand() * 26)), rank: pick(RANKS), ability: rand() });
    }
  }

  const scale = ['F', 'D', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A'];
  const baseGrade = total => (total >= 12 ? 'A' : total >= 10 ? 'A-' : total >= 8 ? 'B+' : total >= 6 ? 'B' : 'B-');
  const shift = (g, n) => scale[Math.max(0, Math.min(scale.length - 1, scale.indexOf(g) + n))];

  const records = [];
  COURSES.forEach((course, ci) => {
    for (const st of students) {
      const scores = ELEMENTS.map(() => {
        const x = st.ability * 0.7 + rand() * 0.45;
        return x > 0.95 ? 4 : x > 0.5 ? 3 : x > 0.12 ? 2 : 1;
      });
      const total = scores.reduce((a, b) => a + b, 0);
      let grade = baseGrade(total);
      if (rand() < 0.12) grade = shift(grade, rand() < 0.5 ? -1 : 1); // ordinary noise
      if (st.sem === 3 && ci === 0) grade = shift(grade, 1);           // lenient seminar
      if (st.sem === 6 && ci === 1 && rand() < 0.6) grade = shift(grade, -1); // strict seminar
      const fac = FACULTY_LAST[(st.sem - 1 + ci * nSem) % FACULTY_LAST.length];
      const nameRow = `${st.rank} ${st.first} ${st.mid} ${st.last}`;
      const elements = ELEMENTS.map((el, i) => ({ element: el, rating: RATINGS[scores[i]], comment: RUBRIC[el][scores[i]] }));
      const paper = pick(['deterrence in the Indo-Pacific', 'Arctic security', 'defense industrial capacity',
        'alliance burden sharing', 'information advantage', 'civil-military relations', 'energy security']);
      const overallComment = `${st.first} performed ${grade.startsWith('A') ? 'very well' : 'well'} throughout ${course}, earning a final grade of (${grade}). ` +
        `The course paper on ${paper} ${scores[2] >= 3 ? 'was well argued' : 'met course standards'}. ` +
        pick([`${st.first}'s participation helped create a productive learning environment.`,
          `${st.first} often connected seminar topics to operational experience.`,
          `${st.first} should keep working on concise, focused arguments.`]);
      elements.push({ element: 'Overall', rating: grade, comment: overallComment });
      records.push({
        collectedAt: '2026-09-29T12:00:00.000Z',
        page: 'sample',
        rowName: nameRow,
        rowCells: Object.fromEntries([['Student Name', nameRow], ...ELEMENTS.map((el, i) => [el, RATINGS[scores[i]]]), ['Overall', grade]]),
        name: `${st.last}, ${st.first} ${st.mid}, ${st.rank}`,
        program: 'AY2027 Resident Program (SAMPLE)',
        term: '0',
        course,
        seminar: String(st.sem),
        faculty: `${fac}, Pat Q COL`,
        date: ci === 0 ? '16 Sep 2026' : '27 Oct 2026',
        signature: '//Electronically Approved//',
        elements,
        warnings: [],
      });
    }
  });

  // Planted problems so every check has something to find.
  const find = (course, sem, idx) => records.filter(r => r.course === course && r.seminar === String(sem))[idx];
  const ov = r => r.elements.find(e => e.element === 'Overall');

  const a = find(COURSES[0], 2, 4);               // comment states the wrong grade
  ov(a).comment = ov(a).comment.replace(/final grade of \([^)]+\)/, `final grade of (${ov(a).rating === 'A' ? 'A-' : 'A'})`);

  const b = find(COURSES[0], 4, 2), bOther = find(COURSES[0], 4, 7); // comment copied from a classmate
  ov(b).comment = ov(bOther).comment;

  const c = find(COURSES[1], 5, 3);               // element comment from a different rating
  const w = c.elements.find(e => e.element === 'Writing');
  const wrongScore = w.rating === RATINGS[4] ? 2 : 4;
  w.comment = RUBRIC.Writing[wrongScore];

  const d = find(COURSES[0], 7, 1);               // missing overall comment
  ov(d).comment = '';

  const lowName = find(COURSES[0], 1, 9).name;    // low in both courses
  for (const r of records.filter(x => x.name === lowName)) {
    r.elements[0].rating = RATINGS[1]; r.rowCells.Oral = RATINGS[1];
    r.elements[0].comment = RUBRIC.Oral[1];
    const o = ov(r); o.rating = 'B-'; r.rowCells.Overall = 'B-';
    o.comment = o.comment.replace(/final grade of \([^)]+\)/, 'final grade of (B-)');
  }

  return { format: 'compass-grade-export', version: 1, exportedAt: '2026-09-29T12:00:00.000Z', sample: true, records };
}
