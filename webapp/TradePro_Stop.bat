@echo off
REM ─── وقف سيرفر TradePro ──────────────────────────────────────
title إيقاف TradePro ERP
echo جاري إيقاف البرنامج...
taskkill /F /IM node.exe > nul 2>&1
echo تم الإيقاف.
timeout /t 2 > nul
