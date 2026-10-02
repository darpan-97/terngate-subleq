#!/bin/sh
# build.sh [OUT] -- the programs made executables of their own (machine code, no VM), in OUT (out/ unless
# named): train and pack, which teach the model and pack it; chances, every chance the model gives as its
# bits (what the playground's JavaScript is held to); subleq_machine, the one-instruction computer
# built from the gates the gate model writes; subleq_corpus, the tasks and programs the model learns from;
# subleq_write, the model writing programs (its test, check, live and export); subleq_explore, the model
# trying programs of its own, for teaching itself. subleq_write and subleq_machine are made images as well
# (OUT/subleq_write.nitropzb, OUT/subleq_machine.nitropzb), for check.sh to compare with the ones in
# images/. The compiler is the one in nitropz/ unless NITROPZ names another.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
P=${NITROPZ:-$HERE/nitropz}
[ -f "$P/nitropz" ] || { echo "build.sh: no nitropz at $P (NITROPZ= names another)" >&2; exit 2; }
P=$(cd "$P" && pwd)
export NITROPZ_LIB="$P/lib:$HERE/lib:$HERE/core:$HERE/subleq"
OUT=${1:-$HERE/out}
mkdir -p "$OUT"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ext=.exe ;; *) ext= ;; esac
for prog in train pack chances; do
  sh "$P/nitropz" native "$HERE/core/$prog.nitropz" "$OUT/$prog$ext" || { echo "build.sh: core/$prog did not build" >&2; exit 1; }
  echo "$OUT/$prog$ext"
done
for prog in machine corpus write explore; do
  sh "$P/nitropz" native "$HERE/subleq/$prog.nitropz" "$OUT/subleq_$prog$ext" || { echo "build.sh: subleq/$prog did not build" >&2; exit 1; }
  echo "$OUT/subleq_$prog$ext"
done
for prog in write machine; do
  sh "$P/nitropz" build "$HERE/subleq/$prog.nitropz" "$OUT/subleq_$prog.nitropzb" || { echo "build.sh: subleq/$prog's image did not build" >&2; exit 1; }
  echo "$OUT/subleq_$prog.nitropzb"
done
