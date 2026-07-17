import os
import sqlite3
import json
from datetime import datetime

# ملاحظة: لتحويل ملفات DBF إلى MySQL بسهولة، سنقوم بإنشاء سكريبت يقرأ DBF ويولد ملف SQL.
# يتطلب هذا السكريبت تثبيت مكتبة dbfread:
# pip install dbfread

try:
    from dbfread import DBF
except ImportError:
    print("يرجى تثبيت مكتبة dbfread لتشغيل هذا السكريبت:")
    print("pip install dbfread")
    exit(1)

DBF_DIR = r"D:\tradeprg\Datatrial"
OUTPUT_SQL = r"D:\tradeprg\webapp\backend\migration.sql"

def escape_string(val):
    if val is None:
        return 'NULL'
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, datetime):
        return f"'{val.strftime('%Y-%m-%d %H:%M:%S')}'"
    # التعامل مع النصوص لتجنب مشكلات SQL Injection البسيطة أثناء الهجرة
    val_str = str(val).replace("'", "\\'").replace('"', '\\"')
    return f"'{val_str}'"

def migrate():
    print(f"بدء استخراج البيانات من {DBF_DIR}...")
    
    with open(OUTPUT_SQL, 'w', encoding='utf-8') as sql_file:
        sql_file.write("SET NAMES utf8mb4;\n")
        sql_file.write("SET FOREIGN_KEY_CHECKS = 0;\n\n")
        
        for filename in os.listdir(DBF_DIR):
            if filename.lower().endswith('.dbf'):
                table_name = filename[:-4].lower()
                file_path = os.path.join(DBF_DIR, filename)
                print(f"جاري معالجة الجدول: {table_name}...")
                
                try:
                    table = DBF(file_path, encoding='cp1256') # استخدام الترميز العربي غالباً cp1256
                    
                    if len(table.records) == 0:
                        continue
                        
                    # بناء استعلام الإنشاء (Create Table)
                    fields = table.fields
                    create_stmt = f"DROP TABLE IF EXISTS `{table_name}`;\n"
                    create_stmt += f"CREATE TABLE `{table_name}` (\n"
                    create_stmt += "  `id` INT AUTO_INCREMENT PRIMARY KEY,\n"
                    
                    for field in fields:
                        field_name = field.name.lower()
                        create_stmt += f"  `{field_name}` VARCHAR(255),\n" # تبسيط الأنواع مبدئياً
                    
                    create_stmt = create_stmt.rstrip(',\n') + "\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n\n"
                    sql_file.write(create_stmt)
                    
                    # بناء استعلامات الإدخال (Insert)
                    for record in table:
                        keys = [k.lower() for k in record.keys()]
                        values = [escape_string(v) for v in record.values()]
                        
                        insert_stmt = f"INSERT INTO `{table_name}` (`{'`, `'.join(keys)}`) VALUES ({', '.join(values)});\n"
                        sql_file.write(insert_stmt)
                        
                    sql_file.write("\n")
                except Exception as e:
                    print(f"خطأ أثناء قراءة {filename}: {e}")
                    
        sql_file.write("SET FOREIGN_KEY_CHECKS = 1;\n")
    print(f"تم الانتهاء بنجاح! تم حفظ استعلامات SQL في: {OUTPUT_SQL}")

if __name__ == "__main__":
    migrate()
