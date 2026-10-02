# terngate-subleq

A tiny transformer that writes programs for a computer with one instruction, SUBLEQ, and that computer,
built from logic gates another tiny transformer wrote. Each has 34,976 parameters, reads and writes a byte
at a time, and has its layer weights each -1, 0 or +1; nitropz programs train and run them, on a CPU.

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

It runs on Windows and Linux, on x64. nitropz, the compiler and VM it is written for, comes with it, in
`nitropz/`. Run everything from this folder. To try it with nothing to build, run the programs' images
on nitropz's VM (on Windows, in Git Bash):

```
sh nitropz/nitropz run images/subleq_write.nitropzb live "prog print hello:"
sh nitropz/nitropz run images/subleq_machine.nitropzb
```

In cmd or PowerShell: `nitropz\nitropz.cmd run images\subleq_write.nitropzb live "prog print hello:"`.

For the test, the checks and teaching, build the programs as machine code, which takes a few seconds:

```
sh build.sh                                  # every program, made machine code, in out/
out/subleq_write live "prog r=c-d-e+b:"      # one program, written as you watch, then run
out/subleq_write                             # the model on tasks kept back from all its training
out/subleq_machine                           # the gate model writes five gates; the computer is built from them
bash check.sh                                # all of it checked, the playground's JavaScript too (with node)
```

On Windows the programs end in `.exe`. The model can be asked for a sum of 1 to 4 of the letters a to
e, each after the first with a + or - (`prog r=c-d-e+b:`), a product of two (`prog r=a*e:`), or a word
of 1 to 8 small letters (`prog print hello:`); anything else is refused.

To watch it, open [the playground](https://darpan-97.github.io/terngate-subleq/subleq.html). Both models
run there, in your browser: the gate model writes the five gates, the computer is built from them, and the
program model writes a program for the task you pick, which the computer then runs a step at a time. From
a clone, `docs/subleq.html` opens in a browser as it is.

## Documentation

- [The computer, and the model that programs it](docs/subleq.md): how the computer is built from the
  gate model's gates, what the model is shown, how many programs it writes right, how it was taught,
  and how it teaches itself
- [The SUBLEQ playground](https://darpan-97.github.io/terngate-subleq/subleq.html) (`docs/subleq.html`):
  the models run by `docs/subleq_engine.js`, a JavaScript port of the nitropz engine that gives every
  chance it gives, bit for bit (`check.sh` holds it to that)

## Files

| file | what it is |
|---|---|
| `subleq/subleq_lib.nitropz` | the computer, its working parts the gate model's five gates; an assembler; the tasks, the template the model is shown for each, and the judge |
| `subleq/machine.nitropz` | the gate model writing the five gates as you watch, and the computer built from them checked against a plain one |
| `subleq/write.nitropz` | the model writing programs: its test, `check`, `live` and `export` |
| `subleq/corpus.nitropz` | the tasks and programs the model learns from |
| `subleq/teach.sh` | how the model was taught: three stages from the gate model's checkpoint, about two hours |
| `subleq/explore.nitropz`, `subleq/self_teach.sh` | the model trying programs of its own, and teaching itself from the ones the computer judges right |
| `subleq/page_check.js` | the playground's JavaScript held to the nitropz programs: every chance bit for bit, the gates, the programs and every step |
| `core/` | the transformer: forward and back (`model`), training (`train`, `optimize`), packing (`pack`), the engine that runs a packed model (`engine`), choosing each byte (`sample`), every chance as its bits (`chances`) |
| `lib/` | float maths, and the gate judge: a gate written as nitropz, run on every row of its truth table |
| `models/` | `35k_subleq.tlm2`, the model; `35k_gates.tlm2`, the gate model; `35k_gates.ckpt`, the gate model's checkpoint, which teaching starts from |
| `images/` | `subleq_write` and `subleq_machine` compiled to images, to run with nothing to build |
| `nitropz/` | nitropz, built: the VM, the compiler, and the part of its library these programs use ([what is in it](nitropz/README.md)) |
| `docs/` | the page above; the playground (`subleq.html`), its engine (`subleq_engine.js`), and the two models as scripts (`program_model.js`, `gate_model.js`) |

`build.sh`, `check.sh`, `par.sh` (training on several cores), `SHA256SUMS` and `LICENSE` are at the top.

## Checking the files

`SHA256SUMS` lists the binary files -- nitropz's VMs and compiler, the two images, the models -- and
`sha256sum -c SHA256SUMS` checks them; `check.sh` does too. A clone is checked by git as well: every
file is held to its commit, so the commit hash (`git rev-parse HEAD`) names exactly what you have.

## License

MIT: [LICENSE](LICENSE). nitropz, in `nitropz/`, is MIT licensed too: [nitropz/LICENSE](nitropz/LICENSE).
