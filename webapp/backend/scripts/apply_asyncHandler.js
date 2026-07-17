const fs = require('fs');
const path = require('path');
const routesDir = path.join(__dirname, '..', 'routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && f !== 'reps.js');

for (const file of files) {
    const filePath = path.join(routesDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('asyncHandler')) {
        console.log(`Skipped: ${file}`);
        continue;
    }

    // 1. Add asyncHandler require
    const lines = content.split('\n');
    let lastRequireIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*(const|let|var)\s+\S+\s*=\s*require\(/.test(lines[i])) {
            lastRequireIdx = i;
        }
    }
    if (lastRequireIdx === -1) { console.log(`No requires in ${file}`); continue; }
    lines.splice(lastRequireIdx + 1, 0, `const asyncHandler = require('../utils/asyncHandler');`);

    // 2. Wrap route handlers line-by-line
    // Match lines ending with `async (req, res) => {` that are route definitions
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Check if this line is part of a route definition: router.VERB(...) followed by async (req, res)
        // The route definition should start with `router.` and contain `async (req, res) => {`
        if (/router\.(get|post|put|delete|patch|use)\s*\(/.test(line) && /async\s*\(\s*req\s*,\s*res\s*\)\s*\{\s*$/.test(line)) {
            // Count opening parens to find where the middleware params end
            let parenCount = 0;
            let parenStarted = false;
            let insertPos = -1;
            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                if (ch === '(') {
                    parenCount++;
                    parenStarted = true;
                } else if (ch === ')') {
                    parenCount--;
                    if (parenStarted && parenCount === 0) {
                        // This closes router.VERB(...)
                        insertPos = j;
                    }
                }
            }
            if (insertPos > 0) {
                // Insert `asyncHandler(` after the closing paren of VERB(...), before `async`
                // Find `async` after insertPos
                const asyncIdx = line.indexOf('async (req, res)', insertPos);
                if (asyncIdx > 0) {
                    // Insert `asyncHandler(` before `async`
                    const before = line.substring(0, asyncIdx);
                    const after = line.substring(asyncIdx);
                    lines[i] = before + 'asyncHandler(' + after;
                }
            }
        }
    }

    // Rejoin
    content = lines.join('\n');

    // 3. Replace `res.status(500).json({ success: false, message: '...' });`
    // in catch blocks. Use a single-line pattern first:
    content = content.replace(
        /res\.status\(500\)\.json\(\{\s*success:\s*false\s*,\s*message:\s*('[^']*'|"[^"]*")\s*\}\);/g,
        (match, msg) => {
            return `err.status = 500;\n        err.message = ${msg};\n        throw err;`;
        }
    );

    // Multi-line variant:
    content = content.replace(
        /res\.status\(500\)\.json\(\{[\s\S]*?success:\s*false[\s\S]*?message:\s*('[^']*'|"[^"]*")[\s\S]*?\}\);/g,
        (match, msg) => {
            return `err.status = 500;\n        err.message = ${msg};\n        throw err;`;
        }
    );

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Done: ${file}`);
}

console.log('\nAll files transformed.');
