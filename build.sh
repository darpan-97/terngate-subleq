#!/bin/sh
# build.sh [OUT] -- the programs made executables of their own (machine code, no VM), in OUT (out/ unless
# named): train and pack, which teach the model and pack it; subleq_machine, the one-instruction computer
# built from the gates the gate model writes; subleq_corpus, the tasks and programs the model learns from;
# subleq_write, the model writing programs (its test, check, live and export); subleq_explore, the model
# trying programs of its own, for teaching itself. nitropz is looked for beside this folder (../nitropz)
# unless NITROPZ names it.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
P=${NITROPZ:-$HERE/../nitropz}
[ -x "$P/nitropz" ] || { echo "build.sh: no nitropz at $P (NITROPZ= names another)" >&2; exit 2; }
P=$(cd "$P" && pwd)
export NITROPZ_LIB="$P/lib:$HERE/lib:$HERE/core:$HERE/subleq"
OUT=${1:-$HERE/out}
mkdir -p "$OUT"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ext=.exe ;; *) ext= ;; esac
for prog in train pack; do
  "$P/nitropz" native "$HERE/core/$prog.nitropz" "$OUT/$prog$ext" || { echo "build.sh: core/$prog did not build" >&2; exit 1; }
  echo "$OUT/$prog$ext"
done
for prog in machine corpus write explore; do
  "$P/nitropz" native "$HERE/subleq/$prog.nitropz" "$OUT/subleq_$prog$ext" || { echo "build.sh: subleq/$prog did not build" >&2; exit 1; }
  echo "$OUT/subleq_$prog$ext"
done
