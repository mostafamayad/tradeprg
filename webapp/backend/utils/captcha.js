const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'tradepro-secure-captcha-salt-2026';

function generateCaptcha() {
    const num1 = Math.floor(Math.random() * 9) + 1;
    const num2 = Math.floor(Math.random() * 9) + 1;
    const answer = num1 + num2;
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    const payload = `${answer}:${expiresAt}`;
    const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    const token = Buffer.from(`${payload}:${hmac}`).toString('base64');

    const question = `${num1} + ${num2} = ؟`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="130" height="38" viewBox="0 0 130 38">
        <rect width="100%" height="100%" fill="#f8fafc" rx="6" stroke="#cbd5e1" stroke-width="1"/>
        <line x1="5" y1="10" x2="125" y2="28" stroke="#e2e8f0" stroke-width="2" />
        <line x1="10" y1="28" x2="120" y2="10" stroke="#e2e8f0" stroke-width="2" />
        <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#0f172a" letter-spacing="2">${question}</text>
    </svg>`;

    return {
        token,
        svg: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
        question
    };
}

function verifyCaptcha(token, userAnswer) {
    if (!token || !userAnswer) return false;
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const parts = decoded.split(':');
        if (parts.length !== 3) return false;

        const [correctAnswer, expiresAt, hmac] = parts;

        if (Date.now() > parseInt(expiresAt, 10)) {
            return false;
        }

        const expectedPayload = `${correctAnswer}:${expiresAt}`;
        const expectedHmac = crypto.createHmac('sha256', SECRET).update(expectedPayload).digest('hex');
        if (expectedHmac !== hmac) {
            return false;
        }

        return String(correctAnswer).trim() === String(userAnswer).trim();
    } catch (e) {
        return false;
    }
}

module.exports = { generateCaptcha, verifyCaptcha };
