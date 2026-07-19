@echo off
cd /d "%~dp0"
echo START %date% %time% > setup.log
call npm install >> setup.log 2>&1
echo INSTALL_DONE %date% %time% >> setup.log
call npm run dev >> setup.log 2>&1
