// subleq_engine.js -- the 35k model writing SUBLEQ programs, and the computer they run on, for
// docs/subleq.html (window.Subleq), or for node (module.exports).
//
// It is a port of nitropz programs, kept close to them line for line:
//   core/engine.nitropz (engine_step, engine_likeliest), the parts of core/model.nitropz it calls
//   (norm_rows, the rotation tables, exp_shifted, negated_exp), fastmath's fast_rsqrt, mathf's fsin,
//   fcos, fpow, fexp and flog, and nitropz's own DOT_F64 and EXP_F64 (lib/vm.nitropz) -- every float
//   sum and product in the same order, so the chances it gives are the nitropz engine's to the bit;
//   subleq/subleq_lib.nitropz: the gate model's five gates and the datapath made of them, the template
//   the model is shown (sl_prompt), the assembler, the machine and the judge;
//   subleq/write.nitropz: the writing loop (wp_write), what it can be asked (wp_askable), and the
//   machine's steps, a row each (wx_trace).
(function (root) {
  'use strict';

  // ---- doubles and their bits ----
  const scratch = new DataView(new ArrayBuffer(8));

  function pow2(k) {                 // 2^k, k from -1022 to 1023: (k + 1023) << 52, as EXP_F64 writes it
    scratch.setUint32(0, 0, true);
    scratch.setUint32(4, ((k + 1023) << 20) >>> 0, true);
    return scratch.getFloat64(0, true);
  }

  function vmExp(v) {                // EXP_F64 (lib/vm.nitropz's vm_exp)
    if (v > 709.0) return Infinity;
    if (v < -708.0) return 0.0;
    const y = v * 1.4426950408889634;
    const k = y >= 0.0 ? Math.trunc(y + 0.5) : 0 - Math.trunc(0.5 - y);
    const r = v - k * 0.6931471803691238 - k * 0.00000000019082149292705877;
    const p = 1.0 + r * (1.0 + r * (0.5 + r * (0.16666666666666666 + r * (0.041666666666666664 + r * (0.008333333333333333 + r * (0.001388888888888889 + r * (0.0001984126984126984 + r * (0.0000248015873015873 + r * (0.0000027557319223985893 + r * (0.0000002755731922398589 + r * 0.00000002505210838544172))))))))));
    return p * pow2(k);
  }

  const RSQRT_MAGIC = 6910469410427058089n;

  function fastRsqrt(x) {            // fastmath.nitropz's fast_rsqrt
    scratch.setFloat64(0, x, true);
    scratch.setBigUint64(0, RSQRT_MAGIC - (scratch.getBigUint64(0, true) >> 1n), true);
    let y = scratch.getFloat64(0, true);
    const half = 0.5 * x;
    y = y * (1.5 - half * y * y);
    y = y * (1.5 - half * y * y);
    y = y * (1.5 - half * y * y);
    y = y * (1.5 - half * y * y);
    return y;
  }

  function dot8(a, ai, b, bi, n) {   // DOT_F64: product i to lane i % 8 while eight are left; then lanes
    let l0 = 0.0, l1 = 0.0, l2 = 0.0, l3 = 0.0, l4 = 0.0, l5 = 0.0, l6 = 0.0, l7 = 0.0;   // k and k + 4,
    const full = n - (n & 7);                                                          // as (0 + 2) +
    let i = 0;                                                                         // (1 + 3); then
    for (; i < full; i += 8) {                                                         // the rest
      l0 = l0 + a[ai + i] * b[bi + i];
      l1 = l1 + a[ai + i + 1] * b[bi + i + 1];
      l2 = l2 + a[ai + i + 2] * b[bi + i + 2];
      l3 = l3 + a[ai + i + 3] * b[bi + i + 3];
      l4 = l4 + a[ai + i + 4] * b[bi + i + 4];
      l5 = l5 + a[ai + i + 5] * b[bi + i + 5];
      l6 = l6 + a[ai + i + 6] * b[bi + i + 6];
      l7 = l7 + a[ai + i + 7] * b[bi + i + 7];
    }
    const t0 = l0 + l4, t1 = l1 + l5, t2 = l2 + l6, t3 = l3 + l7;
    let dot = (t0 + t2) + (t1 + t3);
    for (; i < n; i++) dot = dot + a[ai + i] * b[bi + i];
    return dot;
  }

  // ---- mathf.nitropz, for the rotation tables ----
  function fsin(x) {
    let r = x;
    while (r > 3.141592653589793) r = r - 6.283185307179586;
    while (r < 0.0 - 3.141592653589793) r = r + 6.283185307179586;
    if (r > 1.5707963267948966) r = 3.141592653589793 - r;
    if (r < 0.0 - 1.5707963267948966) r = (0.0 - 3.141592653589793) - r;
    const r2 = r * r;
    let term = r, sum = r;
    term = 0.0 - term * r2 / 6.0; sum = sum + term;
    term = 0.0 - term * r2 / 20.0; sum = sum + term;
    term = 0.0 - term * r2 / 42.0; sum = sum + term;
    term = 0.0 - term * r2 / 72.0; sum = sum + term;
    term = 0.0 - term * r2 / 110.0; sum = sum + term;
    term = 0.0 - term * r2 / 156.0; sum = sum + term;
    term = 0.0 - term * r2 / 210.0; sum = sum + term;
    return sum;
  }

  function fcos(x) { return fsin(x + 1.5707963267948966); }

  function ftrunc(x) {
    let neg = 0, v = x;
    if (v < 0.0) { neg = 1; v = 0.0 - v; }
    if (v >= 4503599627370496.0) return x;
    let t;
    if (v < 2147483648.0) t = Math.trunc(v);
    else {
      const scale = 67108864.0;
      const hi = Math.trunc(v / scale);
      const lo = v - hi * scale;
      t = hi * scale + Math.trunc(lo);
    }
    return neg === 1 ? 0.0 - t : t;
  }

  function ffloor(x) { const t = ftrunc(x); return x < 0.0 && t !== x ? t - 1.0 : t; }
  function fround(x) { return x < 0.0 ? 0.0 - ffloor((0.0 - x) + 0.5) : ffloor(x + 0.5); }

  function fexp(x) {
    const ln2 = 0.6931471805599453;
    const k = fround(x / ln2);
    const r = x - k * ln2;
    let term = 1.0, sum = 1.0;
    for (let n = 1; n <= 14; n++) { term = term * r / n; sum = sum + term; }
    const ki = Math.trunc(k);
    let p = 1.0;
    if (ki >= 0) for (let i = 0; i < ki; i++) p = p * 2.0;
    else for (let i = 0; i < 0 - ki; i++) p = p / 2.0;
    return sum * p;
  }

  function flog(x) {
    if (x <= 0.0) return 0.0;
    const ln2 = 0.6931471805599453;
    let m = x, k = 0;
    while (m >= 2.0) { m = m / 2.0; k = k + 1; }
    while (m < 1.0) { m = m * 2.0; k = k - 1; }
    const t = (m - 1.0) / (m + 1.0);
    const t2 = t * t;
    let term = t, sum = t;
    for (let n = 3; n <= 21; n += 2) { term = term * t2; sum = sum + term / n; }
    return k * ln2 + 2.0 * sum;
  }

  function fpow(base, exp) {
    if (exp === 0.0) return 1.0;
    if (exp === ftrunc(exp) && (exp < 0.0 ? 0.0 - exp : exp) <= 1024.0) {
      let e = Math.trunc(exp), neg = 0;
      if (e < 0) { neg = 1; e = 0 - e; }
      let r = 1.0;
      for (let i = 0; i < e; i++) r = r * base;
      return neg === 1 ? 1.0 / r : r;
    }
    if (base <= 0.0) return 0.0;
    return fexp(exp * flog(base));
  }

  // ---- the packed model, "TLM2" (engine_load and unpack) ----
  function loadModel(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 28 || dv.getUint32(0, true) !== 843926612) throw new Error('not a TLM2 model');
    const VOCAB = dv.getInt32(4, true), DIM = dv.getInt32(8, true), field = dv.getInt32(12, true);
    const HEADS = dv.getInt32(16, true), HIDDEN = dv.getInt32(20, true), CONTEXT = dv.getInt32(24, true);
    let BLOCK = field, LOOPS = 1;
    if (field >= 65536) { BLOCK = field & 65535; LOOPS = field >> 16; }
    const trits = BLOCK * (4 * DIM * DIM + 3 * HIDDEN * DIM);
    const tritBytes = Math.floor((Math.floor((trits + 4) / 5) + 3) / 4) * 4;
    const size = 28 + BLOCK * 7 * 8 + tritBytes + VOCAB * 4 + VOCAB * DIM + (2 * BLOCK + 1) * DIM * 4;
    if (bytes.length !== size) throw new Error('a TLM2 model of ' + size + ' bytes, not ' + bytes.length);
    let at = 28;
    const scales = new Float64Array(BLOCK * 7);
    for (let i = 0; i < BLOCK * 7; i++) { scales[i] = dv.getFloat64(at, true); at += 8; }
    let left = 0, held = 0;
    function digit() {               // five digits a byte, the first the lowest
      if (left === 0) { held = bytes[at]; at += 1; left = 5; }
      const d = held % 3;
      held = Math.floor(held / 3);
      left -= 1;
      return d;
    }
    function matrix(N, K) { const w = new Int8Array(N * K); for (let i = 0; i < N * K; i++) w[i] = digit() - 1; return w; }
    const layers = [];
    for (let l = 0; l < BLOCK; l++) {
      const L = {};
      L.wq = matrix(DIM, DIM); L.wk = matrix(DIM, DIM); L.wv = matrix(DIM, DIM); L.wo = matrix(DIM, DIM);
      L.w1 = matrix(HIDDEN, DIM); L.w3 = matrix(HIDDEN, DIM); L.w2 = matrix(DIM, HIDDEN);
      layers.push(L);
    }
    const scalesAt = 28 + BLOCK * 7 * 8 + tritBytes, numbersAt = scalesAt + VOCAB * 4;
    const emb = new Float64Array(VOCAB * DIM);
    for (let v = 0; v < VOCAB; v++) {
      const s = dv.getFloat32(scalesAt + v * 4, true);
      for (let j = 0; j < DIM; j++) emb[v * DIM + j] = dv.getInt8(numbersAt + v * DIM + j) * s;
    }
    let g = numbersAt + VOCAB * DIM;
    function gains() { const a = new Float64Array(DIM); for (let i = 0; i < DIM; i++) { a[i] = dv.getFloat32(g, true); g += 4; } return a; }
    for (let l = 0; l < BLOCK; l++) { layers[l].g1 = gains(); layers[l].g2 = gains(); }
    const final = gains();
    const HEAD = DIM / HEADS, pairs = HEAD / 2;
    const cos = new Float64Array(CONTEXT * pairs), sin = new Float64Array(CONTEXT * pairs);
    for (let p = 0; p < CONTEXT; p++) {   // model_rope: pair j at position p turns p / 10000^(2j / HEAD)
      for (let j = 0; j < pairs; j++) {
        const angle = p / fpow(10000.0, (2 * j) / HEAD);
        cos[p * pairs + j] = fcos(angle);
        sin[p * pairs + j] = fsin(angle);
      }
    }
    return { VOCAB, DIM, BLOCK, LAYERS: BLOCK * LOOPS, HEADS, HEAD, HIDDEN, CONTEXT, scales, layers, emb, final, cos, sin,
             attScale: 1.0 / Math.sqrt(HEAD) };   // (mathf's fsqrt is the correctly rounded root, as Math.sqrt)
  }

  // ---- the engine: one byte at a time, a cache of every key and value so far ----
  // watch (optional): watch(layer, head, weights, pos) after each head's weights are worked out, for a
  // page that shows where a head looked; it reads them and changes nothing
  function Engine(m, watch) {
    const { VOCAB, DIM, LAYERS, BLOCK, HEADS, HEAD, HIDDEN, CONTEXT } = m;
    const kc = new Float64Array(LAYERS * CONTEXT * DIM), vc = new Float64Array(LAYERS * CONTEXT * DIM);
    const x = new Float64Array(DIM), h = new Float64Array(DIM), qry = new Float64Array(DIM);
    const val = new Float64Array(DIM), att = new Float64Array(DIM), out = new Float64Array(DIM);
    const gate = new Float64Array(HIDDEN), up = new Float64Array(HIDDEN), act = new Float64Array(HIDDEN);
    const w = new Float64Array(CONTEXT);
    const q = new Int32Array(Math.max(DIM, HIDDEN) + 4);
    const chances = new Float64Array(VOCAB);
    const pairs = HEAD / 2;

    function norm(src, so, gains) {  // norm_rows, one row: into h
      let ss = 0.0;
      for (let i = 0; i < DIM; i++) { const v = src[so + i]; ss = ss + v * v; }
      const inv = fastRsqrt(ss / DIM + 0.00001);
      for (let i = 0; i < DIM; i++) h[i] = src[so + i] * inv * gains[i];
    }

    function round(row, K) {         // round_row: whole numbers from -127 to 127 into q; the scale back
      let most = 0.0;
      for (let i = 0; i < K; i++) { let v = row[i]; if (v < 0.0) v = 0.0 - v; if (v > most) most = v; }
      if (most < 0.000000000001) most = 0.000000000001;
      const s = 127.0 / most;
      for (let i = 0; i < K; i++) { const v = row[i] * s; q[i] = v >= 0.0 ? Math.trunc(v + 0.5) : 0 - Math.trunc(0.5 - v); }
      return s;
    }

    function apply(dst, dOff, wt, N, K, scale, s) {   // apply_groups: whole-number sums, scaled once
      for (let o = 0; o < N; o++) {
        let acc = 0;
        const row = o * K;
        for (let i = 0; i < K; i++) { const t = wt[row + i]; if (t === 1) acc += q[i]; else if (t === -1) acc -= q[i]; }
        dst[dOff + o] = acc * scale / s;
      }
    }

    function rotate(v, vo, pos) {    // rotate_at
      for (let hd = 0; hd < HEADS; hd++) {
        for (let j = 0; j < pairs; j++) {
          const at = vo + hd * HEAD + 2 * j;
          const c = m.cos[pos * pairs + j], s = 1.0 * m.sin[pos * pairs + j];
          const a = v[at], b = v[at + 1];
          v[at] = a * c - b * s;
          v[at + 1] = a * s + b * c;
        }
      }
    }

    function step(token, pos) {      // engine_step: chances then hold each next byte's chance
      for (let i = 0; i < DIM; i++) x[i] = m.emb[token * DIM + i];
      for (let l = 0; l < LAYERS; l++) {
        const L = m.layers[l % BLOCK], s7 = (l % BLOCK) * 7;
        const kBase = l * CONTEXT * DIM, vBase = l * CONTEXT * DIM, key = kBase + pos * DIM;
        norm(x, 0, L.g1);
        let s = round(h, DIM);
        apply(qry, 0, L.wq, DIM, DIM, m.scales[s7], s);
        apply(kc, key, L.wk, DIM, DIM, m.scales[s7 + 1], s);
        apply(val, 0, L.wv, DIM, DIM, m.scales[s7 + 2], s);
        rotate(qry, 0, pos);
        rotate(kc, key, pos);
        for (let i = 0; i < DIM; i++) vc[vBase + pos * DIM + i] = val[i];
        for (let hd = 0; hd < HEADS; hd++) {
          const qo = hd * HEAD;
          let most = -1000000000000.0;
          for (let j = 0; j <= pos; j++) {
            const dot = dot8(qry, qo, kc, kBase + j * DIM + qo, HEAD) * m.attScale;
            w[j] = dot;
            if (dot > most) most = dot;
          }
          for (let j = 0; j <= pos; j++) { let t = w[j] - most; if (t < -60.0) t = -1000.0; if (t > 60.0) t = 60.0; w[j] = t; }
          for (let j = 0; j <= pos; j++) w[j] = vmExp(w[j]);
          let sum = 0.0;
          for (let j = 0; j <= pos; j++) sum = sum + w[j];
          for (let j = 0; j <= pos; j++) w[j] = w[j] / sum;
          if (watch) watch(l, hd, w, pos);
          for (let i = 0; i < HEAD; i++) att[qo + i] = 0.0;
          for (let j = 0; j <= pos; j++) {
            const by = w[j], vo = vBase + j * DIM + qo;
            for (let i = 0; i < HEAD; i++) att[qo + i] = att[qo + i] + by * vc[vo + i];
          }
        }
        s = round(att, DIM);
        apply(out, 0, L.wo, DIM, DIM, m.scales[s7 + 3], s);
        for (let i = 0; i < DIM; i++) x[i] = x[i] + out[i];
        norm(x, 0, L.g2);
        s = round(h, DIM);
        apply(gate, 0, L.w1, HIDDEN, DIM, m.scales[s7 + 4], s);
        apply(up, 0, L.w3, HIDDEN, DIM, m.scales[s7 + 5], s);
        for (let i = 0; i < HIDDEN; i++) { let t = 0.0 - gate[i]; if (t < -60.0) t = -1000.0; if (t > 60.0) t = 60.0; act[i] = vmExp(t); }
        for (let i = 0; i < HIDDEN; i++) { const g = gate[i]; act[i] = g * (1.0 / (1.0 + act[i])) * up[i]; }
        s = round(act, HIDDEN);
        apply(out, 0, L.w2, DIM, HIDDEN, m.scales[s7 + 6], s);
        for (let i = 0; i < DIM; i++) x[i] = x[i] + out[i];
      }
      norm(x, 0, m.final);
      let most = -1000000000000.0;
      for (let v = 0; v < VOCAB; v++) { const d = dot8(h, 0, m.emb, v * DIM, DIM); chances[v] = d; if (d > most) most = d; }
      for (let v = 0; v < VOCAB; v++) { let t = chances[v] - most; if (t < -60.0) t = -1000.0; if (t > 60.0) t = 60.0; chances[v] = t; }
      for (let v = 0; v < VOCAB; v++) chances[v] = vmExp(chances[v]);
      let sum = 0.0;
      for (let v = 0; v < VOCAB; v++) sum = sum + chances[v];
      for (let v = 0; v < VOCAB; v++) chances[v] = chances[v] / sum;
    }

    function likeliest() {           // engine_likeliest: the lowest, on a tie
      let best = 0;
      for (let v = 1; v < VOCAB; v++) if (chances[v] > chances[best]) best = v;
      return best;
    }

    return { step, likeliest, chances, CONTEXT };
  }

  // ---- the template the model is shown, and the tasks it can be asked ----
  function kind(question) {          // sl_kind: 0 sums, 1 a product, 2 printing, 3 a quotient; -1 none
    if (question.length < 9) return -1;
    if (question.charCodeAt(5) === 112) return 2;
    for (const c of question) { if (c === '*') return 1; if (c === '/') return 3; }
    return 0;
  }

  function part(question, k) {       // sl_part: a sum's part k, [sign, letter], or null
    let n = 0, sign = '+';
    for (let i = 7; question[i] !== ':'; i++) {
      const c = question[i];
      if (c === '+' || c === '-') sign = c;
      else { if (n === k) return [sign, c]; n += 1; }
    }
    return null;
  }

  function prompt(question) {        // sl_prompt
    const kd = kind(question);
    if (kd === 2) {
      let out = 'prog print:\n';
      for (let k = 0; k < 8; k++) {
        const c = 11 + k >= question.length - 1 ? '' : question[11 + k];
        out += c ? '    #' + k + ": '" + c + '    \n' : '    #' + k + ': .     \n';
      }
      return out;
    }
    if (kd === 0) {
      let out = 'prog sum:\n';
      for (let k = 0; k < 4; k++) {
        const p = part(question, k);
        out += p ? '    #' + k + ':' + p[0] + p[1] + '  \n' : '    #' + k + ':.   \n';
        out += '    #      \n    #      \n';
      }
      return out;
    }
    const x = question[7], y = question[9];
    if (kd === 3) {                  // a quotient's: x and y 8 lines above where its program copies them
      let out = 'prog quotient:\n    #         \n';
      out += '    # ' + x + '       \n';
      out += '    #         \n';
      out += '    #   ' + y + ' ' + x + '   \n';
      for (let k = 4; k < 8; k++) out += '    #         \n';
      return out;
    }
    let out = 'prog product:\n';
    out += '    #     ' + y + '   \n';
    out += '    #   ' + y + '     \n';
    out += '    #   ' + x + '     \n';
    for (let k = 3; k < 8; k++) out += '    #         \n';
    return out;
  }

  function askable(q) {              // wp_askable
    const n = q.length;
    const letter = c => c >= 'a' && c <= 'e';
    if (n < 9 || q[n - 1] !== ':') return false;   // ("prog r=a:", one part, is the shortest)
    if (q.startsWith('prog print ')) {
      if (n - 12 < 1 || n - 12 > 8) return false;
      for (let i = 11; i < n - 1; i++) if (q[i] < 'a' || q[i] > 'z') return false;
      return true;
    }
    if (!q.startsWith('prog r=')) return false;
    if (n === 11 && (q[8] === '*' || q[8] === '/')) return letter(q[7]) && letter(q[9]) && q[7] !== q[9];
    let parts = 0, wantLetter = true;
    for (let i = 7; i < n - 1; i++) {
      const c = q[i];
      if (wantLetter) { if (!letter(c)) return false; parts += 1; wantLetter = false; }
      else { if (c !== '+' && c !== '-') return false; wantLetter = true; }
    }
    return parts >= 1 && parts <= 4 && !wantLetter;
  }

  // ---- writing: a prompt read, then the likeliest byte each time, until a line does not start with a
  // space (wp_write for programs, at most 1000 bytes; machine.nitropz's sq_write for gates, 400) ----
  function Writer(engine, question) { return writeAfter(engine, prompt(question), 1000); }

  function writeAfter(engine, p, limit) {
    const text = [];
    for (let i = 0; i < p.length; i++) text.push(p.charCodeAt(i));
    let pos = 0;
    for (; pos < text.length; pos++) engine.step(text[pos], pos);
    let done = false;
    function next() {                // the next byte written, with its chance; null at the end
      if (done) return null;
      if (text.length >= limit) { done = true; return null; }
      if (pos === engine.CONTEXT) {  // past the view: the last half of it read again
        const keep = engine.CONTEXT / 2, from = text.length - keep;
        for (pos = 0; pos < keep; pos++) engine.step(text[from + pos], pos);
      }
      const byte = engine.likeliest();
      if (byte !== 32 && text[text.length - 1] === 10) { done = true; return null; }
      const chance = engine.chances[byte];
      text.push(byte);
      engine.step(byte, pos);
      pos += 1;
      return { byte, chance };
    }
    return { prompt: p, next, program: () => String.fromCharCode(...text.slice(p.length)) };
  }

  // ---- the gates: what the gate model is asked (gate_judge's judge_question), and its answer read ----
  // A gate of 1, 2 or 3 inputs is named by its answers, row 0 first, the rows counted n = a*4 + b*2 + c;
  // the machine asks for five (machine.nitropz's SQ_GATES): each its number g and inputs.
  const GATES = [
    { g: 2, ins: 1, role: 'NOT' },             // gate_10
    { g: 7, ins: 2, role: 'OR' },              // gate_0111
    { g: 105, ins: 3, role: 'sum' },           // gate_01101001, a full adder's sum
    { g: 23, ins: 3, role: 'carry' },          // gate_00010111, its carry
    { g: 53, ins: 3, role: 'choose' },         // gate_00110101, a ? c : b
  ];
  const PARAMS = ['', '(a)', '(a, b)', '(a, b, c)'];
  const ROW = ['', 'a', 'a * 2 + b', 'a * 4 + b * 2 + c'];

  const gateBit = (g, ins, r) => (g >> ((1 << ins) - 1 - r)) & 1;

  function gateName(g, ins) { let s = 'gate_'; for (let r = 0; r < (1 << ins); r++) s += gateBit(g, ins, r); return s; }

  function gateQuestion(g, ins) {    // judge_question: the name line and the truth table line
    let t = 'fn ' + gateName(g, ins) + PARAMS[ins] + ':\n    #';
    for (let r = 0; r < (1 << ins); r++) t += ' ' + r + ':' + gateBit(g, ins, r);
    return t + '\n';
  }

  function GateWriter(engine, g, ins) { return writeAfter(engine, gateQuestion(g, ins), 400); }

  function readGate(text, ins) {     // the gate as written, run on each row: its answers, row 0 first --
    const lines = text.split('\n').slice(2).map(l => l.trim()).filter(l => l);   // or null, when it is
    if (lines[0] !== 'let n = ' + ROW[ins]) return null;                        // not in the form this
    const rules = [];                                                            // reads: "let n = ...",
    let otherwise = null;                                                        // "if n == K: return D"
    for (const line of lines.slice(1)) {                                        // (K: one or more, by
      let m = /^if (n == \d+(?: or n == \d+)*): return ([01])$/.exec(line);    // "or"), "return D"
      if (m) { rules.push([m[1].split(' or ').map(t => +t.slice(5)), +m[2]]); continue; }
      m = /^return ([01])$/.exec(line);
      if (m && otherwise === null) { otherwise = +m[1]; continue; }
      return null;
    }
    if (otherwise === null) return null;
    const table = [];
    for (let n = 0; n < (1 << ins); n++) {
      let v = otherwise;
      for (const [ks, d] of rules) if (ks.includes(n)) { v = d; break; }
      table.push(v);
    }
    return table;
  }

  // the five as subleq_lib.nitropz has them: what the machine is checked against, and for node's checks
  const KNOWN_GATES = { NOT: [1, 0], OR: [0, 1, 1, 1], SUM: [0, 1, 1, 0, 1, 0, 0, 1], CARRY: [0, 0, 0, 1, 0, 1, 1, 1],
                        CHOOSE: [0, 0, 1, 1, 0, 1, 0, 1] };

  // ---- the machine's datapath, made of five gates and nothing else: G = { NOT, OR, SUM, CARRY, CHOOSE },
  // each a truth table, row n = a*4 + b*2 + c (subleq_lib's sl_sub16, sl_add16, sl_at_most_zero, sl_choose16).
  // trace, run and judge take the machine this makes. ----
  function machine(G) {
    const NOT = G.NOT, OR = G.OR, SUM = G.SUM, CARRY = G.CARRY, CHOOSE = G.CHOOSE;

    function sub16(x, y) {           // x + NOT y + 1, a digit at a time
      let r = 0, carry = 1;
      for (let i = 0; i < 16; i++) {
        const a = (x >> i) & 1, b = NOT[(y >> i) & 1];
        r = r | (SUM[a * 4 + b * 2 + carry] << i);
        carry = CARRY[a * 4 + b * 2 + carry];
      }
      return r;
    }

    function add16(x, y) {
      let r = 0, carry = 0;
      for (let i = 0; i < 16; i++) {
        const a = (x >> i) & 1, b = (y >> i) & 1;
        r = r | (SUM[a * 4 + b * 2 + carry] << i);
        carry = CARRY[a * 4 + b * 2 + carry];
      }
      return r;
    }

    function atMostZero(r) {         // the sign, OR no bit set
      let any = 0;
      for (let i = 0; i < 16; i++) any = OR[any * 2 + ((r >> i) & 1)];
      return OR[((r >> 15) & 1) * 2 + NOT[any]];
    }

    function choose16(s, x0, x1) {
      let r = 0;
      for (let i = 0; i < 16; i++) r = r | (CHOOSE[s * 4 + ((x0 >> i) & 1) * 2 + ((x1 >> i) & 1)] << i);
      return r;
    }

    return { sub16, add16, atMostZero, choose16 };
  }

  // ---- the assembler (sl_assemble): the lines after the question, into memory ----
  const SIZE = 512;

  function assemble(program, inputs) {   // program: the task's text, question line first; inputs: a to e
    const lines = program.split('\n');
    const ops = [];                  // [label or null, a, b, c or null]
    const data = [];                 // "= name value": a cell's first value (sl_data)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.length === 0) continue;
      if (line.length < 5 || !line.startsWith('    ')) return null;
      if (line[4] === '=') {
        const m = /^= (\S+) (-?[0-9]+)$/.exec(line.slice(4));
        if (!m || data.length >= 32) return null;
        data.push([m[1], parseInt(m[2], 10)]);
        continue;
      }
      if (line[4] === '#') continue;
      if (ops.length >= 120) return null;
      const parts = line.slice(4).split(' ').filter(t => t.length > 0);
      if (parts.length > 4) return null;
      let label = null, first = 0;
      if (parts.length > 0 && parts[0].endsWith(':')) { label = parts[0].slice(0, -1); first = 1; }
      const operands = parts.length - first;
      if (operands < 2 || operands > 3) return null;
      ops.push([label, parts[first], parts[first + 1], operands === 3 ? parts[first + 2] : null]);
    }
    if (ops.length === 0) return null;
    const cells = [];                // [name, address, value]
    function cell(name, value) {
      for (const c of cells) if (c[0] === name) return c[1];
      if (cells.length >= 64) return -1;
      const at = ops.length * 3 + cells.length;
      if (at >= SIZE) return -1;
      cells.push([name, at, value & 65535]);
      return at;
    }
    function labelAt(name) { for (let k = 0; k < ops.length; k++) if (ops[k][0] === name) return k * 3; return -1; }
    const isLetter = c => c >= 'a' && c <= 'z';
    function operand(tok, where, next) {
      if (tok === null) return next;
      const c = tok[0];
      if (where === 1 && tok === 'out') return 65535;
      if (c === '-' || (c >= '0' && c <= '9')) {
        if (where !== 2) return -1;
        const digits = c === '-' ? tok.slice(1) : tok;
        if (!/^[0-9]+$/.test(digits)) return -1;
        let v = 0;
        for (const d of digits) v = v * 10 + (d.charCodeAt(0) - 48);
        return (c === '-' ? 0 - v : v) & 65535;
      }
      if (c === "'") {
        if (tok.length !== 2 || where === 2) return -1;
        return cell(tok, tok.charCodeAt(1));
      }
      if (!isLetter(c)) return -1;
      for (let i = 1; i < tok.length; i++) { const d = tok[i]; if (!isLetter(d) && (d < '0' || d > '9')) return -1; }
      const label = labelAt(tok);
      if (label >= 0) return label;
      if (where === 2) return -1;
      let value = 0;
      if (tok === 'one') value = 1;
      if (tok.length === 1 && tok >= 'a' && tok <= 'e') value = inputs[tok.charCodeAt(0) - 97];
      return cell(tok, value);
    }
    cell('z', 0);
    cell('one', 1);
    for (const [name, value] of data) cell(name, value);
    const mem = new Array(SIZE).fill(0);
    for (let k = 0; k < ops.length; k++) {
      const a = operand(ops[k][1], 0, 0), b = operand(ops[k][2], 1, 0), c = operand(ops[k][3], 2, k * 3 + 3);
      if (a < 0 || b < 0 || c < 0) return null;
      mem[k * 3] = a; mem[k * 3 + 1] = b; mem[k * 3 + 2] = c;
    }
    let r = -1;
    for (const [name, at, value] of cells) { mem[at] = value; if (name === 'r') r = at; }
    return { mem, cells: cells.map(([name, at]) => [name, at]), r, ops };
  }

  const signed = v => (v >= 32768 ? v - 65536 : v);

  function trace(asm, limit, m) {    // wx_trace: [pc, a, b, c, b before, after, the next pc, a byte printed or -1]
    const { sub16, add16, atMostZero, choose16 } = m;
    const mem = asm.mem.slice(), rows = [];
    let pc = 0;
    while (pc < 32768 && rows.length < limit && pc <= SIZE - 3) {
      const a = mem[pc], b = mem[pc + 1], c = mem[pc + 2];
      let before = 0, after = 0, printed = -1, next = 0;
      if (a >= SIZE || (b !== 65535 && b >= SIZE)) break;
      if (b === 65535) { printed = mem[a] & 255; next = add16(pc, 3); }
      else {
        before = mem[b];
        after = sub16(before, mem[a]);
        mem[b] = after;
        next = choose16(atMostZero(after), add16(pc, 3), c);
      }
      rows.push([pc, a, signed(b), signed(c), signed(before), signed(after), signed(next), printed]);
      pc = next;
    }
    return { rows, stopped: pc >= 32768 };
  }

  function run(asm, limit, m) {      // sl_run on the gate machine: what it printed and its memory, or null
    const { sub16, add16, atMostZero, choose16 } = m;
    const mem = asm.mem.slice();
    let pc = 0, steps = 0, out = '';
    while (pc < 32768) {
      if (steps >= limit || pc > SIZE - 3) return null;
      const a = mem[pc], b = mem[pc + 1], c = mem[pc + 2];
      if (a >= SIZE) return null;
      if (b === 65535) { if (out.length < 500) out += String.fromCharCode(mem[a] & 255); pc = add16(pc, 3); }
      else {
        if (b >= SIZE) return null;
        const r = sub16(mem[b], mem[a]);
        mem[b] = r;
        pc = choose16(atMostZero(r), add16(pc, 3), c);
      }
      steps += 1;
    }
    return { mem, out, steps };
  }

  function expect(question, inputs) {   // sl_expect: what r must be (sums, products, quotients)
    const kd = kind(question);
    if (kd === 1 || kd === 3) {
      const x = inputs[question.charCodeAt(7) - 97], y = inputs[question.charCodeAt(9) - 97];
      return (kd === 3 ? Math.trunc(x / y) : x * y) & 65535;
    }
    let total = 0, sign = '+';
    for (let i = 7; question[i] !== ':'; i++) {
      const c = question[i];
      if (c === '+' || c === '-') sign = c;
      else total = sign === '+' ? total + inputs[c.charCodeAt(0) - 97] : total - inputs[c.charCodeAt(0) - 97];
    }
    return total & 65535;
  }

  function judge(question, program, seed, m) {   // sl_judge: 1 right, 0 wrong, -1 does not assemble, -2 does not stop
    let s = seed;                    //   on 6 sets of inputs drawn by Park and Miller's rule
    const draw = () => { s = 48271 * (s % 44488) - 3399 * Math.trunc(s / 44488); if (s <= 0) s += 2147483647; return s; };
    const kd = kind(question);
    if (kd < 0) return -1;
    const text = question + '\n' + program;
    for (let trial = 0; trial < 6; trial++) {
      const inputs = [];
      for (let k = 0; k < 5; k++) inputs.push((draw() % 2001) - 1000);
      if (kd === 1) inputs[question.charCodeAt(9) - 97] = draw() % 21;
      if (kd === 3) {                // a quotient: 0 to 200 over 1 to 20
        inputs[question.charCodeAt(7) - 97] = draw() % 201;
        inputs[question.charCodeAt(9) - 97] = 1 + draw() % 20;
      }
      const asm = assemble(text, inputs);
      if (asm === null) return -1;
      const ran = run(asm, 20000, m);
      if (ran === null) return -2;
      if (kd === 2) return ran.out === question.slice(11, question.length - 1) ? 1 : 0;
      if (asm.r < 0 || ran.mem[asm.r] !== expect(question, inputs)) return 0;
    }
    return 1;
  }

  const api = { loadModel, Engine, Writer, GateWriter, GATES, gateName, gateQuestion, gateBit, readGate, KNOWN_GATES,
                machine, prompt, askable, kind, assemble, trace, run, judge, expect, signed,
                vmExp, fastRsqrt, dot8, fsin, fcos, fpow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Subleq = api;
})(typeof window !== 'undefined' ? window : this);
