#!/bin/sh
# check.sh -- the machine and the model, each held to account (after sh build.sh):
#   1. the machine (out/subleq_machine): the gate model writes the five gates, each judged on its rows;
#      programs run on the gate machine and on a plain one and must agree step for step; and a copy with
#      one row of the carry gate wrong must come out different (it exits 1 if any of that fails);
#   2. the model (out/subleq_write): programs for tasks kept back from all its training, each run on the
#      gate machine and judged on 6 sets of inputs, must all be right: 150 sums, 4 products, 60 words;
#   3. tasks it cannot hold are refused, never cut to fit (a*b+c, a fifth part, a ninth letter).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ext=.exe ;; *) ext= ;; esac
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }
mkdir -p out

if out/subleq_machine$ext > out/check_machine.txt 2>&1; then
  pass "the machine: $(grep -c 'the same as the plain machine' out/check_machine.txt) programs the same as the plain machine, step for step; $(grep 'control:' out/check_machine.txt | sed 's/^control: //')"
else fail "the machine: $(tail -n 3 out/check_machine.txt | tr '\n' ' ')"; fi

out/subleq_write$ext > out/check_write.txt 2>&1
kept=$(sed -n '/never taught/,/^$/p' out/check_write.txt | tr -d '\r')
if echo "$kept" | grep -q "sums: 150 of 150 right" && echo "$kept" | grep -q "products: 4 of 4 right" && echo "$kept" | grep -q "words: 60 of 60 right"; then
  pass "the model, on tasks kept back from all its training: 150 of 150 sums, 4 of 4 products, 60 of 60 words"
else fail "the model, on tasks kept back: $(echo "$kept" | tr '\n' ' ')"; fi

refused=0
for t in "prog r=a*b+c:" "prog r=a+b+c+d+e:" "prog print terngates:"; do
  out/subleq_write$ext live "$t" 2>&1 | grep -q "not a task it can be asked" && refused=$((refused + 1))
done
if [ $refused -eq 3 ]; then pass "tasks it cannot hold, refused: 3 of 3"; else fail "tasks it cannot hold, refused: $refused of 3"; fi

echo
[ $fails -eq 0 ] && { echo "all passed"; exit 0; }
echo "$fails FAILED"; exit 1
