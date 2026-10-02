#!/bin/sh
# subleq/self_teach.sh START NAME KIND ROUNDS [TASKS [TRIES [STEPS [REPLAY [ALSO [HEAT [FLOOR [SHARE]]]]]]]]
# -- a model teaches itself tasks of KIND (as explore takes it: sums:4, words:5, ...) that it was never
# shown a program for. Each round: first its first try (its likeliest program) on 200 tasks of KIND kept
# back from all training, the same ones every round, and on 200 of each kind in ALSO (a list, as
# "sums:1-2 sums:3": what it could already do, to see it keep it); then it practises TASKS tasks of KIND
# (never kept-back ones), TRIES programs each (its likeliest, then drawn at a temperature of HEAT
# hundredths, 90 unless said, from every byte with at least 1/FLOOR of the likeliest's chance, 100
# unless said), the gate machine judges each, and the shortest right one joins a growing text of its
# own programs, every byte of a program weighted alike (focused, the copying would drown out what is
# new: where a program stops); then it trains STEPS steps on that text, twice over -- or, given SHARE,
# over and over until it is about SHARE bytes (200 times at most), so that a few programs found are not
# lost in the rest -- beside
# the first 150,000 bytes of REPLAY (the text it was taught, with its weights beside it as
# REPLAY_weights: data/x.txt, data/x_weights.txt). Nobody writes a program for it: only the machine says
# which of its own are right. START is a checkpoint; it says each round on out/st_NAME.log, and round
# r's model is out/st_NAME_r.ckpt. Needs build.sh's programs. SELF_TEACH_EXPLORE names the explorer in
# out/ (subleq_explore unless said) and SELF_TEACH_SIZE the model's size as train takes it (35k unless
# said).
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ext=.exe ;; *) ext= ;; esac
START=$1
NAME=$2
KIND=$3
ROUNDS=$4
TASKS=${5:-200}
TRIES=${6:-8}
STEPS=${7:-120}
REPLAY=${8:-}
ALSO=${9:-}
HEAT=${10:-90}
FLOOR=${11:-100}
SHARE=${12:-0}
EXPLORE=${SELF_TEACH_EXPLORE:-subleq_explore}
SIZE=${SELF_TEACH_SIZE:-35k}
LOG=out/st_$NAME.log
OWN=out/st_${NAME}_own.txt
OWN_WEIGHTS=out/st_${NAME}_own_weights.txt
MIX=out/st_${NAME}_mix.txt
MIX_WEIGHTS=out/st_${NAME}_mix_weights.txt
: > "$LOG"
: > "$OWN"
: > "$OWN_WEIGHTS"
if [ -n "$REPLAY" ]; then
  head -c 150000 "$REPLAY" > out/st_${NAME}_replay.txt
  head -c 150000 "${REPLAY%.txt}_weights.txt" > out/st_${NAME}_replay_weights.txt
else
  : > out/st_${NAME}_replay.txt
  : > out/st_${NAME}_replay_weights.txt
fi
cp "$START" out/st_${NAME}_0.ckpt
echo "self_teach $NAME: $KIND from $START, $ROUNDS rounds of $TASKS tasks x $TRIES tries, $STEPS steps each" >> "$LOG"
measure() {                          # measure ROUND: its first try on the kept-back tasks of each kind
  out/pack$ext out/st_${NAME}_$1.ckpt out/st_${NAME}_$1.tlm2 > /dev/null
  line="round $1, first try on kept-back tasks:"
  for kind in $KIND $ALSO; do
    said=$(out/$EXPLORE$ext out/st_${NAME}_$1.tlm2 "$kind" 200 1 out/st_${NAME}_eval.txt out/st_${NAME}_eval_weights.txt 0 1 | tail -1)
    line="$line $kind ${said##*; }"
  done
  echo "$line" >> "$LOG"
}
r=0
while [ "$r" -lt "$ROUNDS" ]; do
  measure $r
  found=$(out/$EXPLORE$ext out/st_${NAME}_$r.tlm2 "$KIND" "$TASKS" "$TRIES" out/st_${NAME}_new.txt out/st_${NAME}_new_weights.txt $((r * 1000003 + 17)) 0 0 "$HEAT" "$FLOOR" 0 | tail -1)
  echo "round $r, practising: $found" >> "$LOG"
  cat out/st_${NAME}_new.txt >> "$OWN"
  cat out/st_${NAME}_new_weights.txt >> "$OWN_WEIGHTS"
  times=2                            # its own programs, twice over, or over and over to SHARE bytes
  if [ "$SHARE" -gt 0 ]; then        #   (at most 200 times)
    times=$((SHARE / ($(wc -c < "$OWN") + 1) + 2))
    [ "$times" -gt 200 ] && times=200
  fi
  : > "$MIX"
  : > "$MIX_WEIGHTS"
  i=0
  while [ "$i" -lt "$times" ]; do
    cat "$OWN" >> "$MIX"
    cat "$OWN_WEIGHTS" >> "$MIX_WEIGHTS"
    i=$((i + 1))
  done
  cat out/st_${NAME}_replay.txt >> "$MIX"
  cat out/st_${NAME}_replay_weights.txt >> "$MIX_WEIGHTS"
  if [ "$(wc -c < "$MIX")" -lt 2000 ]; then
    echo "round $r: nothing of its own to learn from yet; the model stays as it was" >> "$LOG"
    cp out/st_${NAME}_$r.ckpt out/st_${NAME}_$((r + 1)).ckpt
  else
    out/train$ext "$SIZE" "$STEPS" 8 "$MIX" "$MIX" out/st_${NAME}_$((r + 1)).ckpt 10 out/st_${NAME}_$r.ckpt 320 "$MIX_WEIGHTS" > /dev/null 2> out/st_${NAME}_train.log
  fi
  r=$((r + 1))
done
measure $r
echo "self_teach $NAME ended" >> "$LOG"
