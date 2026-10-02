# terngate-subleq

A small language model that writes programs for a computer with one instruction, SUBLEQ, and that
computer, built from logic gates another small language model wrote. Both are transformers of 34,976
parameters that read and write a byte at a time, the weights of their layers each -1, 0 or +1; nitropz
programs train and run them, on a CPU.

```
$ out/subleq_write live "prog r=d*b:"
prog product:
    #     b
    #   b
    #   d
    #
    #
    #
    #
    #
    l1: z b l9          if b is 0 or less, go to l9
    one b               b = b - 1
    l0: d z             z = -d
    z r                 r = r + d
    z z l1              z = 0, and back to l1
    l9: z z -1          stop
  => run on the gate machine, 52 steps: r = -6560 -- right on 6 sets of inputs
```

The `#` lines are what the model is shown, each letter its program copies 8 lines above the place it
goes; it writes the rest. The notes on the right are not the model's. Each line is one instruction,
SUBLEQ a b c: take what is at a from what is at b, and if that leaves 0 or less, go to c, else on to
the next line.

## Getting started

It needs nitropz beside this folder, at `../nitropz` (or named by `NITROPZ=`). The trained models are
in `models/`, so nothing needs training first:

```
sh build.sh                                  # the programs, made machine code, in out/
out/subleq_write live "prog print hello:"    # one program, written as you watch, then run
out/subleq_write                             # the model on tasks kept back from all its training
out/subleq_machine                           # the gate model writes five gates; the computer is built from them
bash check.sh                                # the computer and the model, each checked
```

On Windows the programs end in `.exe`. The model can be asked for a sum of 1 to 4 of the letters a to
e, each after the first with a + or - (`prog r=c-d-e+b:`), a product of two (`prog r=a*e:`), or a word
of 1 to 8 small letters (`prog print hello:`); anything else is refused.

To watch it, open `docs/subleq.html` in a browser: pick a task, see the program the model wrote, and
step through it on the gate machine, every memory cell and every step explained.

## Documentation

- [The computer, and the model that programs it](docs/subleq.md): how the computer is built from the
  gate model's gates, what the model is shown, how many programs it writes right, how it was taught,
  and how it teaches itself
- [The SUBLEQ playground](docs/subleq.html); its data, `docs/subleq_data.js`, is made by
  `out/subleq_write export`

## Files

| file | what it is |
|---|---|
| `subleq/subleq_lib.nitropz` | the computer, its working parts the gate model's five gates; an assembler; the tasks, the template the model is shown for each, and the judge |
| `subleq/machine.nitropz` | the gate model writing the five gates as you watch, and the computer built from them checked against a plain one |
| `subleq/write.nitropz` | the model writing programs: its test, `check`, `live` and `export` |
| `subleq/corpus.nitropz` | the tasks and programs the model learns from |
| `subleq/teach.sh` | how the model was taught: three stages from the gate model's checkpoint, about two hours |
| `subleq/explore.nitropz`, `subleq/self_teach.sh` | the model trying programs of its own, and teaching itself from the ones the computer judges right |
| `core/` | the language model: forward and back (`model`), training (`train`, `optimize`), packing (`pack`), the engine that runs a packed model (`engine`), choosing each byte (`sample`) |
| `lib/` | float maths, and the gate judge: a gate written as nitropz, run on every row of its truth table |
| `models/` | `35k_subleq.tlm2`, the model; `35k_gates.tlm2`, the gate model; `35k_gates.ckpt`, the gate model's checkpoint, which teaching starts from |
| `docs/` | the page above, and the playground |

`build.sh`, `check.sh` and `par.sh` (training on several cores) are at the top.
