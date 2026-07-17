# Database Migrations

الملفات هنا تصف التغييرات التاريخية في الـ Schema.
**لا تُطبَّق يدوياً** — التطبيق يتم تلقائياً عبر `server.js` عند الـ Startup.

| الملف | الوصف |
|-------|-------|
| 001_customers_schema.sql | مخطط جدول العملاء |
| 002_customer_tables.sql | جداول ملحقة بالعملاء |
| 003_hr_tables.sql | جداول الموارد البشرية |
| 004_hr_attendance_vacations_penalties_rewards.sql | جداول الحضور والإجازات |
| 005_fiscal_periods.sql | جدول الفترات المالية |
| 006_gl_indexes.sql | indexes الأستاذ العام |