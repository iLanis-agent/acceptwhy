// Cross-check engine.js against the Python oracle: RFC hand cases + fuzz.
const { execFileSync } = require('child_process');
const A = require('../engine.js');

const cases = [];
// RFC 9110 12.4.2 style hand cases
cases.push({ header: 'text/*;q=0.3, text/plain;q=0.7, text/plain;format=flowed, text/plain;format=delimited, */*;q=0.1',
  reps: ['text/plain;format=flowed', 'text/plain;format=delimited', 'text/plain', 'text/html', 'image/png'] });
cases.push({ header: 'text/html;level=1, text/html;level=2;q=0.4, text/*;q=0.3, */*;q=0.5',
  reps: ['text/html;level=1', 'text/html;level=2', 'text/html', 'text/plain', 'image/jpeg'] });
// Gotcha: specificity beats q order
cases.push({ header: 'text/plain;q=0.5, text/*;q=0.9', reps: ['text/plain', 'text/html'] });
// q=0 exclusion
cases.push({ header: 'text/html, application/json;q=0', reps: ['application/json', 'text/html'] });
// Absent header
cases.push({ header: '', reps: ['application/json', 'text/html'] });
// Wildcard only
cases.push({ header: '*/*', reps: ['application/json', 'image/png'] });
// Invalid q element skipped
cases.push({ header: 'text/html;q=1.5, application/json', reps: ['text/html', 'application/json'] });
// Case-insensitivity
cases.push({ header: 'TEXT/PLAIN;Q=0.2, Application/JSON', reps: ['text/plain', 'application/json'] });
// No match -> 406
cases.push({ header: 'image/png', reps: ['text/html', 'application/json'] });
// Ties -> server order
cases.push({ header: 'text/html, application/json', reps: ['application/json', 'text/html'] });
// Malformed elements
cases.push({ header: 'not-a-type, text/html', reps: ['text/html'] });
cases.push({ header: 'text/*;, text/html', reps: ['text/html', 'text/plain'] });

const types = ['text', 'application', 'image', 'audio'];
const subs = ['html', 'plain', 'json', 'png', 'jpeg', 'xml', 'csv'];
const pnames = ['level', 'charset', 'format', 'version'];
function ri(n) { return Math.floor(Math.random() * n); }
function rqs() {
  const r = Math.random();
  if (r < 0.08) return ';q=1.5';            // invalid
  if (r < 0.16) return ';q=0';              // refusal
  if (r < 0.3) return ';q=0.' + ri(10);
  if (r < 0.45) return ';q=0.0' + ri(10);
  return '';
}
function rRange() {
  let t = Math.random() < 0.25 ? '*' : types[ri(types.length)];
  let s = Math.random() < 0.35 ? '*' : subs[ri(subs.length)];
  if (t === '*') s = '*';
  let str = t + '/' + s;
  if (Math.random() < 0.3 && t !== '*') str += ';' + pnames[ri(pnames.length)] + '=' + (1 + ri(3));
  return str + rqs();
}
function rRep() {
  let str = types[ri(types.length)] + '/' + subs[ri(subs.length)];
  if (Math.random() < 0.4) str += ';' + pnames[ri(pnames.length)] + '=' + (1 + ri(3));
  return str;
}
for (let i = 0; i < 500; i++) {
  const nr = 1 + ri(5);
  const header = Array.from({ length: nr }, rRange).join(', ');
  const reps = Array.from({ length: 1 + ri(4) }, rRep);
  cases.push({ header, reps });
}

const oracle = JSON.parse(execFileSync('python3', ['test/oracle.py'], { input: JSON.stringify(cases), maxBuffer: 1 << 25 }).toString());

let fails = 0, checked = 0;
cases.forEach((c, i) => {
  const js = A.negotiate(c.header, c.reps);
  const py = oracle[i];
  checked++;
  if (js.winner !== py.winner) { fails++; if (fails <= 5) console.log('WINNER MISMATCH', i, JSON.stringify(c), 'js', js.winner, 'py', py.winner); }
  js.results.forEach((r, j) => {
    const pr = py.results[j];
    checked++;
    const jsQ = r.acceptable ? r.q : (r.q === 0 ? 0 : null);
    const pyQ = pr === null ? 'INVALID' : (pr[0] ? pr[1] : (pr[1] === 0 ? 0 : null));
    if (pr === 'INVALID' || pr === null && !r.valid) return;
    if (pyQ === 'INVALID') { if (r.valid !== false) { fails++; console.log('VALIDITY MISMATCH', i, j, JSON.stringify(c)); } return; }
    if (jsQ !== pyQ) { fails++; if (fails <= 5) console.log('Q MISMATCH', i, j, JSON.stringify(c), 'js', jsQ, 'py', pyQ); }
  });
});
console.log(`cases=${cases.length} checked=${checked} fails=${fails}`);
process.exit(fails ? 1 : 0);
