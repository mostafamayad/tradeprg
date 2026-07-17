const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.resolve(__dirname, '../reports');

if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

class Suite {
    constructor(name) {
        this.name = name;
        this.passed = 0;
        this.failed = 0;
        this.results = [];
        this._start = 0;
    }

    begin() {
        this._start = Date.now();
        const sep = '━'.repeat(60);
        console.log(`\n${sep}`);
        console.log(`  ${this.name}`);
        console.log(`${sep}`);
    }

    async test(name, fn) {
        try {
            await fn();
            this.passed++;
            console.log(`  ✅  ${name}`);
            this.results.push({ name, passed: true });
        } catch (e) {
            this.failed++;
            console.log(`  ❌  ${name}`);
            console.log(`      ${e.message}`);
            this.results.push({ name, passed: false, error: e.message });
        }
    }

    async run(tests) {
        this.begin();
        for (const t of tests) {
            await this.test(t.name, t.fn);
        }
        return this.finish();
    }

    finish() {
        const elapsed = ((Date.now() - this._start) / 1000).toFixed(2);
        const total = this.passed + this.failed;
        console.log(`\n  ────────────────────────────────────────────`);
        console.log(`  ${total} tests · ${this.passed} passed · ${this.failed} failed · ${elapsed}s`);
        console.log(`  Status: ${this.failed === 0 ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
        return {
            suite: this.name,
            passed: this.passed,
            failed: this.failed,
            total,
            elapsed: parseFloat(elapsed),
            results: this.results
        };
    }

    static async runAll(suites) {
        const start = Date.now();
        const allResults = [];
        let grandPassed = 0;
        let grandFailed = 0;

        console.log('\n' + '╔' + '═'.repeat(58) + '╗');
        console.log('║' + '  TradePro ERP — Baseline Regression Suite'.padEnd(57) + '║');
        console.log('╚' + '═'.repeat(58) + '╝\n');

        for (const suite of suites) {
            // suites are already-run result objects, not Suite instances
            allResults.push(suite);
            grandPassed += suite.passed;
            grandFailed += suite.failed;
        }

        const elapsed = ((Date.now() - start) / 1000).toFixed(2);
        const grandTotal = grandPassed + grandFailed;

        const report = {
            timestamp: new Date().toISOString(),
            elapsed,
            grandTotal,
            grandPassed,
            grandFailed,
            suites: allResults
        };

        const reportPath = path.join(REPORT_DIR, `baseline-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n📁  Report saved: ${reportPath}`);

        console.log('\n' + '═'.repeat(60));
        console.log(`  FINAL: ${grandTotal} tests · ${grandPassed} passed · ${grandFailed} failed · ${elapsed}s`);
        console.log(`  ${grandFailed === 0 ? '✅  ALL SUITES PASSED' : '❌  SOME SUITES FAILED'}`);
        console.log('═'.repeat(60) + '\n');

        return { passed: grandPassed, failed: grandFailed, reportPath };
    }
}

module.exports = Suite;
