// Builds grade-review.html: one self-contained, offline file.
import { readFileSync, writeFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const stripExports = s => s.replace(/^export /gm, '');
const pkg = JSON.parse(read('./package.json'));

const collector = read('./src/collector.js');
const script = [
  '(function () {',
  "'use strict';",
  stripExports(read('./src/analysis.js')),
  stripExports(read('./src/sample.js')),
  `const COLLECTOR_SRC = ${JSON.stringify(collector)};`,
  read('./src/app.js'),
  '})();',
].join('\n').replace(/<\/(script)/gi, '<\\/$1');

const html = read('./src/template.html')
  .replace('/*STYLES*/', () => read('./src/styles.css'))
  .replace('/*VERSION*/', () => pkg.version)
  .replace('/*SCRIPT*/', () => script);

writeFileSync(new URL('./grade-review.html', import.meta.url), html);
console.log(`grade-review.html ${(html.length / 1024).toFixed(0)} KB`);
