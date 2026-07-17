@echo off
set JWT_SECRET=tradeprodemo123!@#SECRET
set JWT_EXPIRES_IN=8h
set BUILD_PROFILE=development
cd /d "D:\tradeprg\webapp\backend"
node server.js > server_out.log 2> server_err.log
