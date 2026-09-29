// End-to-end checks with made-up data:
//  1. The collector reads one seminar's student list on a mock Compass page.
//  2. "Collect many seminars" works from a mock seminar picker: plain links, clickable rows,
//     a drop-down form, and a site that refuses to load in a frame (pop-up fallback).
//  3. The review page loads the export, finds the expected flags, blocks network requests,
//     and renders every tab.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const out = process.env.SHOT_DIR || join(rootDir, '.shots/');
mkdirSync(out, { recursive: true });

// Static server. ?xfo=1 on a mock page sends X-Frame-Options: DENY, as some sites do.
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = normalize(join(rootDir, decodeURIComponent(url.pathname)));
  if (!file.startsWith(rootDir) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  const headers = { 'Content-Type': extname(file) === '.html' ? 'text/html' : 'text/plain' };
  if (url.searchParams.get('xfo')) headers['X-Frame-Options'] = 'DENY';
  res.writeHead(200, headers);
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const collectorSrc = readFileSync(join(rootDir, 'src/collector.js'), 'utf8');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));

async function download(p, name) {
  const dl = p.waitForEvent('download');
  await p.getByRole('button', { name }).click();
  return (await dl).path();
}
async function waitDone(p, timeout = 120000) {
  await p.waitForFunction(() => /(Done|Stopped)\./.test(document.querySelector('[aria-label="Grade collector"] [data-role="status"]').innerText), null, { timeout });
  return p.locator('[aria-label="Grade collector"] [data-role="status"]').innerText();
}
function check(cond, msg) { if (!cond) throw new Error(msg); }

// ---- 1. One seminar ----
await page.goto(base + 'test/mock-compass.html');
await page.addScriptTag({ content: collectorSrc });
await page.getByRole('button', { name: 'Collect this page' }).click();
console.log('one page:', await waitDone(page));
await page.screenshot({ path: out + 'collector.png' });
const file = await download(page, 'Download for review');
const recs = JSON.parse(readFileSync(file, 'utf8')).records;
check(recs.length === 10, 'expected 10 records, got ' + recs.length);
for (const r of recs) {
  check(!r.warnings.length, 'warning: ' + r.warnings.join(';'));
  check(r.course === 'Foundations Theories and Concepts' && r.seminar === '1', 'bad header parse: ' + r.course + '/' + r.seminar);
  check(/Adair/.test(r.faculty) && r.elements.length === 4, 'bad report parse for ' + r.rowName);
  check(r.name.includes(r.rowName.split(' ').filter(t => t !== 'Jr').pop()), 'report/row mismatch ' + r.name + ' vs ' + r.rowName);
}
page.once('dialog', d => d.accept());
await page.getByRole('button', { name: 'Clear saved data' }).click();

// ---- 1b. Slow Compass: a report that does not open, one whose header loads late, one whose header never loads the first time ----
await page.goto(base + 'test/mock-compass.html?flaky=2&late=4&stuck=6');
await page.addScriptTag({ content: collectorSrc });
await page.getByRole('button', { name: 'Collect this page' }).click();
console.log('slow page:', await waitDone(page));
const slow = JSON.parse(readFileSync(await download(page, 'Download for review'), 'utf8')).records;
check(slow.length === 10, 'slow: expected 10 records, got ' + slow.length);
for (const r of slow) check(!r.warnings.length && r.course && r.seminar === '1' && r.faculty, 'slow: problem with ' + r.rowName + ': ' + r.warnings.join(';'));
check(slow.filter(r => r.attempts === 2).length === 2, 'slow: expected two retried reports');
page.once('dialog', d => d.accept());
await page.getByRole('button', { name: 'Clear saved data' }).click();

// ---- 2. Many seminars from the picker ----
async function runMany(menuUrl, sourceMatch, prep) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(menuUrl);
  await p.waitForSelector('#tasks tbody tr');
  await p.waitForSelector('#tasks2 tbody tr');
  if (prep) await prep(p);
  await p.addScriptTag({ content: collectorSrc });
  await p.getByRole('button', { name: 'Collect many seminars' }).click();
  const src = p.locator('[data-role="source"]');
  const labels = await src.locator('option').allInnerTexts();
  const idx = labels.findIndex(l => sourceMatch.test(l));
  check(idx >= 0, `no source matching ${sourceMatch} in: ${labels.join(' | ')}`);
  await src.selectOption(String(idx));
  await p.screenshot({ path: out + 'chooser.png' });
  await p.getByRole('button', { name: 'Start' }).click();
  await p.waitForTimeout(2500);
  await p.screenshot({ path: out + 'many-running.png' });
  const msg = await waitDone(p);
  const f = await download(p, 'Download for review');
  const got = JSON.parse(readFileSync(f, 'utf8')).records;
  p.once('dialog', d => d.accept());
  await p.getByRole('button', { name: 'Clear saved data' }).click();
  await p.close();
  return { msg, got };
}
function seminarsOf(list) { return [...new Set(list.map(r => r.seminar))].sort().join(','); }

let r = await runMany(base + 'test/mock-menu.html', /^Links: Seminar 1/);
console.log('links:', r.msg);
check(seminarsOf(r.got) === '1,2,3' && r.got.length === 30 && r.got.every(x => !x.warnings.length), 'links run: ' + seminarsOf(r.got) + ' / ' + r.got.length);

r = await runMany(base + 'test/mock-menu.html', /^Links: Seminar 4/);
console.log('clickable rows:', r.msg);
check(seminarsOf(r.got) === '4,5' && r.got.length === 20, 'click run: ' + seminarsOf(r.got) + ' / ' + r.got.length);

r = await runMany(base + 'test/mock-menu.html', /^Links: Seminar 10 \u00b7 AA2200Foundations/);
console.log('icon buttons in a table:', r.msg);
check(seminarsOf(r.got) === '10,11,12' && r.got.length === 30, 'icon run: ' + seminarsOf(r.got) + ' / ' + r.got.length);

r = await runMany(base + 'test/mock-menu.html', /^Links: AA2300Theory/);
console.log('rows with the same name:', r.msg);
check(seminarsOf(r.got) === '13,14' && r.got.length === 20, 'same-name run: ' + seminarsOf(r.got) + ' / ' + r.got.length);

r = await runMany(base + 'test/mock-menu.html', /^List "Seminar"/, p => p.selectOption('#course', 'Strategic Leadership'));
console.log('drop-down:', r.msg);
check(seminarsOf(r.got) === '7,8' && r.got.length === 20, 'select run: ' + seminarsOf(r.got) + ' / ' + r.got.length);
check(r.got.every(x => x.course === 'Strategic Leadership'), 'other drop-down value not carried over');

r = await runMany(base + 'test/mock-menu.html?xfo=1', /^Links: Seminar 1/);
console.log('frame refused, pop-up:', r.msg);
check(seminarsOf(r.got) === '1,2,3' && r.got.length === 30, 'pop-up run: ' + seminarsOf(r.got) + ' / ' + r.got.length);

// ---- 3. Review page ----
const review = await ctx.newPage();
review.on('pageerror', e => errors.push(e.message));
const net = [];
review.on('request', q => { if (!/^(file|data|blob):/.test(q.url())) net.push(q.url()); });
await review.goto('file://' + join(rootDir, 'grade-review.html'));
await review.screenshot({ path: out + 'welcome.png', fullPage: true });
await review.setInputFiles('#fileInput', file);
await review.waitForSelector('nav.tabs');
await review.getByRole('tab', { name: /Flags/ }).click();
const flagText = await review.locator('#view').innerText();
for (const expect of ['Comment says A, grade is A-', 'names a classmate', 'Higher ratings than']) check(flagText.includes(expect), 'missing flag: ' + expect);
await review.screenshot({ path: out + 'flags-mock.png', fullPage: true });

await review.goto('file://' + join(rootDir, 'grade-review.html'));
await review.getByRole('button', { name: 'Try sample data' }).click();
await review.selectOption('#courseSel', { index: 1 });
await review.screenshot({ path: out + 'overview.png', fullPage: true });
await review.getByRole('tab', { name: 'Rating patterns' }).click();
await review.screenshot({ path: out + 'patterns.png', fullPage: true });
await review.getByRole('tab', { name: /Flags/ }).click();
await review.locator('[data-queue]').first().click();
await review.screenshot({ path: out + 'flags.png' });
await review.getByRole('tab', { name: 'Students' }).click();
await review.locator('tr[data-student]').first().click();
await review.screenshot({ path: out + 'student.png' });
await review.keyboard.press('Escape');
await review.getByRole('tab', { name: 'Review log' }).click();
await review.screenshot({ path: out + 'log.png', fullPage: true });
await review.emulateMedia({ colorScheme: 'dark' });
await review.getByRole('tab', { name: 'Seminars' }).click();
await review.screenshot({ path: out + 'overview-dark.png', fullPage: true });

// The page's policy must block outbound requests.
check(await review.evaluate(() => fetch('https://example.com/').then(() => false, () => true)), 'fetch was not blocked');

// The bookmarklet link decodes to working collector code.
await review.getByRole('tab', { name: 'Collect more' }).click();
const href = await review.locator('#bm').getAttribute('href');
const fresh = await ctx.newPage();
await fresh.goto(base + 'test/mock-compass.html');
await fresh.evaluate(code => { (0, eval)(code); }, decodeURIComponent(href.slice('javascript:'.length)));
await fresh.getByText('Found 10 students on this page').waitFor();

check(!net.length, 'review page made network requests: ' + net.join(', '));
check(!errors.length, 'page errors: ' + errors.join(' | '));
console.log('e2e ok');
await browser.close();
server.close();
