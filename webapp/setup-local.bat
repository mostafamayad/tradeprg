@echo off
chcp 65001 > nul
title TradePro ERP - تثبيت النظام
color 0A

echo.
echo  ================================================
echo    TradePro ERP - تثبيت وإعداد النظام
echo    نسخة المحلي - Local Edition
echo  ================================================
echo.

SET APP_DIR=%~dp0
SET NODE_DIR=%APP_DIR%backend
SET SQL_INSTALLER=%APP_DIR%tools\SQLEXPR_x64_ENU.exe

REM ─── الخطوة 1: التحقق من Node.js ───────────────────────────────
echo [1/4] التحقق من تثبيت Node.js...
node --version > nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [!] Node.js غير موجود. يرجى تثبيت Node.js أولاً من:
    echo     https://nodejs.org
    echo.
    echo     بعد التثبيت، قم بتشغيل هذا الملف مرة أخرى.
    pause
    exit /b 1
)
echo [✓] Node.js موجود.
echo.

REM ─── الخطوة 2: التحقق من SQL Server Express ─────────────────────
echo [2/4] التحقق من SQL Server Express...
sc query "MSSQL$SQLEXPRESS" > nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [!] SQL Server Express غير موجود. جاري التثبيت التلقائي...
    IF EXIST "%SQL_INSTALLER%" (
        echo     جاري التثبيت (قد يستغرق بضع دقائق)...
        "%SQL_INSTALLER%" /Q /IACCEPTSQLSERVERLICENSETERMS /ACTION=install /FEATURES=SQL /INSTANCENAME=SQLEXPRESS /SECURITYMODE=SQL /SAPWD="TradePro@2024" /SQLSVCACCOUNT="NT AUTHORITY\SYSTEM" /BROWSERSVCSTARTUPTYPE=Automatic /TCPENABLED=1 > "%APP_DIR%sql_install.log" 2>&1
        IF %ERRORLEVEL% NEQ 0 (
            echo [X] فشل تثبيت SQL Server. راجع ملف sql_install.log
            pause
            exit /b 1
        )
        echo [✓] تم تثبيت SQL Server Express بنجاح.
    ) ELSE (
        echo [!] ملف تثبيت SQL Server غير موجود في مجلد tools\
        echo     يرجى وضع ملف SQLEXPR_x64_ENU.exe في مجلد tools\
        echo     أو تثبيت SQL Server Express 2022 يدوياً.
        echo     رابط التحميل: https://www.microsoft.com/en-us/sql-server/sql-server-downloads
        pause
        exit /b 1
    )
) ELSE (
    echo [✓] SQL Server Express موجود ويعمل.
)
echo.

REM ─── الخطوة 3: تثبيت مكتبات Node.js ────────────────────────────
echo [3/4] تثبيت مكتبات البرنامج (npm install)...
cd /d "%NODE_DIR%"
IF NOT EXIST "node_modules" (
    call npm install --silent
    IF %ERRORLEVEL% NEQ 0 (
        echo [X] فشل تثبيت المكتبات. تحقق من اتصال الإنترنت.
        pause
        exit /b 1
    )
)
echo [✓] المكتبات جاهزة.
echo.

REM ─── الخطوة 4: إنشاء أيقونة سطح المكتب ─────────────────────────
echo [4/4] إنشاء أيقونة البرنامج على سطح المكتب...

SET LAUNCHER=%APP_DIR%TradePro_Launcher.vbs
SET SHORTCUT_PATH=%USERPROFILE%\Desktop\TradePro ERP.lnk

powershell -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$s = $ws.CreateShortcut('%SHORTCUT_PATH%');" ^
  "$s.TargetPath = 'wscript.exe';" ^
  "$s.Arguments = '\"%LAUNCHER%\"';" ^
  "$s.Description = 'TradePro ERP - نظام إدارة تجاري متكامل';" ^
  "$s.WorkingDirectory = '%APP_DIR%';" ^
  "$s.Save()"

IF %ERRORLEVEL% EQ 0 (
    echo [✓] تم إنشاء الأيقونة على سطح المكتب.
) ELSE (
    echo [!] لم يتم إنشاء الأيقونة، يمكنك تشغيل TradePro_Launcher.vbs مباشرة.
)

echo.
echo  ================================================
echo    [✓] اكتمل التثبيت بنجاح!
echo.
echo    لتشغيل البرنامج: اضغط على أيقونة "TradePro ERP"
echo    على سطح المكتب، أو شغّل:
echo    TradePro_Launcher.vbs
echo.
echo    سيفتح المتصفح تلقائياً على البرنامج.
echo  ================================================
echo.
pause
