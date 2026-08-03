// ============================================================
// TradePro ERP - Cluster Entry Point
// يستخدم كل الـ CPU Cores المتاحة على السيرفر
// Run: node cluster.js  (أو PM2 يشغله تلقائياً)
// ============================================================

const cluster = require('cluster');
const os = require('os');

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║        TradePro ERP - Cluster Mode                   ║`);
    console.log(`╠══════════════════════════════════════════════════════╣`);
    console.log(`║  Master PID : ${process.pid.toString().padEnd(38)}║`);
    console.log(`║  CPU Cores  : ${numCPUs.toString().padEnd(38)}║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);

    // Fork one worker per CPU core
    for (let i = 0; i < numCPUs; i++) {
        const worker = cluster.fork();
        console.log(`[Cluster] Worker ${i + 1} started — PID: ${worker.process.pid}`);
    }

    // Auto-restart crashed workers
    cluster.on('exit', (worker, code, signal) => {
        console.error(`[Cluster] ⚠️  Worker PID ${worker.process.pid} died (code: ${code}, signal: ${signal}). Restarting...`);
        const newWorker = cluster.fork();
        console.log(`[Cluster] ✅ New worker started — PID: ${newWorker.process.pid}`);
    });

    // Log when a worker comes online
    cluster.on('online', (worker) => {
        console.log(`[Cluster] Worker PID ${worker.process.pid} is online`);
    });

} else {
    // Worker process — run the actual server
    require('./server');
}
