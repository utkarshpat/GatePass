/* Bound device canonicalization to its five validated codes. OPENJSON's default
   row/LOB estimates plus ordered STRING_AGG requested ~20 MB for a few bytes,
   causing RESOURCE_SEMAPHORE waits and registration timeouts on local Express. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54700,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='083') THROW 54700,'Migration 083 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='084') THROW 54700,'Migration 084 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.SubmitRegistration'));
DECLARE @start int=CHARINDEX(N'    INSERT @extras SELECT',@definition),
 @end int=CHARINDEX(N'    IF @RequestType<>''EXTERNAL'' AND EXISTS(SELECT 1 FROM @extras',@definition);
IF @definition IS NULL OR @start=0 OR @end<=@start THROW 54700,'Expected device canonicalization unavailable.',1;
SET @definition=STUFF(@definition,@start,@end-@start,N'    INSERT @extras
    SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(x.value,''$.clientPersonKey'')),NULLIF(LTRIM(RTRIM(d.companyName)),N''''),
      N''[''+CONCAT_WS(N'','',
        CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(COALESCE(d.deviceTypes,N''[]'')) WHERE value=N''CAMERA'') THEN N''"CAMERA"'' END,
        CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(COALESCE(d.deviceTypes,N''[]'')) WHERE value=N''LAPTOP'') THEN N''"LAPTOP"'' END,
        CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(COALESCE(d.deviceTypes,N''[]'')) WHERE value=N''OTHER'') THEN N''"OTHER"'' END,
        CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(COALESCE(d.deviceTypes,N''[]'')) WHERE value=N''PEN_DRIVE'') THEN N''"PEN_DRIVE"'' END,
        CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(COALESCE(d.deviceTypes,N''[]'')) WHERE value=N''TABLET'') THEN N''"TABLET"'' END)+N'']''
    FROM OPENJSON(@PeopleJson) x CROSS APPLY OPENJSON(x.value)
      WITH(companyName nvarchar(200),deviceTypes nvarchar(max) AS JSON) d;
');
SET @definition=STUFF(@definition,1,CHARINDEX('PROCEDURE',@definition)+8,'ALTER PROCEDURE');
EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('084',N'Bound visitor device canonicalization without a LOB sort memory grant');
COMMIT;
