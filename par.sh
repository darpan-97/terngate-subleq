#!/bin/sh
# par.sh N SIZE STEPS BATCH TRAIN VALID OUT [...] -- out/train, each step's BATCH windows shared among N
# worker processes (N from 1 to BATCH: as many as the machine has cores to spare). The lead says and
# saves as out/train does, and the model is the same, to the last bit, whatever N is -- though not the
# same as out/train alone makes, whose sum of a step's gradients is added up in another order. The
# workers meet in a folder of files, out/par.PID: emptied first, removed after (kept if the run fails).
# TRAIN_PROGRAM names another build of train to run.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ext=.exe ;; *) ext= ;; esac
TRAIN=${TRAIN_PROGRAM:-out/train$ext}
[ $# -ge 7 ] || { echo "par.sh N SIZE STEPS BATCH TRAIN VALID OUT [...]" >&2; exit 2; }
N=$1
shift
DIR=out/par.$$
rm -rf "$DIR"
mkdir -p "$DIR"
k=0
while [ "$k" -lt "$N" ]; do
  TRAIN_ROLE=$k TRAIN_WORKERS=$N TRAIN_DIR=$DIR "$TRAIN" "$@" > "$DIR/worker$k.log" 2>&1 &
  k=$((k + 1))
done
TRAIN_ROLE=lead TRAIN_WORKERS=$N TRAIN_DIR=$DIR "$TRAIN" "$@"
status=$?
wait
if [ "$status" -eq 0 ]; then rm -rf "$DIR"; else echo "par.sh: the lead stopped ($status); the workers' logs are in $DIR" >&2; fi
exit "$status"
