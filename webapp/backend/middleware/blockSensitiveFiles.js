const BLOCKED_EXTENSIONS = [
    '.env', '.git', '.bak', '.backup', '.sql', '.log', '.err',
    '.md', '.json', '.yml', '.yaml', '.lock', '.config'
];

const BLOCKED_FILES = [
    'package.json', 'package-lock.json', '.gitignore', 'web.config',
    'tsconfig.json', '.token'
];

module.exports = function blockSensitiveFiles(req, res, next) {
    const urlPath = (req.path || '').toLowerCase();

    // Block hidden files (starting with dot)
    if (/(^|\/)\.[^\/\.]/.test(urlPath)) {
        return res.status(403).json({ success: false, message: 'الوصول محظور' });
    }

    // Block known sensitive filenames
    for (const f of BLOCKED_FILES) {
        if (urlPath.endsWith('/' + f) || urlPath === '/' + f) {
            return res.status(403).json({ success: false, message: 'الوصول محظور' });
        }
    }

    // Block known sensitive extensions
    for (const ext of BLOCKED_EXTENSIONS) {
        if (urlPath.endsWith(ext)) {
            return res.status(403).json({ success: false, message: 'الوصول محظور' });
        }
    }

    next();
};
