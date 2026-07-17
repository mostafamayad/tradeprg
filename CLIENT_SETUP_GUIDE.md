# TradePro ERP - دليل تسليم نسخة العميل المحلي

## 📦 ما تعطيه للعميل (الملفات المطلوبة):

مجلد `webapp` كاملاً + مجلد `tools` إذا أردت التثبيت التلقائي لـ SQL Server.

## 🔧 إعداد ملف `.env` قبل التسليم:

افتح `webapp/backend/.env` وتأكد من هذه القيم:
```
BUILD_PROFILE=local
MSSQL_SERVER=localhost\SQLEXPRESS
MSSQL_DATABASE=TradePro
MSSQL_USE_WINDOWS_AUTH=true
```

## 🚀 خطوات التثبيت عند العميل:

### طريقة 1 - تلقائية (موصى بها):
1. ضع مجلد `webapp` في أي مكان (مثلاً `C:\TradePro`).
2. شغّل `setup-local.bat` كمسؤول (Right Click → Run as Administrator).
3. انتهى! ستظهر أيقونة على سطح المكتب.

### طريقة 2 - يدوية:
1. ثبّت SQL Server Express من: https://www.microsoft.com/sql-server/sql-server-downloads
2. ثبّت Node.js من: https://nodejs.org
3. افتح Terminal في مجلد `backend` وشغّل: `npm install`
4. ضاعف-اضغط على `TradePro_Launcher.vbs` لتشغيل البرنامج.

## 🔑 بيانات الدخول الافتراضية:
- **اسم المستخدم:** `admin@3smcompany.com`
- **كلمة المرور:** `admin123`
- ⚠️ تنبيه: اطلب من العميل تغيير كلمة المرور فور الدخول الأول.

## ♻️ ماذا يحدث عند التشغيل الأول:
- إذا كانت قاعدة البيانات `TradePro` غير موجودة، يقوم السيرفر بإنشائها تلقائياً.
- يبني جميع الجداول من ملف `schema_fixed.sql`.
- يُنشئ حساب المدير الافتراضي والخزينة والمخزن الرئيسي.
- البرنامج جاهز للاستخدام في أقل من دقيقة!
