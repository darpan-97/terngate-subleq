#!/bin/sh
# check.sh -- the machine, the model and the images, each held to account (after sh build.sh):
#   1. the machine (out/subleq_machine): the gate model writes the five gates, each judged on its rows;
#      programs run on the gate machine and on a plain one and must agree step for step; and a copy with
#      one row of the carry gate wrong must come out different (it exits 1 if any of that fails);
#   2. the model (out/subleq_write): programs for tasks kept back from all its training, each run on the
#      gate machine and judged on 6 sets of inputs, must all be right: 150 sums, 4 products, 60 words;
#   3. tasks it cannot hold are refused, never cut to fit (a*b+c, a fifth part, a ninth letter);
#   4. the images in images/ are what the source compiles to now, byte for byte, and the one that writes
#      programs, run by nitropz's VM, writes the same program as the executable;
#   5. the binary files -- nitropz/bin, images, models -- are the ones SHA256SUMS lists. After changing
#      one on purpose: sha256sum -b nitropz/bin/* images/* models/* > SHA256SUMS;
#   6. the playground's two models, docs/program_model.js and docs/gate_model.js, are the model files,
#      byte for byte. After changing a model: its first line kept, its second remade by
#      printf 'window.PROGRAM_MODEL = "%s";\n' "$(base64 -w0 models/35k_subleq.tlm2)" (GATE_MODEL, 35k_gates);
#   7. the playground's JavaScript gives every chance the nitropz engine gives, bit for bit (out/chances),
#      and writes and runs what the nitropz programs do (subleq/page_check.js), when node is installed;
#      skipped, and said so, when it is not.
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

same=0
for prog in write machine; do cmp -s "out/subleq_$prog.nitropzb" "images/subleq_$prog.nitropzb" && same=$((same + 1)); done
out/subleq_write$ext live "prog r=d*b:" > out/check_live.txt 2>&1
sh nitropz/nitropz run images/subleq_write.nitropzb live "prog r=d*b:" > out/check_live_vm.txt 2>&1
if [ $same -eq 2 ] && grep -q "right on 6 sets of inputs" out/check_live.txt && cmp -s out/check_live.txt out/check_live_vm.txt; then
  pass "the images: both what the source compiles to, byte for byte; run by the VM, the same program as the executable"
elif [ $same -ne 2 ]; then fail "the images: $same of 2 are what the source compiles to (after sh build.sh: cp out/subleq_write.nitropzb out/subleq_machine.nitropzb images/)"
else fail "the images: run by the VM, not the same program as the executable (out/check_live.txt, out/check_live_vm.txt)"; fi

if sha256sum -c --quiet SHA256SUMS > out/check_sums.txt 2>&1; then
  pass "the binary files: all $(grep -c . SHA256SUMS) as SHA256SUMS lists them"
else fail "the binary files, not as SHA256SUMS lists them: $(tr -d '\r' < out/check_sums.txt | tr '\n' ' ')"; fi

same=0
for m in "program_model PROGRAM_MODEL 35k_subleq.tlm2" "gate_model GATE_MODEL 35k_gates.tlm2"; do
  set -- $m
  sed -n "s/^window\.$2 = \"\(.*\)\";\$/\1/p" "docs/$1.js" | base64 -d 2> /dev/null | cmp -s - "models/$3" && same=$((same + 1))
done
if [ $same -eq 2 ]; then pass "the playground's models: docs/program_model.js and docs/gate_model.js are the two model files, byte for byte"
else fail "the playground's models: $same of 2 are their model files (remake them as the top of check.sh says)"; fi

if command -v node > /dev/null 2>&1; then
  if node subleq/page_check.js > out/check_page.txt 2>&1; then pass "the playground's JavaScript: $(tail -n 1 out/check_page.txt)"
  else fail "the playground's JavaScript: $(tr '\n' ' ' < out/check_page.txt)"; fi
else echo "SKIP  the playground's JavaScript: no node here to run subleq/page_check.js"; fi

echo
[ $fails -eq 0 ] && { echo "all passed"; exit 0; }
echo "$fails FAILED"; exit 1
