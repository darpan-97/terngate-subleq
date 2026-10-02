// page_check.js -- the playground's JavaScript (docs/subleq_engine.js) held to the nitropz programs it is a
// port of. Run by check.sh, after sh build.sh, when node is installed:
//   0. both models' every chance after every byte of a text, bit for bit as out/chances gives them;
//   1. the gate model: the five gates it writes, word for word as out/subleq_machine writes them, each
//      read back to its truth table; the computer below is built from those tables;
//   2. the program model: the tasks of `out/subleq_write export`, each written, assembled and run on that
//      computer a step at a time: template, program, cells, memory and every step the same;
//   3. 30 more tasks, the template and program byte for byte as `out/subleq_write live` writes them;
//   4. the compiler (docs/subleq_compiler.js): for each expression below, its steps, its program, its run
//      and its verdict, every byte as `out/subleq_compile` prints them.
// The last line it prints says what was the same; it exits 1 when anything was not.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const here = path.join(__dirname, '..');
const S = require(path.join(here, 'docs', 'subleq_engine.js'));
const C = require(path.join(here, 'docs', 'subleq_compiler.js'));
const program = name => path.join(here, 'out', name + (process.platform === 'win32' ? '.exe' : ''));
const run = (name, args) => {        // what the program prints, whatever it exits with
  let out;
  try { out = execFileSync(program(name), args, { cwd: here, maxBuffer: 1 << 26 }); } catch (err) { out = err.stdout || ''; }
  return out.toString().replace(/\r/g, '');
};
const model = file => S.loadModel(new Uint8Array(fs.readFileSync(path.join(here, 'models', file))));
const fails = [];

// 1. the gates, and the computer made of them
const gates = model('35k_gates.tlm2');
const machineOut = run('subleq_machine', []);
const tables = {};
let gateText = '';
S.GATES.forEach((gate, k) => {
  const w = S.GateWriter(S.Engine(gates), gate.g, gate.ins);
  while (w.next() !== null) {}
  const text = w.prompt + w.program();
  gateText = text;
  if (!machineOut.includes(text)) fails.push(gate.role + ': not written as out/subleq_machine writes it');
  const table = S.readGate(text, gate.ins);
  const want = [];
  for (let r = 0; r < (1 << gate.ins); r++) want.push(S.gateBit(gate.g, gate.ins, r));
  if (!table || table.join() !== want.join()) fails.push(gate.role + ': does not read back to its truth table');
  tables[['NOT', 'OR', 'SUM', 'CARRY', 'CHOOSE'][k]] = table;
});
const M = fails.length ? S.machine(S.KNOWN_GATES) : S.machine(tables);

// 2. the export's tasks, every step
const programs = model('35k_subleq.tlm2');
run('subleq_write', ['export', 'out/subleq_data.js']);
const page = {};
new Function('window', fs.readFileSync(path.join(here, 'out', 'subleq_data.js'), 'utf8'))(page);
const json = JSON.stringify;
for (const r of page.SUBLEQ_RUNS) {
  const w = S.Writer(S.Engine(programs), r.task);
  while (w.next() !== null) {}
  const written = w.program();
  const asm = S.assemble(r.task + '\n' + written, [3, 5, 7, 11, 13]);
  const same = asm !== null && w.prompt === r.prompt && written === r.program && asm.r === r.r &&
    json(asm.cells) === json(r.cells) && json(asm.mem.slice(0, 64).map(S.signed)) === json(r.memory) &&
    json(S.trace(asm, 2000, M).rows) === json(r.steps) && S.judge(r.task, written, 12345, M) === r.right;
  if (!same) fails.push(r.task + ': not as out/subleq_write export has it');
}

// 3. more tasks, byte for byte
const more = ['prog r=a:', 'prog r=e:', 'prog r=b+d:', 'prog r=e-c:', 'prog r=a-a:', 'prog r=c+c:', 'prog r=d-b+a:',
  'prog r=e+e-d:', 'prog r=a-b-c-d:', 'prog r=b+c-d+e:', 'prog r=e-e+a-b:', 'prog r=a*e:', 'prog r=e*c:', 'prog r=b*d:',
  'prog r=c*b:', 'prog r=d*a:', 'prog r=c/e:', 'prog print a:', 'prog print go:', 'prog print zip:', 'prog print nitro:',
  'prog print gates:', 'prog print learned:', 'prog print ternary:', 'prog print abcdefgh:', 'prog r=c-a:',
  'prog r=d+e+a:', 'prog r=b-e+c-a:', 'prog r=b/a:', 'prog print xyz:'];
for (const t of more) {
  const out = run('subleq_write', ['live', t]);
  const w = S.Writer(S.Engine(programs), t);
  while (w.next() !== null) {}
  if (out.slice(0, out.lastIndexOf('  => ')) !== w.prompt + w.program()) fails.push(t + ': not as out/subleq_write live writes it');
}

// 0. every chance, bit for bit: a model reading a text, and after each byte all its chances' bits
function bits(m, text) {
  const e = S.Engine(m), dv = new DataView(new ArrayBuffer(8)), lines = [];
  for (let pos = 0; pos < text.length && pos < m.CONTEXT; pos++) {
    e.step(text.charCodeAt(pos), pos);
    const p = [];
    for (let v = 0; v < m.VOCAB; v++) { dv.setFloat64(0, e.chances[v], true); p.push(dv.getInt32(0, true), dv.getInt32(4, true)); }
    lines.push(p.join(' ') + ' ');
  }
  return lines.join('\n') + '\n';
}
let positions = 0;
for (const [file, m, text] of [['35k_subleq.tlm2', programs, page.SUBLEQ_RUNS[4].prompt + page.SUBLEQ_RUNS[4].program],
                               ['35k_gates.tlm2', gates, gateText]]) {
  fs.writeFileSync(path.join(here, 'out', 'chances_text.txt'), text, 'latin1');
  if (run('chances', ['models/' + file, 'out/chances_text.txt']) !== bits(m, text)) fails.push(file + ': chances not bit for bit as out/chances gives them');
  positions += text.length;
}

// 4. the compiler: what out/subleq_compile prints, made by the port
function compiled(source) {
  const p = C.parse(source);
  if (p.error) return 'cannot compile: ' + p.error + '\n';
  const { steps, data } = C.lower(p.tree);
  let out = p.text + '\nsteps, each a task the model has been taught:\n';
  const written = steps.map(st => {
    const w = S.Writer(S.Engine(programs), st.question);
    while (w.next() !== null) {}
    out += ('  ' + st.shown).padEnd(26) + ' ' + st.question + '\n';
    return w.program();
  });
  const text = C.link(p.text, steps, written, data);
  out += "the program, every instruction the model's:\n" + text + '  => a = 3, b = 5, c = 7, d = 11, e = 13: ';
  const inputs = [3, 5, 7, 11, 13];
  const asm = S.assemble(text, inputs);
  let ran = null;
  if (C.evaluate(p.tree, inputs) === null) out += 'outside what the machine does';
  else if (asm === null) out += 'does not assemble';
  else if ((ran = S.run(asm, 400000, M)) === null) out += 'does not stop';
  else out += ran.steps + ' steps on the gate machine, r = ' + S.signed(ran.mem[asm.r]);
  const j = C.judge(p.tree, text, 12345, M, S);
  return out + (j.verdict === 1 ? ' -- right on ' + j.sets + ' sets of inputs\n' : j.verdict === 0 ? ' -- WRONG\n' :
    j.verdict === -1 ? ' -- does not assemble\n' : j.verdict === -2 ? ' -- does not stop\n' :
    ' -- no inputs from 0 to 20 keep it inside what the machine does\n');
}
const expressions = ['r = (a + b) * c - 3', 'a % b + 100 / (c + 1)', '-a', '7', 'a*a', 'e / (a - b)', '(a+b+c+d+e) / (b+1)',
  'a-b-c-d-e', '-(a+b)*c', '100*a - 3*b*c', 'e - 2*d + c*c', '(a*b) % 7', 'a/b/c', '(c-a)*(d-b)', 'r = ((a)) + f'];
for (const e of expressions) if (run('subleq_compile', [e]) !== compiled(e)) fails.push(e + ': not as out/subleq_compile compiles it');

if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
console.log('every chance at ' + positions + ' positions, both models, bit for bit as out/chances; 5 gates as out/subleq_machine ' +
  'writes them; ' + page.SUBLEQ_RUNS.length + ' programs as export has them, every step; ' + more.length + ' more as live writes them; ' +
  expressions.length + ' expressions as out/subleq_compile compiles them');
