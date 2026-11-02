/* Persistence schema only. No runtime procedures/grants, legacy pass linkage,
   notifications worker dispatch or automatic gate authorization are enabled. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='122') THROW 52000,'Migration 122 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='123') THROW 52000,'Migration 123 already applied.',1;
BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Exclusive';

CREATE TABLE gp.VisitPlans(
 PlanId uniqueidentifier NOT NULL, LocationId int NOT NULL REFERENCES gp.Locations(LocationId),
 HostUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId), Revision int NOT NULL,
 State varchar(12) COLLATE Latin1_General_100_BIN2 NOT NULL, CreatedAtUtc datetime2(3) NOT NULL,
 CONSTRAINT PK_VisitPlans PRIMARY KEY(PlanId), CONSTRAINT UQ_VisitPlans_Office UNIQUE(PlanId,LocationId),
 CONSTRAINT CK_VisitPlans_Value CHECK(Revision>0 AND State IN('DRAFT','SUBMITTED','CANCELLED')));

CREATE TABLE gp.VisitPlanVersions(
 PlanId uniqueidentifier NOT NULL, Version int NOT NULL, LocationId int NOT NULL, IsCurrent bit NOT NULL,
 VisitorName nvarchar(200) NOT NULL, VisitorEmail nvarchar(320) NULL, Company nvarchar(200) NULL,
 Purpose nvarchar(1000) NOT NULL, StartsAtUtc datetime2(3) NOT NULL, UntilUtc datetime2(3) NOT NULL, IsVip bit NOT NULL,
 StayCheckInDate date NULL, StayCheckOutDate date NULL, StayNotes nvarchar(1000) NULL,
 PolicySnapshotJson nvarchar(max) NOT NULL,
 CONSTRAINT PK_VisitPlanVersions PRIMARY KEY(PlanId,Version),
 CONSTRAINT UQ_VisitPlanVersions_Office UNIQUE(PlanId,Version,LocationId),
 CONSTRAINT FK_VisitPlanVersions_Plan FOREIGN KEY(PlanId,LocationId) REFERENCES gp.VisitPlans(PlanId,LocationId),
 CONSTRAINT CK_VisitPlanVersions_Value CHECK(Version>0 AND StartsAtUtc<UntilUtc AND ISJSON(PolicySnapshotJson)=1 AND LEN(LTRIM(RTRIM(VisitorName)))>0 AND LEN(LTRIM(RTRIM(Purpose)))>0),
 CONSTRAINT CK_VisitPlanVersions_Stay CHECK((StayCheckInDate IS NULL AND StayCheckOutDate IS NULL AND StayNotes IS NULL) OR (StayCheckInDate IS NOT NULL AND StayCheckOutDate IS NOT NULL AND StayCheckInDate<StayCheckOutDate)));
CREATE UNIQUE INDEX UX_VisitPlanVersions_Current ON gp.VisitPlanVersions(PlanId) WHERE IsCurrent=1;
CREATE INDEX IX_VisitPlanVersions_Dates ON gp.VisitPlanVersions(LocationId,StartsAtUtc,UntilUtc) INCLUDE(PlanId,Version,IsCurrent);

CREATE TABLE gp.VisitPlanProjects(
 PlanId uniqueidentifier NOT NULL, Version int NOT NULL, SubProjectId uniqueidentifier NOT NULL,
 AccountOfficeId bigint NOT NULL, LocationId int NOT NULL,
 CONSTRAINT PK_VisitPlanProjects PRIMARY KEY(PlanId,Version,SubProjectId),
 CONSTRAINT FK_VisitPlanProjects_Version FOREIGN KEY(PlanId,Version,LocationId) REFERENCES gp.VisitPlanVersions(PlanId,Version,LocationId),
 CONSTRAINT FK_VisitPlanProjects_Project FOREIGN KEY(SubProjectId,AccountOfficeId,LocationId) REFERENCES gp.SubProjects(SubProjectId,AccountOfficeId,LocationId));

CREATE TABLE gp.VisitPlanApprovalSteps(
 PlanId uniqueidentifier NOT NULL, Version int NOT NULL, StepId uniqueidentifier NOT NULL,
 SubProjectId uniqueidentifier NULL, Name nvarchar(120) NOT NULL,
 Kind varchar(24) COLLATE Latin1_General_100_BIN2 NOT NULL, Mode varchar(3) COLLATE Latin1_General_100_BIN2 NOT NULL,
 CONSTRAINT PK_VisitPlanApprovalSteps PRIMARY KEY(PlanId,Version,StepId),
 CONSTRAINT UQ_VisitPlanApprovalSteps_Kind UNIQUE(PlanId,Version,StepId,Kind),
 CONSTRAINT FK_VisitPlanApprovalSteps_Version FOREIGN KEY(PlanId,Version) REFERENCES gp.VisitPlanVersions(PlanId,Version),
 CONSTRAINT FK_VisitPlanApprovalSteps_Project FOREIGN KEY(PlanId,Version,SubProjectId) REFERENCES gp.VisitPlanProjects(PlanId,Version,SubProjectId),
 CONSTRAINT CK_VisitPlanApprovalSteps_Value CHECK(LEN(LTRIM(RTRIM(Name)))>0 AND Kind IN('PROJECT','SECURITY','CLIENT_CONFIRMATION') AND Mode IN('ALL','ANY')));

CREATE TABLE gp.VisitPlanApprovers(
 PlanId uniqueidentifier NOT NULL, Version int NOT NULL, StepId uniqueidentifier NOT NULL,
 UserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),
 CONSTRAINT PK_VisitPlanApprovers PRIMARY KEY(PlanId,Version,StepId,UserId),
 CONSTRAINT FK_VisitPlanApprovers_Step FOREIGN KEY(PlanId,Version,StepId) REFERENCES gp.VisitPlanApprovalSteps(PlanId,Version,StepId));
CREATE INDEX IX_VisitPlanApprovers_Inbox ON gp.VisitPlanApprovers(UserId,PlanId,Version);

CREATE TABLE gp.VisitPlanDecisions(
 PlanId uniqueidentifier NOT NULL, Version int NOT NULL, StepId uniqueidentifier NOT NULL,
 UserId uniqueidentifier NOT NULL, StepKind varchar(24) COLLATE Latin1_General_100_BIN2 NOT NULL,
 Decision varchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL, Reason nvarchar(500) NOT NULL,
 ClientReference nvarchar(300) NULL, DecidedAtUtc datetime2(3) NOT NULL,
 CONSTRAINT PK_VisitPlanDecisions PRIMARY KEY(PlanId,Version,StepId,UserId),
 CONSTRAINT FK_VisitPlanDecisions_Assignee FOREIGN KEY(PlanId,Version,StepId,UserId) REFERENCES gp.VisitPlanApprovers(PlanId,Version,StepId,UserId),
 CONSTRAINT FK_VisitPlanDecisions_Kind FOREIGN KEY(PlanId,Version,StepId,StepKind) REFERENCES gp.VisitPlanApprovalSteps(PlanId,Version,StepId,Kind),
 CONSTRAINT CK_VisitPlanDecisions_Value CHECK(Decision IN('APPROVED','REJECTED') AND LEN(LTRIM(RTRIM(Reason)))>0),
 CONSTRAINT CK_VisitPlanDecisions_Client CHECK(StepKind<>'CLIENT_CONFIRMATION' OR Decision<>'APPROVED' OR (ClientReference IS NOT NULL AND LEN(LTRIM(RTRIM(ClientReference)))>0)));

CREATE TABLE gp.VisitPlanTasks(
 PlanId uniqueidentifier NOT NULL, Version int NOT NULL, TaskId uniqueidentifier NOT NULL, Name nvarchar(120) NOT NULL,
 Kind varchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL, MandatoryForEntry bit NOT NULL,
 Status varchar(12) COLLATE Latin1_General_100_BIN2 NOT NULL, Remark nvarchar(1000) NOT NULL,
 CONSTRAINT PK_VisitPlanTasks PRIMARY KEY(PlanId,Version,TaskId),
 CONSTRAINT FK_VisitPlanTasks_Version FOREIGN KEY(PlanId,Version) REFERENCES gp.VisitPlanVersions(PlanId,Version),
 CONSTRAINT CK_VisitPlanTasks_Value CHECK(LEN(LTRIM(RTRIM(Name)))>0 AND Kind IN('STAY','OTHER') AND Status IN('REQUESTED','IN_PROGRESS','CONFIRMED','UNAVAILABLE')));
CREATE TABLE gp.VisitPlanTaskOwners(
 PlanId uniqueidentifier NOT NULL, Version int NOT NULL, TaskId uniqueidentifier NOT NULL,
 UserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),
 CONSTRAINT PK_VisitPlanTaskOwners PRIMARY KEY(PlanId,Version,TaskId,UserId),
 CONSTRAINT FK_VisitPlanTaskOwners_Task FOREIGN KEY(PlanId,Version,TaskId) REFERENCES gp.VisitPlanTasks(PlanId,Version,TaskId));
CREATE INDEX IX_VisitPlanTaskOwners_Inbox ON gp.VisitPlanTaskOwners(UserId,PlanId,Version);

/* These are collaboration memberships, never project movement entitlements. */
CREATE TABLE gp.VisitPlanParticipants(
 PlanId uniqueidentifier NOT NULL, Version int NOT NULL, ParticipantId uniqueidentifier NOT NULL,
 UserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId), SubProjectId uniqueidentifier NULL,
 RoleCode varchar(12) COLLATE Latin1_General_100_BIN2 NOT NULL,
 CONSTRAINT PK_VisitPlanParticipants PRIMARY KEY(PlanId,Version,ParticipantId),
 CONSTRAINT FK_VisitPlanParticipants_Version FOREIGN KEY(PlanId,Version) REFERENCES gp.VisitPlanVersions(PlanId,Version),
 CONSTRAINT FK_VisitPlanParticipants_Project FOREIGN KEY(PlanId,Version,SubProjectId) REFERENCES gp.VisitPlanProjects(PlanId,Version,SubProjectId),
 CONSTRAINT CK_VisitPlanParticipants_Role CHECK(RoleCode IN('HOST','APPROVER','OPERATIONS','RECEPTION','SECURITY')));

CREATE TABLE gp.VisitPlanThreads(
 PlanId uniqueidentifier NOT NULL, Version int NOT NULL, ThreadId uniqueidentifier NOT NULL,
 Title nvarchar(120) NOT NULL, Audience varchar(10) COLLATE Latin1_General_100_BIN2 NOT NULL,
 SubProjectId uniqueidentifier NULL, ApprovalStepId uniqueidentifier NULL, TaskId uniqueidentifier NULL,
 CreatedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId), IsResolved bit NOT NULL,
 CONSTRAINT PK_VisitPlanThreads PRIMARY KEY(PlanId,Version,ThreadId),
 CONSTRAINT FK_VisitPlanThreads_Version FOREIGN KEY(PlanId,Version) REFERENCES gp.VisitPlanVersions(PlanId,Version),
 CONSTRAINT FK_VisitPlanThreads_Project FOREIGN KEY(PlanId,Version,SubProjectId) REFERENCES gp.VisitPlanProjects(PlanId,Version,SubProjectId),
 CONSTRAINT FK_VisitPlanThreads_Approval FOREIGN KEY(PlanId,Version,ApprovalStepId) REFERENCES gp.VisitPlanApprovalSteps(PlanId,Version,StepId),
 CONSTRAINT FK_VisitPlanThreads_Task FOREIGN KEY(PlanId,Version,TaskId) REFERENCES gp.VisitPlanTasks(PlanId,Version,TaskId),
 CONSTRAINT CK_VisitPlanThreads_Title CHECK(LEN(LTRIM(RTRIM(Title)))>0),
 CONSTRAINT CK_VisitPlanThreads_Audience CHECK(
  (Audience='GENERAL' AND ApprovalStepId IS NULL AND TaskId IS NULL) OR
  (Audience='APPROVAL' AND ApprovalStepId IS NOT NULL AND TaskId IS NULL) OR
  (Audience='OPERATIONS' AND TaskId IS NOT NULL AND ApprovalStepId IS NULL AND SubProjectId IS NULL)));

CREATE TABLE gp.VisitPlanMessages(
 PlanId uniqueidentifier NOT NULL, Version int NOT NULL, ThreadId uniqueidentifier NOT NULL,
 MessageId uniqueidentifier NOT NULL, ReplyToId uniqueidentifier NULL,
 AuthorUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId), Body nvarchar(4000) NOT NULL, CreatedAtUtc datetime2(3) NOT NULL,
 CONSTRAINT PK_VisitPlanMessages PRIMARY KEY(PlanId,Version,ThreadId,MessageId),
 CONSTRAINT FK_VisitPlanMessages_Thread FOREIGN KEY(PlanId,Version,ThreadId) REFERENCES gp.VisitPlanThreads(PlanId,Version,ThreadId),
 CONSTRAINT FK_VisitPlanMessages_Reply FOREIGN KEY(PlanId,Version,ThreadId,ReplyToId) REFERENCES gp.VisitPlanMessages(PlanId,Version,ThreadId,MessageId),
 CONSTRAINT CK_VisitPlanMessages_Value CHECK(LEN(LTRIM(RTRIM(Body)))>0 AND (ReplyToId IS NULL OR ReplyToId<>MessageId)));

CREATE TABLE gp.VisitPlanMentions(
 PlanId uniqueidentifier NOT NULL, Version int NOT NULL, ThreadId uniqueidentifier NOT NULL, MessageId uniqueidentifier NOT NULL,
 UserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),
 CONSTRAINT PK_VisitPlanMentions PRIMARY KEY(PlanId,Version,ThreadId,MessageId,UserId),
 CONSTRAINT FK_VisitPlanMentions_Message FOREIGN KEY(PlanId,Version,ThreadId,MessageId) REFERENCES gp.VisitPlanMessages(PlanId,Version,ThreadId,MessageId));

CREATE TABLE gp.VisitPlanEvents(
 PlanId uniqueidentifier NOT NULL, Sequence int NOT NULL, Version int NOT NULL,
 ActorUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId), Kind varchar(20) COLLATE Latin1_General_100_BIN2 NOT NULL,
 TargetId uniqueidentifier NULL, OccurredAtUtc datetime2(3) NOT NULL, DetailJson nvarchar(max) NOT NULL,
 CONSTRAINT PK_VisitPlanEvents PRIMARY KEY(PlanId,Sequence),
 CONSTRAINT FK_VisitPlanEvents_Version FOREIGN KEY(PlanId,Version) REFERENCES gp.VisitPlanVersions(PlanId,Version),
 CONSTRAINT CK_VisitPlanEvents_Value CHECK(Sequence>0 AND ISJSON(DetailJson)=1 AND Kind IN('CREATED','SUBMIT','CANCEL','REVISE','DECIDE','ARRANGE','THREAD','COMMENT','THREAD_STATE')));

CREATE TABLE gp.VisitPlanOperations(
 PlanId uniqueidentifier NOT NULL REFERENCES gp.VisitPlans(PlanId), ActorUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),
 ClientKey uniqueidentifier NOT NULL, PayloadHash binary(32) NOT NULL, ExpectedRevision int NOT NULL, ResultRevision int NOT NULL,
 CONSTRAINT PK_VisitPlanOperations PRIMARY KEY(PlanId,ActorUserId,ClientKey),
 CONSTRAINT CK_VisitPlanOperations_Revision CHECK(ExpectedRevision>0 AND ResultRevision=ExpectedRevision+1));

/* Intent records are not Graph delivery or proof of mailbox acceptance. They
   remain isolated from the current live worker until its adapter is implemented. */
CREATE TABLE gp.VisitPlanNotices(
 PlanId uniqueidentifier NOT NULL, EventSequence int NOT NULL, NoticeId uniqueidentifier NOT NULL,
 RecipientUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),
 Kind varchar(12) COLLATE Latin1_General_100_BIN2 NOT NULL, TargetId uniqueidentifier NULL,
 CONSTRAINT PK_VisitPlanNotices PRIMARY KEY(PlanId,NoticeId),
 CONSTRAINT FK_VisitPlanNotices_Event FOREIGN KEY(PlanId,EventSequence) REFERENCES gp.VisitPlanEvents(PlanId,Sequence),
 CONSTRAINT CK_VisitPlanNotices_Kind CHECK(Kind IN('APPROVAL','ARRANGEMENT','FYI','DISCUSSION','UPDATE','CANCELLED')));
CREATE UNIQUE INDEX UX_VisitPlanNotices_Logical ON gp.VisitPlanNotices(PlanId,EventSequence,RecipientUserId,Kind,TargetId);

INSERT gp.SchemaMigrations(Version,Description) VALUES('123',N'Versioned visit plans, project approvals, arrangements, scoped threads, audit and notice intent foundation');
COMMIT;
