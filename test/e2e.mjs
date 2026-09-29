// End-to-end check: run the collector on a mock Compass page, then load its export into the review page.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const out = process.env.SHOT_DIR || fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(new URL('test/mock-compass.html', root).href);
await page.addScriptTag({ content: readFileSync(new URL('src/collector.js', root), 'utf8') });
await page.getByRole('button', { name: 'Collect this page' }).click();
await page.waitForFunction(() => /Done\./.test(document.querySelector('[aria-label="Grade collector"]').innerText), null, { timeout: 60000 });
const status = await page.locator('[data-role="status"]').innerText();
console.log('collector:', status);
await page.screenshot({ path: out + 'collector.png' });
const dl = page.waitForEvent('download');
await page.getByRole('button', { name: 'Download for review' }).click();
const file = await (await dl).path();
const exported = JSON.parse(readFileSync(file, 'utf8'));
writeFileSync(out + 'export.json', JSON.stringify(exported, null, 1));
const recs = exported.records;
if (recs.length !== 10) throw new Error('expected 10 records, got ' + recs.length);
for (const r of recs) {
  if (r.warnings.length) throw new Error('warning: ' + r.warnings.join(';'));
  if (r.course !== 'Foundations Theories and Concepts' || r.seminar !== '1') throw new Error('bad header parse: ' + r.course + '/' + r.seminar);
  if (!/Adair/.test(r.faculty) || r.elements.length !== 4) throw new Error('bad report parse for ' + r.rowName);
  if (!r.name.includes(r.rowName.split(' ').filter(t => t !== 'Jr').pop())) throw new Error('report/row mismatch ' + r.name + ' vs ' + r.rowName);
}

// Review page.
const review = await ctx.newPage();
review.on('pageerror', e => errors.push(e.message));
const net = [];
review.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) net.push(r.url()); });
await review.goto(new URL('grade-review.html', root).href);
await review.screenshot({ path: out + 'welcome.png', fullPage: true });
await review.setInputFiles('#fileInput', file);
await review.waitForSelector('nav.tabs');
await review.getByRole('tab', { name: /Flags/ }).click();
const flagText = await review.locator('#view').innerText();
for (const expect of ['Comment says A, grade is A-', 'names a classmate', 'Higher ratings than']) {
  if (!flagText.includes(expect)) throw new Error('missing flag: ' + expect);
}
await review.screenshot({ path: out + 'flags-mock.png', fullPage: true });

// Sample data views.
await review.goto(new URL('grade-review.html', root).href);
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
const blocked = await review.evaluate(() => fetch('https://example.com/').then(() => false, () => true));
if (!blocked) throw new Error('fetch was not blocked');

// The bookmarklet link decodes to working collector code.
await review.getByRole('tab', { name: 'Collect more' }).click();
const href = await review.locator('#bm').getAttribute('href');
const fresh = await ctx.newPage();
await fresh.goto(new URL('test/mock-compass.html', root).href);
await fresh.evaluate(code => { (0, eval)(code); }, decodeURIComponent(href.slice('javascript:'.length)));
await fresh.getByText('Found 10 students on this page').waitFor();

if (net.length) throw new Error('review page made network requests: ' + net.join(', '));
if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
console.log('e2e ok');
await browser.close();
