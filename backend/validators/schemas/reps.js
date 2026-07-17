const repSchema = {
    validate(body) {
        const rep_name = body.rep_name !== undefined && body.rep_name !== null ? String(body.rep_name).trim() : undefined;
        const errors = [];
        if (!rep_name) errors.push('اسم المندوب مطلوب');

        const target_amount = body.target_amount !== undefined && body.target_amount !== null && body.target_amount !== '' ? Number(body.target_amount) : 0;
        if (isNaN(target_amount) || target_amount < 0) errors.push('الهدف يجب أن يكون 0 أو أكثر');

        const commission_rate = body.commission_rate !== undefined && body.commission_rate !== null && body.commission_rate !== '' ? Number(body.commission_rate) : 0;
        if (isNaN(commission_rate) || commission_rate < 0 || commission_rate > 100) errors.push('نسبة العمولة يجب أن تكون بين 0 و 100');

        return {
            errors,
            rep_code: body.rep_code !== undefined && body.rep_code !== null ? String(body.rep_code).trim() : undefined,
            rep_name,
            phone: body.phone !== undefined && body.phone !== null ? String(body.phone).trim() : undefined,
            region: body.region !== undefined && body.region !== null ? String(body.region).trim() : undefined,
            target_amount,
            commission_rate
        };
    }
};

module.exports = repSchema;
