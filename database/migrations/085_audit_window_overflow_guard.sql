/* Compare the bounded duration without overflowing datetime2 near year 9999. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='084') THROW 54800,'Migration 084 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='085') THROW 54800,'Migration 085 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ListScopedAuditEvents')),
 @old nvarchar(100)=N'@UntilUtc>DATEADD(day,31,@FromUtc)';
IF @definition IS NULL OR CHARINDEX(@old,@definition)=0 THROW 54800,'Expected audit window validation unavailable.',1;
SET @definition=REPLACE(@definition,@old,N'DATEDIFF_BIG(millisecond,@FromUtc,@UntilUtc)>CONVERT(bigint,2678400000)');
SET @definition=STUFF(@definition,1,CHARINDEX('PROCEDURE',@definition)+8,'ALTER PROCEDURE');
EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('085',N'Reject far-future audit windows without datetime overflow');
COMMIT;
