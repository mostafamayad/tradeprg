@echo off
cd /d "D:\tradeprg\webapp\backend"
echo Starting server...
start /B node server.js > server_out4.txt 2> server_err4.txt
echo Server started, PID: %ERRORLEVEL%
