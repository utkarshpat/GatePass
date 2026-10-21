/* Exact synthetic run ownership only. Remove new render children before the
   unchanged shared fixture cleanup runs; never a production retention script. */
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR @RunId IS NULL THROW 52900,'Dedicated test database/run required.',1;
DECLARE @prefix varchar(30)='GP02-'+LEFT(REPLACE(CONVERT(varchar(36),@RunId),'-',''),20);
-- Worker audits have no actor or visit target. Capture their exact owned
-- notification references before the shared cleanup removes the outbox rows.
DELETE a FROM gp.SecurityAuditEvents a JOIN gp.NotificationOutbox n
    ON a.TargetType='NOTIFICATION' AND a.TargetReference=CONVERT(varchar(100),n.NotificationId)
    JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%';
DELETE r FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId
    JOIN gp.VisitRequests v ON v.VisitRequestId=j.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%';
