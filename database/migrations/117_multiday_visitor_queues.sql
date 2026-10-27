/* Keep still-valid multi-day visitors in today's operational queues. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='116') THROW 54800,'Migration 116 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='117') THROW 54800,'Migration 117 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @d nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ReadGuardQueue'));
IF CHARINDEX('v.LocalVisitDate=CONVERT(date,DATEADD(minute,330,@now))',@d)=0 THROW 54800,'Unexpected guard queue calendar contract.',1;
SET @d=REPLACE(@d,'v.LocalVisitDate=CONVERT(date,DATEADD(minute,330,@now))','(v.LocalVisitDate=CONVERT(date,DATEADD(minute,330,@now)) OR(v.RequestType=''EXTERNAL'' AND v.ValidFromUtc<=@now AND @now<v.ValidUntilUtc))');
SET @d=REPLACE(@d,'CREATE PROCEDURE','ALTER PROCEDURE');EXEC sys.sp_executesql @d;
SET @d=OBJECT_DEFINITION(OBJECT_ID('gp.ReadReceptionQueue'));
IF CHARINDEX('v.LocalVisitDate=@LocalVisitDate',@d)=0 THROW 54800,'Unexpected reception queue calendar contract.',1;
SET @d=REPLACE(@d,'v.LocalVisitDate=@LocalVisitDate','(v.LocalVisitDate=@LocalVisitDate OR(@LocalVisitDate=@today AND v.RequestType=''EXTERNAL'' AND v.ValidFromUtc<=@now AND @now<v.ValidUntilUtc AND v.Status IN(''PENDING'',''APPROVED'')))');
SET @d=REPLACE(@d,'CREATE PROCEDURE','ALTER PROCEDURE');EXEC sys.sp_executesql @d;
INSERT gp.SchemaMigrations(Version,Description) VALUES('117',N'Include active multi-day visitor stays in current guard and reception queues');COMMIT;
