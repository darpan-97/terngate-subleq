#!/bin/sh
# subleq/teach.sh [OUT [STAGE3]] -- the model that writes programs for the one-instruction computer, taught
# from the gate model's checkpoint (models/35k_gates.ckpt: the 35k language model taught to write logic
# gates) as OUT (models/35k_subleq.tlm2 unless named, and its checkpoint beside it, .ckpt), in four stages,
# every one on tasks and programs written as subleq/corpus.nitropz writes them, a view of 320 bytes, each
# byte weighted:
#   1. 1,200 steps on 6,000 words to print: each line of the program copies one letter of the word from
#      the template 8 lines above it. Learning to copy comes suddenly, hundreds of steps after the
#      lines' shape: on this text, near step 800;
#   2. 1,200 steps on 6,000 sums of 1 to 4 parts, from stage 1's model, with each letter a program
#      copies weighted 9 and the rest of the program 1 ("focused"). A model that already copies, its
#      copying weighted heavily, learns sums in 240 steps; with every byte of the program alike it took
#      600, and from a model taught products instead of words it never wrote half of them right;
#   3. 1,200 steps on all three kinds at once -- those sums, those words, and 4,000 products, twice
#      over -- from the first save of stage 2 that writes every sum of the check right, focused. A
#      product's template holds each letter its program copies 8 lines above it, as a word's does:
#      shown the two letters in a list instead, the model never learned to copy the one that sits
#      four lines further from it (its chances there spread nearly evenly over a to e);
#   4. 1,200 steps on all four kinds -- those three, and 4,000 quotients, twice over -- from the model
#      of stage 3, focused. A quotient's template holds its two letters 8 lines above where the program
#      copies them, as a product's does.
# Every save of stages 2 to 4 is kept; the model of stage 3, and then the model, is the latest save of
# its stage that writes the most of the 212 programs of `subleq_write check` right (120 sums, 16
# products, 60 words, 16 quotients, seed 7, none of the tasks kept back for testing). Given STAGE3, a
# checkpoint of stage 3's model (the one models/35k_subleq.ckpt held before quotients), it starts at
# stage 4 from it. Training and choosing are the same every run, so from the same checkpoint this makes
# the same model every time. Needs build.sh's programs in out/; stage 4 took 6 minutes here, choosing
# among its saves included.
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ext=.exe ;; *) ext= ;; esac
OUT=${1:-models/35k_subleq.tlm2}
STAGE3=${2:-}
[ -s models/35k_gates.ckpt ] || { echo "subleq/teach.sh: no models/35k_gates.ckpt" >&2; exit 2; }
mkdir -p data
out/subleq_corpus$ext held 150 data/subleq_valid.txt data/subleq_valid_weights.txt
out/subleq_corpus$ext words 6000 data/subleq_words.txt data/subleq_words_weights.txt
out/subleq_corpus$ext sums 6000 data/subleq_sums.txt data/subleq_sums_weights.txt focused
out/subleq_corpus$ext words 6000 data/subleq_words.txt data/subleq_words_focused.txt focused
out/subleq_corpus$ext products 4000 data/subleq_products.txt data/subleq_products_weights.txt focused
out/subleq_corpus$ext quotients 4000 data/subleq_quotients.txt data/subleq_quotients_weights.txt focused

pick() {                             # pick STAGE: its latest save writing the most of the check right
  best=""
  best_right=-1
  for save in $(ls out/subleq$1.ckpt.* | sort -t. -k3 -n); do
    out/pack$ext "$save" out/subleq$1.pick.tlm2 > /dev/null
    right=$(out/subleq_write$ext out/subleq$1.pick.tlm2 check | tail -1 | cut -d' ' -f1)
    echo "subleq/teach.sh: $save writes $right of the 212 programs right"
    if [ "$right" -ge "$best_right" ]; then best=$save; best_right=$right; fi
  done
}

if [ -z "$STAGE3" ]; then
  out/train$ext 35k 1200 8 data/subleq_words.txt data/subleq_valid.txt out/subleq1.ckpt 30 models/35k_gates.ckpt 320 data/subleq_words_weights.txt

  rm -f out/subleq2.ckpt.*
  out/train$ext 35k 1200 8 data/subleq_sums.txt data/subleq_valid.txt out/subleq2.ckpt 20 out/subleq1.ckpt 320 data/subleq_sums_weights.txt keep
  first=""
  for save in $(ls out/subleq2.ckpt.* | sort -t. -k3 -n); do
    out/pack$ext "$save" out/subleq2.pick.tlm2 > /dev/null
    sums=$(out/subleq_write$ext out/subleq2.pick.tlm2 check | grep "sums:" | sed 's/.*sums: \([0-9]*\) of.*/\1/')
    echo "subleq/teach.sh: $save writes $sums of the 120 sums right"
    if [ "$sums" -eq 120 ] && [ -z "$first" ]; then first=$save; fi
  done
  [ -n "$first" ] || { echo "subleq/teach.sh: no save of stage 2 writes every sum right" >&2; exit 1; }
  echo "subleq/teach.sh: stage 3 goes on from $first"

  cat data/subleq_sums.txt data/subleq_words.txt data/subleq_products.txt data/subleq_products.txt > data/subleq_all.txt
  cat data/subleq_sums_weights.txt data/subleq_words_focused.txt data/subleq_products_weights.txt data/subleq_products_weights.txt > data/subleq_all_weights.txt
  rm -f out/subleq3.ckpt.*
  out/train$ext 35k 1200 8 data/subleq_all.txt data/subleq_valid.txt out/subleq3.ckpt 20 "$first" 320 data/subleq_all_weights.txt keep
  pick 3
  STAGE3=$best
fi
cp "$STAGE3" out/subleq3_model.ckpt
echo "subleq/teach.sh: stage 4 goes on from $STAGE3"

cat data/subleq_sums.txt data/subleq_words.txt data/subleq_products.txt data/subleq_products.txt data/subleq_quotients.txt data/subleq_quotients.txt > data/subleq_all4.txt
cat data/subleq_sums_weights.txt data/subleq_words_focused.txt data/subleq_products_weights.txt data/subleq_products_weights.txt data/subleq_quotients_weights.txt data/subleq_quotients_weights.txt > data/subleq_all4_weights.txt
rm -f out/subleq4.ckpt.*
out/train$ext 35k 1200 8 data/subleq_all4.txt data/subleq_valid.txt out/subleq4.ckpt 20 out/subleq3_model.ckpt 320 data/subleq_all4_weights.txt keep
pick 4
echo "subleq/teach.sh: the model is $best"
cp "$best" "${OUT%.tlm2}.ckpt"               # the checkpoint, to teach it more from
out/pack$ext "$best" "$OUT"
