@echo off
rem nitropz.cmd -- compile and run nitropz programs with this compiler, on the VM in bin\ (Windows).
rem
rem   nitropz build prog.nitropz [out.nitropzb]  compile it (to prog.nitropzb unless named)
rem   nitropz run prog.nitropz [args...]         compile it, then run it
rem   nitropz run prog.nitropzb [args...]        run an image already compiled
rem   nitropz vm prog.nitropzb [args...]         the VM itself (the same as run, for an image)
rem   nitropz native prog.nitropz [out]          compile it to an executable of its own, no VM --
rem                                              for Windows x64, prog.exe unless named; a name
rem                                              without .exe makes one for Linux
setlocal
set "HERE=%~dp0"
if not defined NITROPZ_LIB set "NITROPZ_LIB=%HERE%lib;%HERE%base"
set "VM=%HERE%bin\nitropzvm-windows-x64.exe"
if /i "%~1"=="build" goto build
if /i "%~1"=="run" goto run
if /i "%~1"=="vm" goto vm
if /i "%~1"=="native" goto native
echo usage: nitropz build prog.nitropz [out.nitropzb] ^| nitropz run prog.nitropz [args...] ^| nitropz vm prog.nitropzb [args...] ^| nitropz native prog.nitropz [out] 1>&2
exit /b 2

:build
if "%~2"=="" (echo usage: nitropz build prog.nitropz [out.nitropzb] 1>&2 & exit /b 2)
set "OUT=%~3"
if "%OUT%"=="" set "OUT=%~dpn2.nitropzb"
if exist "%OUT%" del "%OUT%"
"%VM%" "%HERE%bin\nitropzc.nitropzb" "%~2" "%OUT%"
if not exist "%OUT%" exit /b 1
exit /b 0

:run
if "%~2"=="" (echo usage: nitropz run prog.nitropz [args...] 1>&2 & exit /b 2)
if /i not "%~x2"==".nitropz" goto run_image
set "IMG=%TEMP%\nitropz-%RANDOM%%RANDOM%.nitropzb"
"%VM%" "%HERE%bin\nitropzc.nitropzb" "%~2" "%IMG%"
if not exist "%IMG%" exit /b 1
set "PROG=%~2"
shift
shift
set "ARGS="
:collect
if "%~1"=="" goto run_it
set ARGS=%ARGS% %1
shift
goto collect
:run_it
"%VM%" "%IMG%"%ARGS%
set "RC=%ERRORLEVEL%"
del "%IMG%"
exit /b %RC%

:run_image
set "IMG=%~2"
shift
shift
set "ARGS="
:collect_image
if "%~1"=="" goto run_image_it
set ARGS=%ARGS% %1
shift
goto collect_image
:run_image_it
"%VM%" "%IMG%"%ARGS%
exit /b %ERRORLEVEL%

:native
if "%~2"=="" (echo usage: nitropz native prog.nitropz [out] 1>&2 & exit /b 2)
set "OUT=%~3"
if "%OUT%"=="" set "OUT=%~dpn2.exe"
set "IMG=%TEMP%\nitropz-%RANDOM%%RANDOM%.nitropzb"
"%VM%" "%HERE%bin\nitropzc.nitropzb" "%~2" "%IMG%"
if not exist "%IMG%" exit /b 1
if exist "%OUT%" del "%OUT%"
"%VM%" "%HERE%bin\native.nitropzb" "%IMG%" "%HERE%bin\runtime.nitropzb" "%HERE%bin\runtime.map" "%OUT%"
set "RC=%ERRORLEVEL%"
del "%IMG%"
if not exist "%OUT%" exit /b 1
exit /b %RC%

:vm
shift
set "ARGS="
:collect_vm
if "%~1"=="" goto vm_it
set ARGS=%ARGS% %1
shift
goto collect_vm
:vm_it
"%VM%"%ARGS%
exit /b %ERRORLEVEL%
