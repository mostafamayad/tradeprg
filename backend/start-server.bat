@echo off
cd /d D:\tradeprg\webapp\backend
set NODE_ENV=development
node server.js > server-run.log 2>&1
