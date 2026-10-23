@echo off
rem -- serve the UI for local development (no build step, no backend needed)
set PORT=8400
if "%2"=="" ( set PORT=8400 ) else ( set PORT=%2 )
if "%1"=="" goto run
set PORT=%1
:run
where python >/nul 2>nul
if %errorlevel%==0 (
  pushd ui && python -m http.server %PORT% && popd & exit /b 0
)
echo python not found - falling back to npx serve
pushd ui && npx -y serve -l %PORT% . && popd
