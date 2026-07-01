function validate(schema) {
    return (req, res, next) => {
        const result = schema.validate(req.body);
        if (result.errors.length > 0) {
            return res.status(400).json({ success: false, message: result.errors[0] });
        }
        req.validated = result;
        next();
    };
}

module.exports = validate;
