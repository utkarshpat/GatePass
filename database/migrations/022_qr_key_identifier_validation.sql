/* SQL LIKE treats a trailing hyphen differently here: the old exclusion
   bracket rejected '_' and '-'. Match the existing application key alphabet.
   Patch only the two exact known module fragments; preserve their other logic,
   existing GRANTs, issued credentials, and key material. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='021') THROW 52000,'Migration 021 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='022') THROW 52000,'Migration 022 already applied.',1;
BEGIN TRANSACTION;
EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @submit nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'gp.SubmitRegistration')),
        @reissue nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'gp.ReissuePass')),
        @oldSubmit nvarchar(100)=N'LIKE N''%[^A-Za-z0-9._-]%''',
        @oldReissue nvarchar(100)=N'LIKE ''%[^A-Za-z0-9_-]%''';
IF @submit IS NULL OR @reissue IS NULL
 OR (LEN(@submit)-LEN(REPLACE(@submit,@oldSubmit,N'')))<>LEN(@oldSubmit)
 OR (LEN(@reissue)-LEN(REPLACE(@reissue,@oldReissue,N'')))<>LEN(@oldReissue)
 THROW 52000,'Unexpected QR validation module; reviewed upgrade required.',1;
SET @submit=REPLACE(REPLACE(@submit,N'CREATE PROCEDURE',N'ALTER PROCEDURE'),@oldSubmit,N'LIKE N''%[^-A-Za-z0-9._]%''');
SET @reissue=REPLACE(REPLACE(@reissue,N'CREATE PROCEDURE',N'ALTER PROCEDURE'),@oldReissue,N'LIKE ''%[^-A-Za-z0-9_]%''');
EXEC sys.sp_executesql @submit;
EXEC sys.sp_executesql @reissue;
INSERT gp.SchemaMigrations(Version,Description) VALUES('022',N'QR key identifier underscores and hyphens accepted consistently with application contract');
COMMIT;
