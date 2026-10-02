// subleq_computer.js -- the hand-built computer (models/subleq_computer.tlm2) made in JavaScript: a
// transformer whose every weight is set by hand, not trained, that runs SUBLEQ itself in the engine the
// trained models run in. subleq/computer_build.nitropz makes it in nitropz; this makes the same file byte
// for byte (subleq/computer_check.js holds the two to that), and runs it in docs/subleq_engine.js.
// build(S) -> { net } (net.bytes(): the file); promptFor, decode, run, compare: its bytes, a program run
// on it, and every step held to S.trace. See subleq/computer_build.nitropz for how it works: the two
// are written alike, function by function, and a change to one is a change to both.
(function (root) {
  'use strict';
  const VOCAB = 256;
  const MAGIC = 843926612;

  function blank(DIM, HEADS, HIDDEN, CONTEXT, BLOCK, LOOPS) {   // every weight 0, every scale 1, gains 1
    const layers = [];
    for (let l = 0; l < BLOCK; l++) {
      layers.push({
        wq: new Int8Array(DIM * DIM), wk: new Int8Array(DIM * DIM), wv: new Int8Array(DIM * DIM), wo: new Int8Array(DIM * DIM),
        w1: new Int8Array(HIDDEN * DIM), w3: new Int8Array(HIDDEN * DIM), w2: new Int8Array(DIM * HIDDEN),
        scales: [1, 1, 1, 1, 1, 1, 1], g1: new Float64Array(DIM).fill(1), g2: new Float64Array(DIM).fill(1),
      });
    }
    return { DIM, HEADS, HIDDEN, CONTEXT, LOOPS: LOOPS || 1, layers, emb: new Int8Array(VOCAB * DIM),
             rowScale: new Float64Array(VOCAB).fill(1), final: new Float64Array(DIM).fill(1) };
  }

  function writeTLM2(spec) {
    const { DIM, HEADS, HIDDEN, CONTEXT, layers } = spec;
    const LOOPS = spec.LOOPS || 1, BLOCK = layers.length;
    if (DIM % HEADS !== 0 || (DIM / HEADS) % 2 !== 0) throw new Error('HEAD = DIM / HEADS must be a whole even number');
    if (BLOCK < 1 || BLOCK > 65535 || LOOPS < 1) throw new Error('bad layer count');
    const trits = BLOCK * (4 * DIM * DIM + 3 * HIDDEN * DIM);
    const tritBytes = Math.floor((Math.floor((trits + 4) / 5) + 3) / 4) * 4;
    const size = 28 + BLOCK * 7 * 8 + tritBytes + VOCAB * 4 + VOCAB * DIM + (2 * BLOCK + 1) * DIM * 4;
    const bytes = new Uint8Array(size);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(0, MAGIC, true);
    dv.setInt32(4, VOCAB, true);
    dv.setInt32(8, DIM, true);
    dv.setInt32(12, LOOPS > 1 ? BLOCK + LOOPS * 65536 : BLOCK, true);
    dv.setInt32(16, HEADS, true);
    dv.setInt32(20, HIDDEN, true);
    dv.setInt32(24, CONTEXT, true);
    let at = 28;
    for (const L of layers) for (let i = 0; i < 7; i++) { dv.setFloat64(at, L.scales[i], true); at += 8; }
    let held = 0, mult = 1, count = 0;
    function digit(w) {                // five digits a byte, the first the lowest
      if (w !== -1 && w !== 0 && w !== 1) throw new Error('a layer weight of ' + w + ', not -1, 0 or 1');
      held += (w + 1) * mult;
      mult *= 3;
      count += 1;
      if (count === 5) { bytes[at] = held; at += 1; held = 0; mult = 1; count = 0; }
    }
    function matrix(w, n) { if (w.length !== n) throw new Error('a matrix of ' + w.length + ', not ' + n); for (let i = 0; i < n; i++) digit(w[i]); }
    const tritsAt = at;
    for (const L of layers) {
      matrix(L.wq, DIM * DIM); matrix(L.wk, DIM * DIM); matrix(L.wv, DIM * DIM); matrix(L.wo, DIM * DIM);
      matrix(L.w1, HIDDEN * DIM); matrix(L.w3, HIDDEN * DIM); matrix(L.w2, DIM * HIDDEN);
    }
    if (count > 0) { bytes[at] = held; at += 1; }
    at = tritsAt + tritBytes;
    for (let v = 0; v < VOCAB; v++) { dv.setFloat32(at, spec.rowScale[v], true); at += 4; }
    for (let i = 0; i < VOCAB * DIM; i++) {
      const e = spec.emb[i];
      if (e !== Math.trunc(e) || e < -127 || e > 127) throw new Error('an embedding number of ' + e);
      dv.setInt8(at, e); at += 1;
    }
    for (const L of layers) {
      for (let i = 0; i < DIM; i++) { dv.setFloat32(at, L.g1[i], true); at += 4; }
      for (let i = 0; i < DIM; i++) { dv.setFloat32(at, L.g2[i], true); at += 4; }
    }
    for (let i = 0; i < DIM; i++) { dv.setFloat32(at, spec.final[i], true); at += 4; }
    if (at !== size) throw new Error('wrote ' + at + ' of ' + size + ' bytes');
    return bytes;
  }


  const BANKV = [1, 2, 4, 8, 16, 32, 64];
  const TINY = 1e-6;

  function bankTerms(n) {              // n (0..254) as the anchor and bank channels: [[channel, +-1]]
    const out = [];
    let r = Math.abs(n), sign = n < 0 ? -1 : 1;
    if (r > 254) throw new Error('constant ' + n + ' too large');
    if (r >= 127) { out.push([0, sign]); r -= 127; }
    for (let i = 6; i >= 0; i--) if (r >= BANKV[i]) { out.push([1 + i, sign]); r -= BANKV[i]; }
    if (r !== 0) throw new Error('bank cannot make ' + n);
    return out;
  }

  class Net {
    constructor(S, { DIM, HEADS, HIDDEN, CONTEXT, LAYERS }) {
      this.S = S;
      this.m = blank(DIM, HEADS, HIDDEN, CONTEXT, LAYERS, 1);
      Object.assign(this, { DIM, HEADS, HIDDEN, CONTEXT, LAYERS, HEAD: DIM / HEADS, PAIRS: DIM / HEADS / 2 });
      this.names = new Map();          // channel name -> index
      this.unit = new Float64Array(DIM);   // raw size of one whole unit, per channel (0: unknown yet)
      this.maxAbs = new Float64Array(DIM); // the largest |whole number| a channel can hold
      this.next = 0;
      this.chan('anchor', 1, 127);
      this.chan('bank', 7, 64);
      this.hiddenNext = new Array(LAYERS).fill(1);  // hidden unit 0 of every layer is the hidden anchor
      this.headVals = [];              // per layer, per head: value slots used (slot 0 of head 0: the anchor)
      for (let l = 0; l < LAYERS; l++) {
        this.headVals.push(new Array(HEADS).fill(0));
        const L = this.m.layers[l];
        // the hidden anchor: gate 127, up 1 (bank channel 1): every unit then rounds to exactly
        // relu(gate) * up while that is at most 127
        L.w1[0 * DIM + 0] = 1; L.w3[0 * DIM + 1] = 1;
        // head 0 copies the anchor into its value slot 0
        L.wv[0 * DIM + 0] = 1;
        this.headVals[l][0] = 1;
      }
      for (let v = 0; v < 256; v++) {
        this.m.rowScale[v] = 1 / 127;
        this.m.emb[v * DIM + 0] = 127;
        for (let i = 0; i < 7; i++) this.m.emb[v * DIM + 1 + i] = BANKV[i];
      }
      this.final = [];                 // channels the readout uses
    }

    chan(name, n, maxAbs) {            // allocate n residual channels; returns the first index
      if (this.names.has(name)) throw new Error('channel ' + name + ' twice');
      if (this.next + n > this.DIM) throw new Error('out of channels at ' + name + ' (' + this.next + ' + ' + n + ' > ' + this.DIM + ')');
      const at = this.next;
      this.names.set(name, at);
      for (let i = 0; i < n; i++) this.maxAbs[at + i] = maxAbs;
      this.next += n;
      return at;
    }
    c(name, i) { const at = this.names.get(name); if (at === undefined) throw new Error('no channel ' + name); return at + (i || 0); }
    hidden(l, n) {
      const at = this.hiddenNext[l];
      if (at + n > this.HIDDEN) throw new Error('out of hidden units in layer ' + l);
      this.hiddenNext[l] += n;
      return at;
    }

    // the embedding: f(v) -> [[channel, whole number]] (anchor and bank are already there); every row
    // must have the same sum of squares
    embed(f) {
      let ss0 = null;
      for (let v = 0; v < 256; v++) {
        for (const [ch, val] of f(v)) {
          if (Math.abs(val) > 127 || val !== Math.trunc(val)) throw new Error('embedding value ' + val);
          if (Math.abs(val) > this.maxAbs[ch]) throw new Error('embedding value ' + val + ' over channel ' + ch + "'s range");
          this.m.emb[v * this.DIM + ch] = val;
        }
        let ss = 0;
        for (let i = 0; i < this.DIM; i++) ss += this.m.emb[v * this.DIM + i] ** 2;
        if (ss0 === null) ss0 = ss; else if (ss !== ss0) throw new Error('byte ' + v + ': sum of squares ' + ss + ', not ' + ss0);
      }
      for (let i = 0; i < this.DIM; i++) {
        let used = false;
        for (let v = 0; v < 256; v++) if (this.m.emb[v * this.DIM + i] !== 0) used = true;
        if (used) this.unit[i] = 1 / 127;   // the row scale; the anchor's 127 is then ~1.0
      }
      // s: every read's rounding scale, 127 / (the anchor after the norm), the same at every byte and
      // layer (everything written is TINY): worked out as the engine works it, on byte 0's row
      const rs = Math.fround(1 / 127);
      let ss = 0.0;
      for (let i = 0; i < this.DIM; i++) { const x = this.m.emb[i] * rs; ss = ss + x * x; }
      const inv = this.S.fastRsqrt(ss / this.DIM + 0.00001);
      this.s = 127.0 / (this.m.emb[0] * rs * inv * 1.0);
    }

    // reads: the norm gain that makes channel ch (one whole unit = unit[ch] raw) round to mult per unit
    read(l, which, ch, mult) {
      if (!this.unit[ch]) throw new Error('channel ' + ch + ' read in layer ' + l + ' before anything writes it');
      if (this.maxAbs[ch] * Math.abs(mult) > 127) throw new Error('channel ' + ch + ' read x' + mult + ' could pass the anchor');
      const g = Math.fround(mult * this.unit[0] / this.unit[ch]);
      const L = this.m.layers[l];
      const gains = which === 'attn' ? L.g1 : L.g2;
      if (gains[ch] !== 1 && gains[ch] !== g) throw new Error('channel ' + ch + ' read twice in one place, x' + mult);
      gains[ch] = g;
    }

    // a row of a matrix: terms [[channel, +-1]] plus a constant (whole number, through anchor and bank)
    setRow(w, K, row, terms, constant) {
      for (const [ch, t] of terms) { if (t !== 1 && t !== -1) throw new Error('weight ' + t); if (w[row * K + ch] !== 0) throw new Error('weight set twice'); w[row * K + ch] = t; }
      if (constant) for (const [ch, t] of bankTerms(constant)) { if (w[row * K + ch] !== 0) throw new Error('constant over a used weight'); w[row * K + ch] = t; }
    }

    // ---- attention ----
    // head h of layer l attends to exactly `offset` positions back, by RoPE alone: each pair's query at
    // angle 0 (the anchor), its key at the angle `offset` steps turn (whole numbers from the bank)
    posHead(l, h, offset) {
      const L = this.m.layers[l], D = this.DIM;
      for (let j = 0; j < this.PAIRS; j++) {
        // (the engine's own fpow, fcos, fsin -- nitropz's mathf -- so a port makes the same whole numbers)
        const at = h * this.HEAD + 2 * j, th = offset / this.S.fpow(10000.0, (2 * j) / this.HEAD);
        L.wq[at * D + 0] = 1;
        this.setRow(L.wk, D, at, [], Math.floor(127 * this.S.fcos(th) + 0.5));
        this.setRow(L.wk, D, at + 1, [], Math.floor(127 * this.S.fsin(th) + 0.5));
      }
      (this.pos = this.pos || []).push({ l, h, offset });
    }
    // head h's value slot <- channel src; returns the attention output index
    value(l, h, src) {
      const slot = this.headVals[l][h]++;
      if (slot >= this.HEAD) throw new Error('head ' + h + ' of layer ' + l + ' has no value slot left');
      const at = h * this.HEAD + slot;
      this.m.layers[l].wv[at * this.DIM + src] = 1;
      return at;
    }
    // residual channel dst <- attention output index at (whole units, then scaled to TINY by calibrate)
    fromAtt(l, at, dst, sign) { this.m.layers[l].wo[dst * this.DIM + at] = sign || 1; }

    // the smallest score gap of every positional head over the whole view, before scales (q, k from the
    // constant channels only), and the q/k scale that makes it `want` after the 1/sqrt(HEAD)
    sizePositional(l, want) {
      const lm = this.load(), L = this.m.layers[l], D = this.DIM, P = this.PAIRS;
      const row = new Array(D).fill(0);
      row[0] = 127; for (let i = 0; i < 7; i++) row[1 + i] = BANKV[i];
      let worst = Infinity;
      for (const { l: ll, h, offset } of this.pos.filter(p => p.l === l)) {
        const qv = new Float64Array(this.HEAD), kv = new Float64Array(this.HEAD);
        for (let o = 0; o < this.HEAD; o++) {
          let a = 0, b = 0;
          for (let i = 0; i < D; i++) { a += L.wq[(h * this.HEAD + o) * D + i] * row[i]; b += L.wk[(h * this.HEAD + o) * D + i] * row[i]; }
          qv[o] = a; kv[o] = b;
        }
        const score = d => { let t = 0; for (let j = 0; j < P; j++) { const c = lm.cos[d * P + j], s = lm.sin[d * P + j];
          t += (qv[2 * j] * c - qv[2 * j + 1] * s) * kv[2 * j] + (qv[2 * j] * s + qv[2 * j + 1] * c) * kv[2 * j + 1]; } return t; };
        const at = score(offset);
        for (let d = 0; d < this.CONTEXT; d++) if (d !== offset) worst = Math.min(worst, at - score(d));
      }
      if (!(worst > 0)) throw new Error('a positional head in layer ' + l + ' does not peak where it should');
      // q = whole number * scale / s
      const unit = 1.0 / this.s;
      const sq = Math.sqrt(want / (worst * unit * unit / Math.sqrt(this.HEAD)));
      L.scales[0] = L.scales[1] = sq;
      return worst;
    }

    // ---- feed-forward ----
    // one unit in layer l: relu(gate) * up, both whole numbers, |relu(gate) * up| <= 127: gate = terms +
    // constant, up = terms + constant (up 1 by default: a plain relu); outs: [[channel, +-1]]
    ff(l, gateTerms, gateConst, outs, upTerms, upConst) {
      const k = this.hidden(l, 1), L = this.m.layers[l], D = this.DIM, H = this.HIDDEN;
      this.setRow(L.w1, D, k, gateTerms, gateConst);
      if (upTerms === undefined) this.setRow(L.w3, D, k, [], 1);
      else this.setRow(L.w3, D, k, upTerms, upConst);
      for (const [ch, t] of outs) { if (L.w2[ch * H + k] !== 0) throw new Error('down weight twice'); L.w2[ch * H + k] = t; }
      return k;
    }

    // ---- units of written channels ----
    // what layer l's attention ('attn') or feed-forward ('ffn') writes, made TINY raw a whole unit (every
    // channel a sublayer writes shares its scale). Worked out, not measured:
    //   attention: the output row rounds against the anchor's copy (127 * v / s), so a copied channel
    //     read x m comes back as m a unit, and adds (whole) * o * v / s: o = TINY * s / (v * m);
    //   feed-forward: a unit rounds to exactly relu(gate) * up (the hidden anchor is 127 * 1), and adds
    //     (whole) * down * gate * up / s^2: down = TINY * s^2 / (gate * up).
    calibrate(l, which, perUnit, written) {
      const L = this.m.layers[l];
      if (which === 'attn') L.scales[3] = TINY * this.s / (L.scales[2] * perUnit);
      else {
        if (L.scales[4] === 1) L.scales[4] = 1e6;   // gates far past 60: SiLU exactly ReLU
        L.scales[6] = TINY * this.s * this.s / (L.scales[4] * L.scales[5]);
      }
      for (const c of written) this.unit[c] = TINY;
    }

    // the model as it stands, loaded
    load() { return this.S.loadModel(writeTLM2(this.m)); }
    bytes() { return writeTLM2(this.m); }
  }


  const T = { V0: 1, V1: 2, V2: 3, V3: 4, A0: 5, A1: 6, A2: 7, N0: 8, N1: 9, N2: 10, N3: 11, P0: 12, P1: 13, STOP: 14, END: 15 };
  const TYPE_NAMES = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));
  const byte = (type, nib) => 16 * type + (nib & 15);

  function wordBytes(value, address) {   // a statement: value's nibbles, then the address's
    const out = [];
    for (let k = 0; k < 4; k++) out.push(byte(T.V0 + k, value >> (4 * k)));
    for (let k = 0; k < 3; k++) out.push(byte(T.A0 + k, address >> (4 * k)));
    return out;
  }
  function pcBytes(pc) { const out = []; for (let k = 0; k < 4; k++) out.push(byte(T.N0 + k, pc >> (4 * k))); return out; }

  function promptFor(asm) {           // every word that is not 0 (a word nobody states reads as 0), then pc 0
    const out = [];
    for (let i = 0; i < asm.mem.length; i++) if ((asm.mem[i] & 65535) !== 0) out.push(...wordBytes(asm.mem[i] & 65535, i));
    out.push(...pcBytes(0));
    return out;
  }

  // the generated bytes read back as steps: [{ b, after, next } | { printed, next } | 'STOP' | 'END']
  function decode(bytes) {
    const steps = [];
    let i = 0;
    const nib = (at, type) => (bytes[at] >> 4) === type ? bytes[at] & 15 : null;
    while (i < bytes.length) {
      const t = bytes[i] >> 4;
      if (t === T.STOP || t === T.END) {        // (their nibble is always 0)
        if ((bytes[i] & 15) !== 0) return { steps, bad: i };
        steps.push(t === T.STOP ? 'STOP' : 'END');
        break;
      }
      if (t === T.V0) {
        if (i + 11 > bytes.length) break;
        let after = 0, b = 0, next = 0;
        for (let k = 0; k < 4; k++) { const n = nib(i + k, T.V0 + k); if (n === null) return { steps, bad: i + k }; after |= n << (4 * k); }
        for (let k = 0; k < 3; k++) { const n = nib(i + 4 + k, T.A0 + k); if (n === null) return { steps, bad: i + 4 + k }; b |= n << (4 * k); }
        for (let k = 0; k < 4; k++) { const n = nib(i + 7 + k, T.N0 + k); if (n === null) return { steps, bad: i + 7 + k }; next |= n << (4 * k); }
        steps.push({ b, after, next });
        i += 11;
      } else if (t === T.P0) {
        if (i + 6 > bytes.length) break;
        let printed = 0, next = 0;
        for (let k = 0; k < 2; k++) { const n = nib(i + k, T.P0 + k); if (n === null) return { steps, bad: i + k }; printed |= n << (4 * k); }
        for (let k = 0; k < 4; k++) { const n = nib(i + 2 + k, T.N0 + k); if (n === null) return { steps, bad: i + 2 + k }; next |= n << (4 * k); }
        steps.push({ printed, next });
        i += 6;
      } else return { steps, bad: i };
    }
    return { steps, bad: -1 };
  }

  // ---------------------------------------------------------------------------------------------------
  function build(S, opts) {
    const o = Object.assign({ CONTEXT: 2048, HEAD: 128, HEADS: 3, HIDDEN: 128, RHO: 16, fault: null }, opts || {});
    const net = new Net(S, { DIM: o.HEAD * o.HEADS, HEADS: o.HEADS, HIDDEN: o.HIDDEN, CONTEXT: o.CONTEXT, LAYERS: 9 });
    const D = net.DIM;
    const TYPE = net.chan('type', 15, 1), DUMMY = net.chan('dummy', 1, 1), NIB = net.chan('nib', 4, 1);
    net.embed(v => {
      const t = v >> 4, n = v & 15, out = [];
      out.push(t === 0 ? [DUMMY, 1] : [TYPE + t - 1, 1]);
      for (let j = 0; j < 4; j++) out.push([NIB + j, (n >> j) & 1 ? 1 : -1]);
      return out;
    });
    const isType = t => TYPE + t - 1;

    // ---------- layer 1 (0): heads 1..3 back; pc + 1, pc + 2, pc >= 510 ----------
    const G = [];
    for (let d = 1; d <= 6; d++) G[d] = net.chan('g' + d, 4, 1);
    for (let d = 1; d <= 3; d++) {
      net.posHead(0, d - 1, d);
      for (let j = 0; j < 4; j++) net.fromAtt(0, net.value(0, d - 1, NIB + j), G[d] + j);
    }
    net.sizePositional(0, 4000);
    net.calibrate(0, 'attn', 1, Array.from({ length: 12 }, (_, i) => G[1] + i));
    // pc's bits at an N3: N0 = 3 back, N1 = 2, N2 = 1, N3 = the byte itself
    const pcBit = i => (i < 4 ? G[3] : i < 8 ? G[2] : i < 12 ? G[1] : NIB) + (i & 3);
    for (let i = 0; i < 16; i++) net.read(0, 'ffn', pcBit(i), 1);
    const P1 = net.chan('p1', 16, 1), PC2 = net.chan('pc2', 9, 1), HI2 = net.chan('hi2', 1, 2), LO2 = net.chan('lo2', 1, 2);
    // increment (+-1 bits): out_i = s_i + 2c_i - 4 AND(0..i), c_i = AND(0..i-1); bits from `from`
    function increment(l, bitOf, from, n, dst) {
      for (let i = 0; i < n; i++) {
        if (i < from) { net.ff(l, [], 1, [[dst + i, 1]], [[bitOf(i), 1]]); continue; }   // unchanged
        if (i === from) { net.ff(l, [], 1, [[dst + i, -1]], [[bitOf(i), 1]]); continue; } // flipped
        net.ff(l, [], 1, [[dst + i, 1]], [[bitOf(i), 1]]);
        const below = []; for (let j = from; j < i; j++) below.push([bitOf(j), 1]);
        net.ff(l, below, -(i - from) + 2, [[dst + i, 1]]);                              // 2 c_i
        net.ff(l, below.concat([[bitOf(i), 1]]), -(i - from + 1) + 2, [[dst + i, -1]], [], 2);   // 4 AND(..i)
      }
    }
    increment(0, pcBit, 0, 16, P1);
    increment(0, pcBit, 1, 9, PC2);
    { // pc >= 510 below 32768: bits 9..14 any (HI), or bits 1..8 all (LO); each 0 or 2
      const hi = []; for (let i = 9; i <= 14; i++) hi.push([pcBit(i), 1]);
      net.ff(0, hi, 6, [[HI2, 1]]); net.ff(0, hi, 4, [[HI2, -1]]);
      const lo = []; for (let i = 1; i <= 8; i++) lo.push([pcBit(i), 1]);
      net.ff(0, lo, -6, [[LO2, 1]]);
    }
    net.calibrate(0, 'ffn', 1, [...range(P1, 16), ...range(PC2, 9), HI2, LO2]);

    // ---------- layer 2 (1): heads 4..6 back; the words' keys and values; pc + 3 ----------
    for (let d = 4; d <= 6; d++) {
      net.posHead(1, d - 4, d);
      for (let j = 0; j < 4; j++) net.fromAtt(1, net.value(1, d - 4, NIB + j), G[d] + j);
    }
    net.sizePositional(1, 4000);
    net.calibrate(1, 'attn', 1, Array.from({ length: 12 }, (_, i) => G[4] + i));
    const KC = net.chan('kc', 9, 1), WV = net.chan('wv', 16, 1), PC3 = net.chan('pc3', 16, 1), BIG = net.chan('big', 1, 1);
    const addrBit = i => (i < 4 ? G[2] + i : i < 8 ? G[1] + (i - 4) : NIB + 0);
    const valBit = i => G[6 - (i >> 2)] + (i & 3);
    net.read(1, 'ffn', isType(T.A2), 1);
    for (let i = 0; i < 9; i++) net.read(1, 'ffn', addrBit(i), 1);
    for (let i = 0; i < 16; i++) net.read(1, 'ffn', valBit(i), 1);
    for (let i = 0; i < 9; i++) net.ff(1, [[isType(T.A2), 1]], 0, [[KC + i, 1]], [[addrBit(i), 1]]);
    for (let i = 0; i < 16; i++) net.ff(1, [[isType(T.A2), 1]], 0, [[WV + i, 1]], [[valBit(i), 1]]);
    // at every N3 the value is the word 0 (every bit -1): what a read finds when no statement of its
    // address exists (its own key, the default, then wins: see contentHead)
    net.read(1, 'ffn', isType(T.N3), 1);
    if (o.fault !== 'nodefault') for (let i = 0; i < 16; i++) net.ff(1, [[isType(T.N3), 1]], 0, [[WV + i, -1]]);
    for (let i = 0; i < 16; i++) net.read(1, 'ffn', P1 + i, 1);
    increment(1, i => P1 + i, 1, 16, PC3);
    net.read(1, 'ffn', HI2, 0.5); net.read(1, 'ffn', LO2, 0.5);
    net.ff(1, [[HI2, 1], [LO2, 1]], 0, [[BIG, 1]]); net.ff(1, [[HI2, 1], [LO2, 1]], -1, [[BIG, -1]]);   // [hi + lo >= 1]
    net.calibrate(1, 'ffn', 1, [...range(KC, 9), ...range(WV, 16), ...range(PC3, 16), BIG]);

    // ---------- content reads: the head's slowest pairs hold the address bits, the next one recency ----------
    const P = net.PAIRS, codePair = i => P - 9 + i, RECENCY = P - 10;
    function contentHead(l, h, queryBit, valueOf, dst) {
      const L = net.m.layers[l];
      for (let i = 0; i < 9; i++) {
        const at = h * net.HEAD + 2 * codePair(i);
        if (o.fault === 'addrbit' && l === 3 && i === 0) continue;          // a control: address bit 0 not compared
        L.wq[at * D + queryBit(i)] = 1;
        L.wk[at * D + KC + i] = 1;
      }
      // the default: 8 more pairs, query 119 (from the bank), key 127 at an N3 (0 elsewhere) -- at the
      // reader itself 8 x 119 x 127 = 7.5 bit-units of 127 x 127: below any real statement of the address
      // (9 near, ~8.0 at the far end of a 2048 view), above any statement one bit off (<= 7)
      if (o.fault !== 'nodefault') for (let s = 0; s < 8; s++) {
        const sp = h * net.HEAD + 2 * (P - 18 + s);
        net.setRow(L.wq, D, sp, [], 119);
        L.wk[sp * D + isType(T.N3)] = 1;
      }
      const at = h * net.HEAD + 2 * RECENCY;
      net.setRow(L.wq, D, at + 1, [], o.RHO);
      net.setRow(L.wk, D, at, [], o.RHO);
      for (let j = 0; j < 16; j++) net.fromAtt(l, net.value(l, h, valueOf(j)), dst + j);
    }
    function sizeContent(l) {          // one position of recency worth 1000 (after the 1/sqrt(HEAD))
      const unit = 1.0 / net.s;
      const tr = 1 / S.fpow(10000.0, (2 * RECENCY) / net.HEAD);
      const sq = Math.sqrt(1000 * Math.sqrt(net.HEAD) / (o.RHO * o.RHO * tr * unit * unit));
      net.m.layers[l].scales[0] = net.m.layers[l].scales[1] = sq;
    }

    // ---------- layer 3 (2): fetch mem[pc], mem[pc + 1], mem[pc + 2] ----------
    const MA = net.chan('ma', 16, 1), MB = net.chan('mb', 16, 1), MC = net.chan('mc', 16, 1);
    for (let i = 0; i < 9; i++) { net.read(2, 'attn', pcBit(i), 127); net.read(2, 'attn', P1 + i, 127); net.read(2, 'attn', PC2 + i, 127); net.read(2, 'attn', KC + i, 127); }
    net.read(2, 'attn', isType(T.N3), 127);
    for (let j = 0; j < 16; j++) net.read(2, 'attn', WV + j, 127);
    contentHead(2, 0, pcBit, j => WV + j, MA);
    contentHead(2, 1, i => P1 + i, j => WV + j, MB);
    contentHead(2, 2, i => PC2 + i, j => WV + j, MC);
    sizeContent(2);
    net.calibrate(2, 'attn', 127, [...range(MA, 16), ...range(MB, 16), ...range(MC, 16)]);
    // feed-forward: print (b = 65535), a >= 512, b >= 512 and not a print, pc >= 32768; each 0 or 2
    const PRN2 = net.chan('prn2', 1, 2), FA2 = net.chan('fa2', 1, 2), FB2 = net.chan('fb2', 1, 2), STOP2 = net.chan('stop2', 1, 2);
    for (let j = 0; j < 16; j++) { net.read(2, 'ffn', MA + j, 1); net.read(2, 'ffn', MB + j, 1); }
    net.read(2, 'ffn', NIB + 3, 1);
    { const all = range(MB, 16).map(c => [c, 1]);
      net.ff(2, all, -14, [[PRN2, 1], [FB2, -1]]);
      const ha = []; for (let j = 9; j < 16; j++) ha.push([MA + j, 1]);
      net.ff(2, ha, 7, [[FA2, 1]]); net.ff(2, ha, 5, [[FA2, -1]]);
      const hb = []; for (let j = 9; j < 16; j++) hb.push([MB + j, 1]);
      net.ff(2, hb, 7, [[FB2, 1]]); net.ff(2, hb, 5, [[FB2, -1]]);
      net.ff(2, [[NIB + 3, 1]], 1, [[STOP2, 1]]); }
    net.calibrate(2, 'ffn', 1, [PRN2, FA2, FB2, STOP2]);

    // ---------- layer 4 (3): read mem[a], mem[b]; nibble compare ----------
    const X = net.chan('x', 16, 1), Y = net.chan('y', 16, 1);
    for (let i = 0; i < 9; i++) { net.read(3, 'attn', MA + i, 127); net.read(3, 'attn', MB + i, 127); net.read(3, 'attn', KC + i, 127); }
    net.read(3, 'attn', isType(T.N3), 127);
    for (let j = 0; j < 16; j++) net.read(3, 'attn', WV + j, 127);
    contentHead(3, 0, i => MA + i, j => WV + j, X);
    contentHead(3, 1, i => MB + i, j => WV + j, Y);
    sizeContent(3);
    net.calibrate(3, 'attn', 127, [...range(X, 16), ...range(Y, 16)]);
    const xb = (k, j) => X + 4 * k + j, yb = (k, j) => Y + 4 * k + j;
    const GT = net.chan('gt', 4, 2), EQ = net.chan('eq', 4, 2);
    for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) { net.read(3, 'ffn', xb(k, j), 1 << j); net.read(3, 'ffn', yb(k, j), 1 << j); }
    const one3 = net.ff(3, [], 2, []);
    for (let k = 0; k < 4; k++) {
      const z = []; for (let j = 0; j < 4; j++) z.push([yb(k, j), 1], [xb(k, j), -1]);
      const nz = z.map(([c, t]) => [c, -t]);
      net.ff(3, z, 0, [[GT + k, 1], [EQ + k, -1]]); net.ff(3, z, -2, [[GT + k, -1], [EQ + k, 1]]);
      net.ff(3, nz, 0, [[EQ + k, -1]]); net.ff(3, nz, -2, [[EQ + k, 1]]);
      net.m.layers[3].w2[(EQ + k) * net.HIDDEN + one3] = 1;
    }
    net.calibrate(3, 'ffn', 1, [...range(GT, 4), ...range(EQ, 4)]);

    // ---------- layer 5 (4): the carry into each nibble ----------
    const CIN = net.chan('cin', 4, 1);
    for (let k = 0; k < 4; k++) { net.read(4, 'ffn', GT + k, 0.5); net.read(4, 'ffn', EQ + k, 0.5); }
    const and5 = (terms, outs) => net.ff(4, terms.map(c => [c, 1]), -(terms.length - 1), outs);
    and5([GT + 0], [[CIN + 1, 1]]); and5([EQ + 0], [[CIN + 1, 1]]);
    and5([GT + 1], [[CIN + 2, 1]]); and5([EQ + 1, GT + 0], [[CIN + 2, 1]]); and5([EQ + 1, EQ + 0], [[CIN + 2, 1]]);
    and5([GT + 2], [[CIN + 3, 1]]); and5([EQ + 2, GT + 1], [[CIN + 3, 1]]); and5([EQ + 2, EQ + 1, GT + 0], [[CIN + 3, 1]]);
    and5([EQ + 2, EQ + 1, EQ + 0], [[CIN + 3, 1]]);
    net.calibrate(4, 'ffn', 1, range(CIN, 4));

    // ---------- layer 6 (5): the carry into each bit (0 or 2) ----------
    const C = net.chan('c', 16, 2);
    for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) { net.read(5, 'ffn', xb(k, j), 1 << j); net.read(5, 'ffn', yb(k, j), 1 << j); }
    for (let k = 1; k < 4; k++) net.read(5, 'ffn', CIN + k, 2);
    for (let k = 0; k < 4; k++) for (let m = 0; m < 4; m++) {
      const i = 4 * k + m, cinT = k === 0 ? [] : [[CIN + k, 1]], cinC = k === 0 ? 2 : 0;
      if (m === 0) { net.ff(5, cinT, cinC, [[C + i, 1]]); continue; }
      const z = []; for (let j = 0; j < m; j++) z.push([yb(k, j), 1], [xb(k, j), -1]);
      net.ff(5, z.concat(cinT), cinC, [[C + i, 1]]);
      net.ff(5, z.concat(cinT), cinC - 2, [[C + i, -1]]);
    }
    net.calibrate(5, 'ffn', 1, range(C, 16));

    // ---------- layer 7 (6): the bits of mem[b] - mem[a] (+-1) ----------
    const R = net.chan('r', 16, 1);
    for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) { net.read(6, 'ffn', xb(k, j), 1); net.read(6, 'ffn', yb(k, j), 1); }
    for (let i = 0; i < 16; i++) net.read(6, 'ffn', C + i, 1);
    const one7 = net.ff(6, [], 1, []);
    for (let i = 0; i < 16; i++) {
      const z = [[Y + i, 1], [X + i, -1], [C + i, 1]];
      net.ff(6, z, 2, [[R + i, 1]]);
      net.ff(6, z, 0, [[R + i, -1]], [], 2);
      net.ff(6, z, -2, [[R + i, 1]], [], 2);
      net.m.layers[6].w2[(R + i) * net.HIDDEN + one7] = -1;
    }
    if (o.fault === 'carry') { const w2 = net.m.layers[5].w2; let k = 0; while (w2[(C + 5) * net.HIDDEN + k] === 0) k++; w2[(C + 5) * net.HIDDEN + k] *= -1; }
    net.calibrate(6, 'ffn', 1, range(R, 16));

    // ---------- layer 8 (7): 0 or less, the next pc (+-2), what comes next (0 or 1 each) ----------
    const NEXT = net.chan('next', 16, 2), M_NORMAL = net.chan('mnormal', 1, 1), M_PRINT = net.chan('mprint', 1, 1),
          M_STOP = net.chan('mstop', 1, 1), M_END = net.chan('mend', 1, 1);
    for (let i = 0; i < 16; i++) { net.read(7, 'ffn', R + i, 1); net.read(7, 'ffn', MC + i, 1); net.read(7, 'ffn', PC3 + i, 1); }
    net.read(7, 'ffn', PRN2, 1); net.read(7, 'ffn', FA2, 1); net.read(7, 'ffn', FB2, 1); net.read(7, 'ffn', STOP2, 3); net.read(7, 'ffn', BIG, 2);
    const sumR = range(R, 16).map(c => [c, -1]);
    for (let i = 0; i < 16; i++) {
      const diff = [[MC + i, 1], [PC3 + i, -1]];
      net.ff(7, [], 2, [[NEXT + i, 1]], [[PC3 + i, 1]]);                      // 2 (pc + 3)
      net.ff(7, [[R + 15, 1], [PRN2, -1]], 1, [[NEXT + i, 1]], diff);        // negative: + (c - (pc + 3))
      net.ff(7, sumR.concat([[PRN2, -1]]), -14, [[NEXT + i, 1]], diff);      // zero: likewise
    }
    { // modes: STOP if pc >= 32768; END if not and (pc >= 510, a >= 512, b >= 512); PRINT if not those and
      // b = 65535; NORMAL otherwise. STOP2 is read x3 (0 or 6), BIG x2 (0 or 2), the 0-or-2 flags x1.
      net.ff(7, [[STOP2, 1]], 0, [[M_STOP, 1], [M_NORMAL, -1]]);               // [z >= 1] = relu(z) - relu(z - 1)
      net.ff(7, [[STOP2, 1]], -1, [[M_STOP, -1], [M_NORMAL, 1]]);
      const endZ = [[BIG, 1], [FA2, 1], [FB2, 1], [STOP2, -1]];                // 2 BIG + FA2 + FB2 - 6 STOP
      net.ff(7, endZ, -1, [[M_END, 1], [M_NORMAL, -1]]);                       // [z >= 2] = relu(z - 1) - relu(z - 2)
      net.ff(7, endZ, -2, [[M_END, -1], [M_NORMAL, 1]]);
      const prZ = [[PRN2, 1], [BIG, -1], [FA2, -1], [STOP2, -1]];              // PRN2 - 2 BIG - FA2 - 6 STOP
      net.ff(7, prZ, -1, [[M_PRINT, 1], [M_NORMAL, -1]]);
      net.ff(7, prZ, -2, [[M_PRINT, -1], [M_NORMAL, 1]]);
      net.ff(7, [], 1, [[M_NORMAL, 1]]);
    }
    net.calibrate(7, 'ffn', 1, [...range(NEXT, 16), M_NORMAL, M_PRINT, M_STOP, M_END]);

    // ---------- layer 9 (8): every byte copies from the latest N3, then writes the byte after its own ----------
    const cR = net.chan('cr', 16, 1), cB = net.chan('cb', 9, 1), cN = net.chan('cn', 16, 1), cP = net.chan('cp', 8, 1), cM = net.chan('cm', 4, 1);
    { const L = net.m.layers[8], at = 0 * net.HEAD + 2 * (P - 1);           // the slowest pair: is it an N3
      net.read(8, 'attn', isType(T.N3), 127);
      net.setRow(L.wq, D, at, [], 127);
      L.wk[at * D + isType(T.N3)] = 1;
      const ra = 0 * net.HEAD + 2 * RECENCY;
      net.setRow(L.wq, D, ra + 1, [], o.RHO); net.setRow(L.wk, D, ra, [], o.RHO);
      for (let i = 0; i < 16; i++) { net.read(8, 'attn', R + i, 127); net.fromAtt(8, net.value(8, 0, R + i), cR + i); }
      for (let i = 0; i < 9; i++) { net.read(8, 'attn', MB + i, 127); net.fromAtt(8, net.value(8, 0, MB + i), cB + i); }
      for (let i = 0; i < 16; i++) { net.read(8, 'attn', NEXT + i, 63.5); net.fromAtt(8, net.value(8, 0, NEXT + i), cN + i); }
      for (let i = 0; i < 8; i++) { net.read(8, 'attn', X + i, 127); net.fromAtt(8, net.value(8, 0, X + i), cP + i); }
      [M_NORMAL, M_PRINT, M_STOP, M_END].forEach((ch, i) => { net.read(8, 'attn', ch, 127); net.fromAtt(8, net.value(8, 0, ch), cM + i); });
      sizeContent(8);
      net.calibrate(8, 'attn', 127, [...range(cR, 16), ...range(cB, 9), ...range(cN, 16), ...range(cP, 8), ...range(cM, 4)]); }
    // the byte after each type: [next type, its nibble's 4 source channels (+-127 units), or null: nibble 0]
    const after = {
      [T.V0]: [T.V1, range(cR + 4, 4)], [T.V1]: [T.V2, range(cR + 8, 4)], [T.V2]: [T.V3, range(cR + 12, 4)],
      [T.V3]: [T.A0, range(cB, 4)], [T.A0]: [T.A1, range(cB + 4, 4)], [T.A1]: [T.A2, [cB + 8, null, null, null]],
      [T.A2]: [T.N0, range(cN, 4)], [T.N0]: [T.N1, range(cN + 4, 4)], [T.N1]: [T.N2, range(cN + 8, 4)], [T.N2]: [T.N3, range(cN + 12, 4)],
      [T.P0]: [T.P1, range(cP + 4, 4)], [T.P1]: [T.N0, range(cN, 4)],
      [T.STOP]: [T.STOP, [null, null, null, null]], [T.END]: [T.END, [null, null, null, null]],
    };
    for (let t = 1; t <= 15; t++) net.read(8, 'ffn', isType(t), 1);
    for (const ch of [...range(cR, 16), ...range(cB, 9), ...range(cN, 16), ...range(cP, 8), ...range(cM, 4)]) net.read(8, 'ffn', ch, 1);
    const emit = (gate, gateConst, nt, srcs) => {   // under gate: type nt, nibble bits from srcs (null: -1)
      net.ff(8, gate, gateConst, [[isType(nt), 1]], [], 100);
      srcs.forEach((s, j) => {
        if (s === null) net.ff(8, gate, gateConst, [[NIB + j, -1]], [], 1);
        else net.ff(8, gate, gateConst, [[NIB + j, 1]], [[s, 1]]);
      });
    };
    for (const [t, [nt, srcs]] of Object.entries(after)) emit([[isType(+t), 1]], 0, nt, srcs);
    // after an N3, by the mode
    emit([[isType(T.N3), 1], [cM + 0, 1]], -1, T.V0, range(cR, 4));
    emit([[isType(T.N3), 1], [cM + 1, 1]], -1, T.P0, range(cP, 4));
    emit([[isType(T.N3), 1], [cM + 2, 1]], -1, T.STOP, [null, null, null, null]);
    emit([[isType(T.N3), 1], [cM + 3, 1]], -1, T.END, [null, null, null, null]);
    // the last writes: one unit raw 1.0 (a byte's own type and bits are 1/127), far above everything else
    net.calibrate(8, 'ffn', 1, []);
    net.m.layers[8].scales[6] /= TINY;
    for (let i = 0; i < D; i++) net.m.final[i] = (i >= TYPE && i < TYPE + 15) || (i >= NIB && i < NIB + 4) ? 8192 : 0;   // a sure readout: a bit wrong costs ~25
    if (o.fault === 'mux') net.m.layers[7].w2[(NEXT + 0) * net.HIDDEN + 1] *= -1;
    return { net, info: { hidden: net.hiddenNext.slice(), channels: net.next } };
  }

  function range(a, n) { return Array.from({ length: n }, (_, i) => a + i); }

  // run a program: the prompt read, then bytes written until STOP / END, maxSteps steps or the view's end
  function run(S, model, asm, maxSteps, Engine) {
    const prompt = promptFor(asm);
    if (prompt.length >= model.CONTEXT) return { error: 'prompt of ' + prompt.length + ' bytes does not fit a view of ' + model.CONTEXT };
    const e = (Engine || S.Engine)(model);
    let pos = 0;
    for (; pos < prompt.length; pos++) e.step(prompt[pos], pos);
    const out = [];
    let steps = 0;
    while (pos < model.CONTEXT) {
      const b = e.likeliest();
      out.push(b);
      const t = b >> 4;
      if (t === T.STOP || t === T.END) break;
      if (t === T.N3) { steps++; if (steps >= maxSteps) break; }
      e.step(b, pos);
      pos++;
    }
    return { prompt, out, full: pos >= model.CONTEXT };   // full: the view filled before the run ended
  }

  // every step the model wrote against trace() on the reference machine; full: the view filled first, so
  // only the steps it wrote are held to the machine's (all right: full in the result)
  function compare(S, asm, written, maxSteps, full) {
    const ref = S.trace(asm, maxSteps, S.machine(S.KNOWN_GATES));
    const { steps, bad } = decode(written);
    const u = v => v & 65535;
    let right = 0;
    for (let i = 0; i < ref.rows.length; i++) {
      const [pc, a, b, c, before, afterV, next, printed] = ref.rows[i];
      const s = steps[i];
      if (!s && full) return { right, of: ref.rows.length, at: -1, why: null, full: true };
      if (!s || typeof s === 'string') return { right, of: ref.rows.length, at: i, why: 'missing step (got ' + JSON.stringify(s) + ')', bad };
      if (printed >= 0) { if (s.printed !== printed || s.next !== u(next)) return { right, of: ref.rows.length, at: i, why: 'print ' + JSON.stringify(s) + ' vs ' + printed + ' -> ' + u(next) }; }
      else if (s.b !== u(b) || s.after !== u(afterV) || s.next !== u(next)) return { right, of: ref.rows.length, at: i, why: JSON.stringify(s) + ' vs b ' + u(b) + ' after ' + u(afterV) + ' next ' + u(next) + ' (pc ' + pc + ')' };
      right++;
    }
    const end = steps[ref.rows.length];
    const wantEnd = ref.rows.length >= maxSteps ? undefined : ref.stopped ? 'STOP' : 'END';
    if (wantEnd !== undefined && end !== wantEnd) return { right, of: ref.rows.length, at: ref.rows.length, why: 'ended ' + JSON.stringify(end) + ', not ' + wantEnd };
    return { right, of: ref.rows.length, at: -1, why: null, ended: end };
  }


  const api = { T, TYPE_NAMES, byte, wordBytes, pcBytes, promptFor, decode, build, run, compare, writeTLM2, blank, Net, TINY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SubleqComputer = api;
})(typeof window !== 'undefined' ? window : this);
