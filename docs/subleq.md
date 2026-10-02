# The computer, and the model that programs it

Programs for a one-instruction computer built from the gate model's gates, and a model teaching itself. [Back to the README](../README.md). To watch it: [the SUBLEQ playground](https://darpan-97.github.io/terngate-subleq/subleq.html), where both models run in your browser: the gate model writes the five gates, the computer is built from them, and the program model writes programs for it, run a step at a time.

A computer with one instruction, SUBLEQ a b c: take what is at a from what is at b, and if that leaves
0 or less, go to c, else to the next instruction. Given memory enough, that one instruction can compute
anything a computer can. `out/subleq_machine` builds one from nothing but gates the gate model writes:
it asks the model, as you watch, for five -- NOT, OR, the full adder's sum and carry, and "choose"
(a ? c : b) -- judges each on its truth table, and checks that each is, byte for byte, the gate the
machine is built from. From those alone come a 16-bit subtractor, the "0 or less" test, the step to the
next instruction and the jump: 114 gates a step. It runs a greeting, a countdown, two multiplications
and two Fibonacci numbers, each the same as on a plain machine; with one row of the carry gate wrong,
they come out different.

The model, taught to program that machine (`models/35k_subleq.tlm2`), writes the programs.
`out/subleq_write live "prog r=c-d-e+b:"`:

```
    l0: c z
    z r
    z z
    l1: d r
    z z
    z z
    l2: e r
    z z
    z z
    l3: b z
    z r
    z z
    z z -1
  => run on the gate machine, 13 steps: r = 1690 -- right on 6 sets of inputs
```

Each line is one instruction, "first second [where]": `d r` takes d from r. `z` is a cell holding 0
and `r` the answer, so `c z`, `z r`, `z z` adds c to r (z = -c, then r = r - z, then z = 0 again), and
`z z -1` stops. Asked for a product, `prog r=c*d:`, it writes a loop (the notes are not the model's):

```
    l1: z d l9        if d is 0 or less, go to l9
    one d             d = d - 1
    l0: c z           z = -c
    z r               r = r + c
    z z l1            z = 0, and back to l1
    l9: z z -1        stop
  => run on the gate machine, 52 steps: r = 7380 -- right on 6 sets of inputs
```

and asked `prog print hello:`, a line a letter, each `'h out` printing the cell that holds h. The judge
(`subleq/subleq_lib.nitropz`) assembles what the model wrote, runs it on the gate machine with six sets
of random inputs (a product's count from 0 to 20), and checks r, or what was printed.

The model is not shown the task as it is written. It is shown a template laid out the way the program
it asks for is laid out, every letter the program must copy standing the same distance above the place
it goes: a sum's parts 12 lines up, each part's three lines of program under its three lines of
template; a word's letters and a product's two letters 8 lines up, 15 bytes a line. A minus part needs
one line, not three; two lines that do nothing (`z z`) keep the distance.

Asked for a quotient, `prog r=e/b:`, the whole number of times b goes into e, it writes another loop:

```
    l0: one z         z = -1
    z e               e = e + 1, so that "0 or less" below means b did not fit
    z z               z = 0
    l1: b e l9        e = e - b; if that is 0 or less, go to l9
    one z             z = -1
    z r               r = r + 1
    z z l1            z = 0, and back to l1
    l9: z z -1        stop
  => run on the gate machine, 13 steps (e = 13, b = 5): r = 2
```

| tasks, each the model's first try | right |
|---|---|
| sums of 1 to 4 parts kept back from all training | 150 of 150 |
| products kept back from all training (`a*e`, `c*a`, `d*b`, `e*c`) | 4 of 4 |
| words to print kept back from all training | 60 of 60 |
| quotients kept back from all training (`b/a`, `d/c`, `e/b`, `a/d`) | 4 of 4 |
| sums, products, words and quotients of the kinds taught, from another seed | 150, 16, 60 and 16, all |
| every sum there is (5,555), every product and every quotient of two different letters (20 each) | all |
| every word of 1 or 2 letters (702), and 300 drawn of each length from 3 to 8 | all |

A product or a quotient of one letter with itself is refused: the loop counts down the cell it works on.

It was taught in four stages (`subleq/teach.sh`), from the gate model:

1. 1,200 steps on 6,000 words to print. A model learns the shape of the lines first and the copying
   much later, all at once: here near step 800.
2. 1,200 steps on 6,000 sums, from stage 1's model, each letter the program copies weighted 9 and the
   rest of it 1. Already copying, and its copying weighted heavily, it wrote every sum of the check
   right after 240 steps. With every byte alike it took 600, and from a model taught products instead
   of words it never wrote half of them right.
3. 1,200 steps on sums, words and products together, from that save. Every product of the check came
   right by step 240, and every one of the 196 programs of the check at steps 960 and 1,080.
4. 1,200 steps on all four kinds, quotients added, from the model of stage 3: 6 minutes here. 208 of
   the check's 212 programs came right by step 120, and all 212 at steps 720, 1,080 and 1,200; the model
   is the last.

Before the templates, the model was shown each task's parts in a numbered list, as `# 0:+a 1:-c`. It
learned where in the list a part was, and the sign there, but by step 750 it still copied letters no
better than by chance. Products kept the list form longest: a model taught products alone learned them
that way, but taught them beside sums and words, it copied the letter on the line just below its
source and guessed, nearly evenly over a to e, the one four lines further, through three runs of 1,200
steps and 300 more on products alone. Moving that line up beside its source made it right, and the
other letter, now further off, the guess. A template holding each letter exactly where words hold
theirs made products the quickest of the three.

### The compiler

The model writes one step at a time. `out/subleq_compile` (`subleq/compile.nitropz`) takes more: + - *
/ % and brackets over a to e and whole numbers, as `r = (a + b) * c - 3`. Ordinary code breaks the
expression into steps the model has been taught -- sums of up to 4 parts, products, quotients -- each
into a cell of its own; the model writes every step's program after its template; ordinary code renames
each program (its letters to the step's cells, r to the step's result, its labels to labels of its own)
and joins them, each step's stop made "go on":

```
  t1 = a + b               prog r=a+b:
  t2 = c                   prog r=a:
  t3 = t1 * t2             prog r=a*b:
  r = t3 - k1              prog r=a-b:
```

A product counts its right side down to 0 and a quotient its left side, so a letter or a number there is
first copied into a cell of its own (`t2 = c`), which is also how a square works; a remainder is
x - y * (x / y); a number is a cell given its value before the program starts (`= k1 3`). Every
instruction of the joined program is the model's.

`out/subleq_compile measure 1000` draws 1,000 expressions of 1 to 4 operators over a to e and the
numbers 0 to 9, compiles each and judges it on 6 sets of inputs from 0 to 20: 964 right and none wrong.
The other 36 have no such inputs that keep every step inside what the machine does -- it multiplies and
divides by counting down, so a number it counts must not be below 0, and a divisor must be above 0;
every value stays from -32768 to 32767. The right ones took 4 steps on average and 14 at most.

### Teaching itself

A model can teach itself what it can already sometimes do. It tries tasks it was never shown a program
for, several programs each; the machine says which are right; it learns from those alone, beside a
little of what it was taught (`subleq/self_teach.sh`). Nobody writes a program for it. It can only find
what it already rates likely enough to try: the sampler never draws a byte with less than 1/100 of the
likeliest's chance.

**Longer sums.** A model taught only sums of 1 or 2 parts wrote sums of 3 parts right as well, though it
had never seen one: 200 of 200 kept back, at one save. Sums of 4 it never did. It decides whether
another part comes by looking 12 lines up at the template; a sum of 4 fills all four slots, so after the
fourth part there is no empty slot to stop at, and it reads its own first line there and copies on.

Practising sums of 3 and 4 parts at once, it wrote every 3-part sum right after one round and lost the
4-part ones it had (35 of 200, then none): it found far more 3-part programs than 4-part ones, and
learned what it found. Practising 4-part sums alone, with every byte of its own programs weighted alike
(weighted for copying, the one place where it stops counts for little), it found a right program for
42 of 200 tasks in 1,600 tries, and then:

| round | sums of 4, first try | of 3 | of 1 or 2 (taught) |
|---|---|---|---|
| 0 | 0 of 200 | 200 | 200 |
| 1 | 105 | 200 | 200 |
| 2 | 200 | 200 | 200 |
| 3 | 200 | 200 | 200 |

It labels its third and fourth parts `l1` as well, since no program it was taught had more than two;
labels only name lines to jump to, and a sum has no jumps, so the machine does not mind.

**Longer words.** A model taught words of 1 to 4 letters wrote no word of 5 or 7 letters right, and 42
of 200 of 6 and of 8. One round of teaching itself on words of 5 to 8 letters, and every 5-, 6- and
8-letter word came right; 7-letter ones stayed at none. Its stop after a 7th letter had a chance of
0.46% and 0.14% on two words measured, under 1/100 of going on's, so it was never drawn.

Drawing instead from bytes down to 1/1000 of the likeliest's chance, at a temperature of 1, and one
length at a time, it taught itself 5 letters in a round, and 6 came with them. At 7 it found 1 right
program in 3,200 tries; learning from that one, it found 25 the next round, and its first try reached
7 of 200. Then learning 8 letters took those 7 back: what it learns is a habit at each line more than a
reading of the template's blank slots, and an 8-letter word goes on where a 7-letter one stops.

Starting again from where it knew 6 letters, with 32 tries a task and the few programs it found
repeated until they made 60,000 bytes:

| round | words of 7, first try | tasks it found a right program for, practising |
|---|---|---|
| 0 | 0 of 200 | 7 of 200 |
| 1 | 8 | 145 |
| 2 | 200 | |

keeping every 5- and 6-letter word. Then, practising 7 and 8 letters together, with programs of its
own that stop after the 7th letter and programs that go on to learn from side by side, it found right
ones for 121, then 194, of 200 tasks, and after two rounds wrote every word of every length from 1 to
8 letters right, 200 of 200 of each length, though it was shown words of 1 to 4.

**Shorter programs.** Keeping the shortest right program of eight, and learning from those alone, the
sums model shortened its first try from 130 bytes to 118 in six rounds. It found that the two lines
after a last minus part do nothing, and dropped them; it kept the ones between parts, which hold every
later letter at its distance. It also got 191 sums of 200 right, not 200: learning only from itself,
with nothing it was taught beside, it drifts.
