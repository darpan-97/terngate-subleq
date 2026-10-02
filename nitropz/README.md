# nitropz, built

The compiler and VM this repository's programs are written for, as built from nitropz f565266
(2026-10-01): what `build.sh` compiles with, what runs the images in `images/`, and what the computer
compiles the gate model's gates with as it runs. MIT licensed: [LICENSE](LICENSE).

| file | what it is |
|---|---|
| `nitropz`, `nitropz.cmd` | the launcher, for sh and for Windows' cmd: `build`, `run`, `native` |
| `bin/nitropzvm-windows-x64.exe`, `bin/nitropzvm-linux-x64` | the VM, which runs an image (`.nitropzb`) |
| `bin/nitropzc.nitropzb` | the compiler, itself an image: nitropz source in, an image out |
| `bin/native.nitropzb`, `bin/runtime.nitropzb`, `bin/runtime.map` | an image made an executable of its own, for Windows or Linux on x64 |
| `lib/` | the 13 files of nitropz's library that these programs import |
