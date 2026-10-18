function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return { valid: false, message: 'كلمة المرور مطلوبة' };
    }
    if (password.length < 8) {
        return { valid: false, message: 'يجب ألا تقل كلمة المرور عن 8 أحرف' };
    }
    if (!/[A-Z]/.test(password)) {
        return { valid: false, message: 'يجب أن تحتوي كلمة المرور على حرف كبير واحد على الأقل (A-Z)' };
    }
    if (!/[a-z]/.test(password)) {
        return { valid: false, message: 'يجب أن تحتوي كلمة المرور على حرف صغير واحد على الأقل (a-z)' };
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, message: 'يجب أن تحتوي كلمة المرور على رقم واحد على الأقل (0-9)' };
    }
    return { valid: true };
}

module.exports = { validatePassword };
