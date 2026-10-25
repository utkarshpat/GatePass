/* Align current admin Digital ID details with register presence; retain all existing read authorization. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='096') THROW 54800,'Migration 096 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='097') THROW 54800,'Migration 097 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.GetVisitDetail
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@View varchar(8000),@VisitRequestId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52800,'Ambient transaction not accepted.',1;
    IF @View IS NULL OR DATALENGTH(@View)<>LEN(@View) OR @View COLLATE Latin1_General_100_BIN2 NOT IN('OWN','HOST','GUARD','RECEPTION','ADMIN') OR @VisitRequestId IS NULL THROW 52802,'Invalid detail input.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max),@lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        EXEC gp._TakeLock @lock,'Shared'; EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        EXEC gp._VisitReadJson @actor,@View,@VisitRequestId,@now,@result OUTPUT;
        -- Digital IDs record project presence separately; match the authorized register's office presence.
        IF @View='ADMIN' AND JSON_VALUE(@result,'$.requestType')='DIGITAL_ID'
            SET @result=JSON_MODIFY(@result,'$.isInside',CONVERT(bit,gp._PersonInsideOffice(@VisitRequestId)));
        COMMIT; SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('097',N'Current admin Digital ID office presence in authorized visit details');COMMIT;
