SET NOCOUNT ON;

DECLARE @tables TABLE (id INT IDENTITY, name NVARCHAR(256));
INSERT INTO @tables (name) SELECT name FROM sys.tables WHERE name NOT IN ('sysdiagrams') ORDER BY name;

DECLARE @i INT = 1, @count INT, @tbl NVARCHAR(256), @cols NVARCHAR(MAX), @sql NVARCHAR(MAX);
SELECT @count = COUNT(*) FROM @tables;

WHILE @i <= @count
BEGIN
    SELECT @tbl = name FROM @tables WHERE id = @i;

    SELECT @cols = STRING_AGG('[' + COLUMN_NAME + ']', ', ')
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = @tbl AND TABLE_SCHEMA = 'dbo'
    ORDER BY ORDINAL_POSITION;

    PRINT '-- TABLE: ' + @tbl;
    PRINT 'IF OBJECT_ID(''tempdb..#tmp_' + @tbl + ''') IS NOT NULL DROP TABLE #tmp_' + @tbl + ';';
    PRINT 'SELECT * INTO #tmp_' + @tbl + ' FROM [' + @tbl + '];';

    SET @sql = 'DECLARE @r NVARCHAR(MAX); DECLARE c CURSOR FOR SELECT ' + @cols + ' FROM #tmp_' + @tbl + '; OPEN c; DECLARE ' +
        STUFF((
            SELECT ', @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' ' + 
                CASE 
                    WHEN c.DATA_TYPE IN ('nvarchar','varchar','nchar','char','text','ntext') THEN 'NVARCHAR(MAX)'
                    WHEN c.DATA_TYPE IN ('decimal','numeric') THEN 'DECIMAL(18,' + CAST(ISNULL(c.NUMERIC_SCALE, 0) AS NVARCHAR) + ')'
                    WHEN c.DATA_TYPE IN ('float','real') THEN 'FLOAT'
                    WHEN c.DATA_TYPE IN ('int','bigint','smallint','tinyint') THEN c.DATA_TYPE
                    WHEN c.DATA_TYPE IN ('money','smallmoney') THEN c.DATA_TYPE
                    WHEN c.DATA_TYPE IN ('datetime','datetime2','date','smalldatetime') THEN 'DATETIME'
                    WHEN c.DATA_TYPE IN ('bit') THEN 'BIT'
                    WHEN c.DATA_TYPE IN ('uniqueidentifier') THEN 'UNIQUEIDENTIFIER'
                    ELSE 'NVARCHAR(MAX)'
                END
            FROM INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_NAME = @tbl AND c.TABLE_SCHEMA = 'dbo'
            ORDER BY c.ORDINAL_POSITION
            FOR XML PATH('')
        ), 1, 1, '') + '; FETCH NEXT FROM c INTO ' +
        STUFF((
            SELECT ', @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR)
            FROM INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_NAME = @tbl AND c.TABLE_SCHEMA = 'dbo'
            ORDER BY c.ORDINAL_POSITION
            FOR XML PATH('')
        ), 1, 2, '') + '; WHILE @@FETCH_STATUS = 0 BEGIN SET @r = ''INSERT INTO [' + @tbl + '] (' + @cols + ') VALUES ('' + ' +
        STUFF((
            SELECT ' + CASE
                WHEN c.DATA_TYPE IN ('nvarchar','varchar','nchar','char','text','ntext') THEN
                    ' + CASE WHEN @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' IS NULL THEN ''NULL'' ELSE ''N'''''' + REPLACE(CAST(@c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' AS NVARCHAR(MAX)), '''''''', '''''''''''') + '''''''' END +'
                WHEN c.DATA_TYPE IN ('decimal','numeric','float','real','int','bigint','smallint','tinyint','money','smallmoney') THEN
                    ' + CASE WHEN c.IS_NULLABLE = 'YES' THEN '+ CASE WHEN @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' IS NULL THEN ''NULL'' ELSE CAST(@c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' AS NVARCHAR(50)) END +' ELSE '+ CAST(@c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' AS NVARCHAR(50)) +' END +'
                WHEN c.DATA_TYPE IN ('datetime','datetime2','date','smalldatetime') THEN
                    ' + CASE WHEN c.IS_NULLABLE = 'YES' THEN '+ CASE WHEN @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' IS NULL THEN ''NULL'' ELSE '''''''' + CONVERT(NVARCHAR(50), @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ', 121) + '''''''' END +' ELSE '+ '''''''' + CONVERT(NVARCHAR(50), @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ', 121) + '''''''' END +'
                WHEN c.DATA_TYPE IN ('bit') THEN
                    ' + '+ CASE WHEN @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' IS NULL THEN ''NULL'' WHEN @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' = 1 THEN ''1'' ELSE ''0'' END +'
                WHEN c.DATA_TYPE IN ('uniqueidentifier') THEN
                    ' + '+ CASE WHEN @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' IS NULL THEN ''NULL'' ELSE '''''''' + CAST(@c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' AS NVARCHAR(50)) + '''''''' END +'
                ELSE
                    ' + '+ CASE WHEN @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' IS NULL THEN ''NULL'' ELSE '''''''' + REPLACE(CAST(@c' + CAST(c.ORDINAL_POSITION AS NVARCHAR) + ' AS NVARCHAR(MAX)), '''''''', '''''''''''') + '''''''' END +'
            END + ' + '', ''
            FROM INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_NAME = @tbl AND c.TABLE_SCHEMA = 'dbo'
            ORDER BY c.ORDINAL_POSITION
            FOR XML PATH('')
        ), 1, 3, '') + '' + '');''; PRINT @r; FETCH NEXT FROM c INTO ' +
        STUFF((
            SELECT ', @c' + CAST(c.ORDINAL_POSITION AS NVARCHAR)
            FROM INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_NAME = @tbl AND c.TABLE_SCHEMA = 'dbo'
            ORDER BY c.ORDINAL_POSITION
            FOR XML PATH('')
        ), 1, 2, '') + '; END; CLOSE c; DEALLOCATE c;';

    EXEC sp_executesql @sql;
    PRINT 'DROP TABLE #tmp_' + @tbl + ';';
    PRINT '';

    SET @i = @i + 1;
END
