// computer_check.js -- the hand-built computer held to its two other makings. Run by check.sh, after
// sh build.sh, when node is installed:
//   1. docs/subleq_computer.js (the JavaScript builder) makes models/subleq_computer.tlm2 byte for byte,
//      as subleq/computer_build.nitropz does (control: a model built with a planted fault differs);
//   2. a whole program run in the playground's engine (docs/subleq_engine.js): every step right against
//      the playground's trace(), and every chance at every byte -- the prompt and all the model wrote --
//      bit for bit as out/chances gives them (the nitropz engine), as page_check.js holds the trained
//      models (control: one gain changed in its last bit differs).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const here = path.join(__dirname, '..');
const S = require(path.join(here, 'docs', 'subleq_engine.js'));
const C = require(path.join(here, 'docs', 'subleq_computer.js'));
const exe = name => path.join(here, 'out', name + (process.platform === 'win32' ? '.exe' : ''));
const fails = [];

// 1. the JavaScript builder and the nitropz one
const shipped = fs.readFileSync(path.join(here, 'models', 'subleq_computer.tlm2'));
const built = Buffer.from(C.build(S, {}).net.bytes());
if (Buffer.compare(built, shipped) !== 0) fails.push('docs/subleq_computer.js does not make models/subleq_computer.tlm2 byte for byte');
const faulted = Buffer.from(C.build(S, { fault: 'mux' }).net.bytes());
if (Buffer.compare(faulted, shipped) === 0) fails.push('control: a model with a planted fault came out the same');

// 2. a program run in the playground's engine, every step and every chance's bits
const model = S.loadModel(new Uint8Array(shipped));
const P = lines => lines.map(l => '    ' + l).join('\n') + '\n';
const asm = S.assemble('prog r=c*d:\n' + P(['l1: z d l9', 'one d', 'l0: c z', 'z r', 'z z l1', 'l9: z z -1']), [0, 0, 123, 6, 0]);
const r = C.run(S, model, asm, 400);
const c = C.compare(S, asm, r.out, 400);
if (c.why !== null) fails.push('product c*d in the playground\'s engine: step ' + c.at + ': ' + c.why);
const text = r.prompt.concat(r.out.slice(0, -1));          // the last byte written is only foretold
function bits(m) {
  const e = S.Engine(m), dv = new DataView(new ArrayBuffer(8)), lines = [];
  for (let pos = 0; pos < text.length; pos++) {
    e.step(text[pos], pos);
    const p = [];
    for (let v = 0; v < m.VOCAB; v++) { dv.setFloat64(0, e.chances[v], true); p.push(dv.getInt32(0, true), dv.getInt32(4, true)); }
    lines.push(p.join(' ') + ' ');
  }
  return lines.join('\n') + '\n';
}
const textPath = path.join(here, 'out', 'computer_text.bin');
fs.writeFileSync(textPath, Buffer.from(text));
const native = execFileSync(exe('chances'), [path.join(here, 'models', 'subleq_computer.tlm2'), textPath], { encoding: 'latin1', maxBuffer: 1 << 30 });
if (native !== bits(model)) fails.push('the playground\'s engine and out/chances differ on the computer');
// control: the same comparison against a model with one gain changed in its last bit must fail
const changed = new Uint8Array(shipped);
const dv = new DataView(changed.buffer);
// the last norm's gain of channel 24, a nibble's bit 0: it moves a byte against its runner-up one bit off
// (a type's gain would not do: it moves every byte of that type alike, and the others' chances are 0)
const at = changed.length - model.DIM * 4 + 4 * 24;
dv.setFloat32(at, dv.getFloat32(at, true) * (1 + 1.2e-7), true);
if (bits(S.loadModel(changed)) === native) fails.push('control: a model with one gain changed gave the same bits');

if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
console.log('docs/subleq_computer.js makes models/subleq_computer.tlm2 byte for byte; product c*d in the playground\'s engine right at all ' +
  c.right + ' steps, and every chance at ' + text.length + ' bytes bit for bit as out/chances');
