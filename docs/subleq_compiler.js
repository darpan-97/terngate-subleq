// subleq_compiler.js -- arithmetic compiled to SUBLEQ, every instruction of it written by the program model:
// a port of subleq/compile.nitropz, held to it by subleq/page_check.js. The source: an expression over the
// letters a to e and whole numbers 0 and up, with + - * / % and brackets in the usual order, as
// "r = (a + b) * c - 3" (the "r =" may be left out). It is broken into steps the model has been taught --
// a sum of 1 to 4 parts, a product of two cells, a quotient of two cells -- each into a cell of its own;
// the model writes each step's program after its template; each program is renamed (its letters to the
// step's cells, r to the step's result, its labels to labels of its own) and joined to the next (its
// stop turned into "go on"). Constants are cells given a first value ("= k1 3"). A product counts its
// right side down to 0 and a quotient its left side, so a letter or constant there is copied first (a
// one-part sum) into a cell of its own, and a remainder is x - y * (x / y).
(function (root) {
  'use strict';

  // ---- reading ----
  function parse(source) {           // the tree, or { error }
    let s = source.replace(/\s+/g, '').toLowerCase();
    if (s.startsWith('r=')) s = s.slice(2);
    if (s === '') return { error: 'nothing to compile' };
    let i = 0;
    function fail(why) { throw new Error(why); }
    function factor() {
      const c = s[i];
      if (c === '-') { i += 1; return { k: 'neg', a: factor() }; }
      if (c === '(') {
        i += 1;
        const e = expr();
        if (s[i] !== ')') fail('a bracket is not closed');
        i += 1;
        return e;
      }
      if (c >= 'a' && c <= 'e') { i += 1; return { k: 'var', v: c }; }
      if (c >= '0' && c <= '9') {
        let v = 0;
        while (s[i] >= '0' && s[i] <= '9') { v = v * 10 + (s.charCodeAt(i) - 48); i += 1; }
        if (v > 32767) fail('a number above 32767');
        return { k: 'num', v };
      }
      fail(c === undefined ? 'the expression ends too soon' : 'cannot read "' + c + '": use a to e, numbers, + - * / % and brackets');
    }
    function term() {
      let n = factor();
      while (s[i] === '*' || s[i] === '/' || s[i] === '%') { const op = s[i]; i += 1; n = { k: op, a: n, b: factor() }; }
      return n;
    }
    function expr() {
      let n = term();
      while (s[i] === '+' || s[i] === '-') { const op = s[i]; i += 1; n = { k: op, a: n, b: term() }; }
      return n;
    }
    try {
      const tree = expr();
      if (i < s.length) fail('cannot read "' + s[i] + '"');
      return { tree, text: 'r=' + s };
    } catch (err) { return { error: err.message }; }
  }

  // ---- lowering: into steps the model has been taught ----
  function lower(tree) {
    const steps = [], data = [], consts = {};
    let temps = 0;
    const fresh = () => 't' + (temps += 1);
    const plain = n => n.k === 'var' || n.k === 'num';
    function constCell(v) {
      if (v === 1) return 'one';
      if (consts[v] === undefined) { consts[v] = 'k' + (data.length + 1); data.push([consts[v], v]); }
      return consts[v];
    }
    function letters(cells) {         // the step's cells, each a letter of a to d in order, a cell once
      const names = {}, of = {};
      for (const c of cells) if (of[c] === undefined) { of[c] = String.fromCharCode(97 + Object.keys(names).length); names[of[c]] = c; }
      return { names, of };
    }
    function sum(result, parts, again) {   // parts: [sign, cell], at most 4, the first a +
      const { names, of } = letters(parts.map(p => p[1]));
      const question = 'prog r=' + parts.map((p, i) => (i ? (p[0] > 0 ? '+' : '-') : '') + of[p[1]]).join('') + ':';
      const shown = parts.map((p, i) => (i ? (p[0] > 0 ? ' + ' : ' - ') : '') + p[1]).join('');
      steps.push({ question, names, result, shown: result + ' = ' + (again ? result + ' + ' : '') + shown });
    }
    function copy(target, cell) { sum(target, [[1, cell]], false); }
    function sums(result, parts) {    // any number of parts: the + first, 4 to a step (a step adds into
      let list = parts.filter(p => p[0] > 0).concat(parts.filter(p => p[0] < 0));   // its result)
      let again = false;
      while (list.length) {
        let chunk;
        if (list[0][0] < 0) { chunk = [[1, constCell(0)]].concat(list.slice(0, 3)); list = list.slice(3); }
        else { chunk = list.slice(0, 4); list = list.slice(4); }
        sum(result, chunk, again);
        again = true;
      }
    }
    function two(op, result, x, y) {  // a product (y counted down) or a quotient (x counted down)
      steps.push({ question: 'prog r=a' + op + 'b:', names: { a: x, b: y }, result, shown: result + ' = ' + x + ' ' + op + ' ' + y });
    }
    function value(node, target) {    // the cell holding node's value, made target's when one is given
      if (node.k === 'var' || node.k === 'num') {
        const cell = node.k === 'var' ? node.v : constCell(node.v);
        if (target) { copy(target, cell); return target; }
        return cell;
      }
      if (node.k === '+' || node.k === '-' || node.k === 'neg') {
        const parts = [];
        (function flatten(n, sign) {
          if (n.k === '+') { flatten(n.a, sign); flatten(n.b, sign); }
          else if (n.k === '-') { flatten(n.a, sign); flatten(n.b, -sign); }
          else if (n.k === 'neg') flatten(n.a, -sign);
          else parts.push([sign, value(n, null)]);
        })(node, 1);
        const result = target || fresh();
        sums(result, parts);
        return result;
      }
      const x = value(node.a, null), y = value(node.b, null);
      if (node.k === '*') {
        let mult = x, count = y, countNode = node.b;
        node.counter = 'b';
        if (!plain(node.b) && plain(node.a)) { mult = y; count = x; countNode = node.a; node.counter = 'a'; }
        if (plain(countNode)) { const c = fresh(); copy(c, count); count = c; }
        const result = target || fresh();
        two('*', result, mult, count);
        return result;
      }
      if (node.k === '/') {
        let dividend = x;
        if (plain(node.a)) { dividend = fresh(); copy(dividend, x); }
        const result = target || fresh();
        two('/', result, dividend, y);
        return result;
      }
      const d = fresh();              // %: x - y * (x / y), x copied for the division
      copy(d, x);
      const q = fresh();
      two('/', q, d, y);
      const p = fresh();
      two('*', p, y, q);
      const result = target || fresh();
      sums(result, [[1, x], [-1, p]]);
      return result;
    }
    value(tree, 'r');
    return { steps, data };
  }

  // ---- linking: each step's program renamed and joined to the next ----
  function link(text, steps, programs, data) {
    const out = ['prog ' + text + ':'];
    for (const [name, v] of data) out.push('    = ' + name + ' ' + v);
    steps.forEach((st, k) => {
      const lines = programs[k].split('\n').filter(l => l.trim() !== '');
      const labels = {};
      for (const line of lines) { const t = line.trim().split(/ +/); if (t[0].endsWith(':')) labels[t[0].slice(0, -1)] = 1; }
      const rename = tok => {
        if (labels[tok]) return 's' + (k + 1) + tok;
        if (tok === 'r') return st.result;
        if (tok.length === 1 && st.names[tok] !== undefined) return st.names[tok];
        return tok;
      };
      for (const line of lines) {
        const t = line.trim().split(/ +/);
        const label = t[0].endsWith(':') ? rename(t.shift().slice(0, -1)) + ': ' : '';
        const ops = t.map(rename);
        if (k < steps.length - 1 && ops.length === 3 && ops[2] === '-1') ops.pop();
        out.push('    ' + label + ops.join(' '));
      }
    });
    return out.join('\n') + '\n';
  }

  // ---- the judge: the expression worked out where the machine can do it ----
  function evaluate(node, inputs) {  // its value, or null when a step goes outside what the machine does
    const fits = v => (v === null || v < -32768 || v > 32767 ? null : v);
    if (node.k === 'var') return inputs[node.v.charCodeAt(0) - 97];
    if (node.k === 'num') return node.v;
    if (node.k === 'neg') { const a = evaluate(node.a, inputs); return a === null ? null : fits(0 - a); }
    const a = evaluate(node.a, inputs), b = evaluate(node.b, inputs);
    if (a === null || b === null) return null;
    if (node.k === '+') return fits(a + b);
    if (node.k === '-') return fits(a - b);
    if (node.k === '*') return (node.counter === 'a' ? a : b) < 0 ? null : fits(a * b);
    if (a < 0 || a > 32766 || b <= 0) return null;   // (a quotient's loop works on a + 1)
    if (node.k === '/') return Math.floor(a / b);
    return a - b * Math.floor(a / b);
  }

  // 1 right on every set of inputs tried, 0 wrong, -1 does not assemble, -2 does not stop, -3 no set of
  // inputs (a to e drawn from 0 to 20, Park and Miller's rule) keeps it inside what the machine does
  function judge(tree, program, seed, m, S) {
    let s = seed;
    const draw = () => { s = 48271 * (s % 44488) - 3399 * Math.trunc(s / 44488); if (s <= 0) s += 2147483647; return s; };
    let tried = 0, sets = 0;
    while (sets < 6 && tried < 400) {
      tried += 1;
      const inputs = [];
      for (let k = 0; k < 5; k++) inputs.push(draw() % 21);
      const want = evaluate(tree, inputs);
      if (want === null) continue;
      sets += 1;
      const asm = S.assemble(program, inputs);
      if (asm === null) return { verdict: -1, sets };
      const ran = S.run(asm, 400000, m);
      if (ran === null) return { verdict: -2, sets };
      if (asm.r < 0 || S.signed(ran.mem[asm.r]) !== want) return { verdict: 0, sets };
    }
    return { verdict: sets ? 1 : -3, sets };
  }

  const api = { parse, lower, link, evaluate, judge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SubleqCompiler = api;
})(typeof window !== 'undefined' ? window : this);
