SET NOCOUNT ON;
DECLARE @table NVARCHAR(256), @sql NVARCHAR(MAX), @cols NVARCHAR(MAX);
DECLARE table_cursor CURSOR FOR
    SELECT name FROM sys.tables WHERE name NOT IN ('sysdiagrams') ORDER BY name;

OPEN table_cursor;
FETCH NEXT FROM table_cursor INTO @table;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = '';

    DECLARE @col_name NVARCHAR(256), @col_type NVARCHAR(128);
    DECLARE col_cursor CURSOR FOR
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @table AND TABLE_SCHEMA = 'dbo'
        ORDER BY ORDINAL_POSITION;

    SET @cols = '';
    OPEN col_cursor;
    FETCH NEXT FROM col_cursor INTO @col_name, @col_type;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        IF @cols <> '' SET @cols = @cols + ', ';
        SET @cols = @cols + '[' + @col_name + ']';
        FETCH NEXT FROM col_cursor INTO @col_name, @col_type;
    END
    CLOSE col_cursor;
    DEALLOCATE col_cursor;

    SET @sql = 'DECLARE insert_cursor CURSOR FOR SELECT ' + @cols + ' FROM [' + @table + '];';
    EXEC sp_executesql @sql;

    DECLARE @vals NVARCHAR(MAX);
    DECLARE insert_cursor CURSOR FOR SELECT * FROM (SELECT 1 AS dummy) AS x;
    -- Use dynamic SQL for actual insert generation
    SET @sql = 'SET NOCOUNT ON; DECLARE @row VARCHAR(MAX); DECLARE c CURSOR FOR SELECT ' + @cols + ' FROM [' + @table + ']; OPEN c; FETCH NEXT FROM c INTO ' + REPLACE(REPLACE(@cols, '[', '@'), ']', '') + '; WHILE @@FETCH_STATUS = 0 BEGIN SET @row = ''INSERT INTO [' + @table + '] (' + @cols + ') VALUES ('; ';

    CLOSE insert_cursor;
    DEALLOCATE insert_cursor;

    PRINT '-- Table: ' + @table;
    PRINT 'SELECT ''INSERT INTO [' + @table + '] (' + @cols + ') VALUES (''' + ' + ' +
        STUFF((
            SELECT ' + CASE
                WHEN c.DATA_TYPE IN ('nvarchar','varchar','nchar','char','text','ntext') THEN
                    ''' + CASE WHEN [' + c.COLUMN_NAME + '] IS NULL THEN ''NULL'' ELSE ''N'''''' + REPLACE(CAST([' + c.COLUMN_NAME + '] AS NVARCHAR(MAX)), '''''''', '''''''''''') + '''''''' END +'''
                WHEN c.DATA_TYPE IN ('decimal','numeric','float','real','int','bigint','smallint','tinyint','money','smallmoney') THEN
                    ''' + CASE WHEN c.IS_NULLABLE = 'YES' THEN '+ CASE WHEN [' + c.COLUMN_NAME + '] IS NULL THEN ''NULL'' ELSE CAST([' + c.COLUMN_NAME + '] AS NVARCHAR(50)) END +' ELSE '+ CAST([' + c.COLUMN_NAME + '] AS NVARCHAR(50)) +' END +'''
                WHEN c.DATA_TYPE IN ('datetime','datetime2','date','smalldatetime') THEN
                    ''' + CASE WHEN c.IS_NULLABLE = 'YES' THEN '+ CASE WHEN [' + c.COLUMN_NAME + '] IS NULL THEN ''NULL'' ELSE '''''''' + CONVERT(NVARCHAR(50), [' + c.COLUMN_NAME + '], 121) + '''''''' END +' ELSE '+ '''''''' + CONVERT(NVARCHAR(50), [' + c.COLUMN_NAME + '], 121) + '''''''' END +'''
                WHEN c.DATA_TYPE IN ('bit') THEN
                    ''' + CASE WHEN c.IS_NULLABLE = 'YES' THEN '+ CASE WHEN [' + c.COLUMN_NAME + '] IS NULL THEN ''NULL'' ELSE CASE WHEN [' + c.COLUMN_NAME + '] = 1 THEN ''1'' ELSE ''0'' END END +' ELSE '+ 'CASE WHEN [' + c.COLUMN_NAME + '] = 1 THEN ''1'' ELSE ''0'' END' +' END +'''
                ELSE
                    ''' + CASE WHEN c.IS_NULLABLE = 'YES' THEN '+ CASE WHEN [' + c.COLUMN_NAME + '] IS NULL THEN ''NULL'' ELSE '''''''' + REPLACE(CAST([' + c.COLUMN_NAME + '] AS NVARCHAR(MAX)), '''''''', '''''''''''') + '''''''' END +' ELSE '+ '''''''' + REPLACE(CAST([' + c.COLUMN_NAME + '] AS NVARCHAR(MAX)), '''''''', '''''''''''') + '''''''' END +'''
            END + ' + '', ''
            FROM INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_NAME = @table AND c.TABLE_SCHEMA = 'dbo'
            ORDER BY c.ORDINAL_POSITION
            FOR XML PATH('')
        ), 1, 2, '') + '' + '');'' FROM [' + @table + '];';

    FETCH NEXT FROM table_cursor INTO @table;
END

CLOSE table_cursor;
DEALLOCATE table_cursor;
