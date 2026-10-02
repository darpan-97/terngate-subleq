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

// 3. where the heads look (what the playground lights): at each step's deciding byte, the three fetch
// heads (layer 3) must look at the latest statement of mem[pc], mem[pc + 1], mem[pc + 2], and the two read
// heads (layer 4) at that of mem[a] and mem[b] -- a statement's last byte, in the prompt or written since --
// or, for a word nobody has written, at a reading byte (an N3: the default, which reads 0). The engine with
// the watch must give every chance bit for bit as without it.
function looks(mdl, out) {
  const fails = [];
  const prompt = r.prompt, all = prompt.concat(out);
  const looked = [];
  let catching = false;
  const e = S.Engine(mdl, (l, h, w, pos) => {
    if (!catching || (l !== 2 && l !== 3) || (l === 2 && h > 2) || (l === 3 && h > 1)) return;
    let best = 0;
    for (let j = 1; j <= pos; j++) if (w[j] > w[best]) best = j;
    looked.push({ pos, l, h, best, weight: w[best] });
  });
  const plain = S.Engine(mdl);
  let sameBits = true;
  for (let p = 0; p < all.length - 1; p++) {
    catching = (all[p] >> 4) === C.T.N3;
    e.step(all[p], p);
    plain.step(all[p], p);
    for (let v = 0; v < 256; v++) if (!Object.is(e.chances[v], plain.chances[v])) sameBits = false;
  }
  if (!sameBits) fails.push('the engine with a watch did not give every chance as without it');
  // the latest statement of an address before position p: the position of its A2 byte, or -1
  const statementOf = (addr, p) => {
    let found = -1;
    for (let q = 6; q < p; q++) if ((all[q] >> 4) === C.T.A2 && (all[q - 6] >> 4) === C.T.V0) {
      let a = 0; for (let k = 0; k < 3; k++) a |= (all[q - 2 + k] & 15) << (4 * k);
      if (a === addr) found = q;
    }
    return found;
  };
  const ref = S.trace(asm, 400, S.machine(S.KNOWN_GATES));
  const deciding = [];
  for (let p = 0; p < all.length - 1; p++) if ((all[p] >> 4) === C.T.N3) deciding.push(p);
  let heads = 0, wrongLook = 0;
  ref.rows.forEach((row, k) => {
    const pos = deciding[k], at = looked.filter(x => x.pos === pos);
    const want = [row[0], row[0] + 1, row[0] + 2, row[1], row[2] & 65535];
    at.forEach((x, i) => {
      const s = statementOf(want[i], pos);
      const ok = x.weight === 1 && (s >= 0 ? x.best === s : (all[x.best] >> 4) === C.T.N3);
      heads += 1;
      if (!ok && wrongLook++ < 3) fails.push('step ' + (k + 1) + ', ' + ['fetch a', 'fetch b', 'fetch c', 'read a', 'read b'][i] + ': looked at ' + x.best + ' (weight ' + x.weight + '), not ' + (s >= 0 ? s : 'a reading byte'));
    });
    if (at.length !== 5) fails.push('step ' + (k + 1) + ': ' + at.length + ' heads caught, not 5');
  });
  return { fails, heads, wrong: wrongLook };
}
const seen = looks(model, r.out);
fails.push(...seen.fails);
const lookedLine = seen.heads + ' looks of the fetch and read heads, each on the latest statement of its word (or the default), weight 1';
// control: the computer built with address bit 0 not compared when reading mem[a], mem[b] must look elsewhere
{
  const bad = S.loadModel(new Uint8Array(C.build(S, { fault: 'addrbit' }).net.bytes()));
  const badRun = C.run(S, bad, asm, 400);
  if (looks(bad, badRun.out).wrong === 0) fails.push('control: the computer that ignores an address bit was seen looking only where it should');
}

if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
console.log('docs/subleq_computer.js makes models/subleq_computer.tlm2 byte for byte; product c*d in the playground\'s engine right at all ' +
  c.right + ' steps, and every chance at ' + text.length + ' bytes bit for bit as out/chances; ' + lookedLine);
