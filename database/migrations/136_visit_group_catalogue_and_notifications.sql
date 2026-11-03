SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='135') OR EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='136') THROW 52000,'Migration 135 required; 136 must be new.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
/* Explicit email destinations have no identity or login. Internal recipients retain the original foreign key. */
DROP INDEX UX_VisitPlanNotices_Logical ON gp.VisitPlanNotices;
DECLARE @fk sysname=(SELECT TOP(1) fk.name FROM sys.foreign_keys fk JOIN sys.foreign_key_columns c ON c.constraint_object_id=fk.object_id JOIN sys.columns col ON col.object_id=c.parent_object_id AND col.column_id=c.parent_column_id WHERE fk.parent_object_id=OBJECT_ID('gp.VisitPlanNotices') AND col.name='RecipientUserId');
IF @fk IS NULL THROW 52000,'Recipient integrity contract required.',1;
DECLARE @drop nvarchar(max)=N'ALTER TABLE gp.VisitPlanNotices DROP CONSTRAINT '+QUOTENAME(@fk);EXEC sys.sp_executesql @drop;
ALTER TABLE gp.VisitPlanNotices ALTER COLUMN RecipientUserId uniqueidentifier NULL;
ALTER TABLE gp.VisitPlanNotices ADD RecipientEmail nvarchar(320) NULL;
GO
ALTER TABLE gp.VisitPlanNotices ADD CONSTRAINT FK_VisitPlanNotices_User FOREIGN KEY(RecipientUserId) REFERENCES gp.Users(UserId),CONSTRAINT CK_VisitPlanNotices_Recipient CHECK((RecipientUserId IS NOT NULL AND RecipientEmail IS NULL) OR(RecipientUserId IS NULL AND RecipientEmail IS NOT NULL AND Kind IN('FYI','UPDATE','CANCELLED')));
CREATE UNIQUE INDEX UX_VisitPlanNotices_Logical ON gp.VisitPlanNotices(PlanId,EventSequence,RecipientUserId,Kind,TargetId) WHERE RecipientUserId IS NOT NULL;
CREATE UNIQUE INDEX UX_VisitPlanNotices_Email ON gp.VisitPlanNotices(PlanId,EventSequence,RecipientEmail,Kind,TargetId) WHERE RecipientEmail IS NOT NULL;
GO
CREATE FUNCTION gp._VisitGroupProjection(@Group uniqueidentifier,@Members nvarchar(max),@Now datetime2(3),@Cutoff datetime2(3)) RETURNS nvarchar(max) WITH INLINE=OFF AS BEGIN
 RETURN COALESCE((SELECT JSON_VALUE(m.value,'$.kind') kind,TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,'$.userId')) userId,
  COALESCE(e.FullName,JSON_VALUE(m.value,'$.name'),JSON_VALUE(m.value,'$.email'),N'Unavailable employee') name,COALESCE(e.OfficialEmail,JSON_VALUE(m.value,'$.email'),N'') email,
  CONVERT(bit,CASE WHEN JSON_VALUE(m.value,'$.userId') IS NULL OR gp._PlanningInternal(TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,'$.userId')),@Now,@Cutoff)=1 THEN 1 ELSE 0 END) available
  FROM OPENJSON(@Members) m LEFT JOIN gp.Employees e ON e.UserId=TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,'$.userId')) ORDER BY JSON_VALUE(m.value,'$.kind'),COALESCE(e.FullName,JSON_VALUE(m.value,'$.email')) FOR JSON PATH),N'[]');
END;
GO
DECLARE @d nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ReadVisitCoordination')),@needle nvarchar(max),@replacement nvarchar(max);
SET @d=REPLACE(@d,N'''PEOPLE'',''ROUTING''',N'''PEOPLE'',''ROUTING'',''GROUPS''');
SET @needle=N' IF @Mode IN(''PEOPLE'',''ROUTING'',''GROUPS'') BEGIN';
SET @replacement=N' IF @Mode=''GROUPS'' BEGIN
  IF @location IS NULL OR @location<=0 OR(gp._PlanningSponsor(@actor,@location,@now,@cutoff)=0 AND gp._PlanningAdmin(@actor,@location,NULL,@now)=0 AND NOT EXISTS(SELECT 1 FROM gp.SubProjects s WHERE s.LocationId=@location AND gp._PlanningAdmin(@actor,@location,s.SubProjectId,@now)=1)) THROW 52001,''Scoped invitation/group access required.'',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@QueryJson) WHERE [key] NOT IN(''locationId'',''search'')) OR(@search IS NOT NULL AND(LEN(LTRIM(RTRIM(@search)))<2 OR LEN(@search)>80)) THROW 52002,''Invalid group search.'',1;
  SET @result=(SELECT JSON_QUERY(COALESCE((SELECT TOP(200) g.GroupId id,g.LocationId locationId,g.SubProjectId subProjectId,g.Name name,g.Description description,g.IsVipOnly vipOnly,g.IsActive active,g.Revision revision,gp._PlanningAdmin(@actor,g.LocationId,g.SubProjectId,@now) canManage,JSON_QUERY(gp._VisitGroupProjection(g.GroupId,g.MembersJson,@now,@cutoff)) members
   FROM gp.VisitRoutingGroups g WHERE g.LocationId=@location AND(gp._PlanningAdmin(@actor,g.LocationId,g.SubProjectId,@now)=1 OR(g.IsActive=1 AND gp._PlanningSponsor(@actor,g.LocationId,@now,@cutoff)=1)) AND(@search IS NULL OR CHARINDEX(@search,g.Name)>0) ORDER BY g.Name,g.GroupId FOR JSON PATH),N''[]'')) groups FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @Mode IN(''PEOPLE'',''ROUTING'') BEGIN';
IF CHARINDEX(@needle,@d)=0 THROW 52000,'Read routing contract required.',1;
SET @d=REPLACE(@d,@needle,@replacement);
SET @needle=N'AND gp._PlanningAdmin(@actor,@location,NULL,@now)=0) THROW 52001,''Current invitation-host scope required.''';
SET @d=REPLACE(@d,@needle,N'AND gp._PlanningAdmin(@actor,@location,NULL,@now)=0 AND NOT(@Mode=''PEOPLE'' AND EXISTS(SELECT 1 FROM gp.SubProjects s WHERE s.LocationId=@location AND gp._PlanningAdmin(@actor,@location,s.SubProjectId,@now)=1))) THROW 52001,''Current invitation-host scope required.''');
SET @needle=N' IF @Mode=''DETAIL'' BEGIN';
/* Only authorized detail scopes receive a group snapshot; task-only readers do not. */
SET @replacement=N' IF @Mode=''DETAIL'' BEGIN
  SET @result=JSON_MODIFY(@result,''$.selectedGroups'',JSON_QUERY(COALESCE((SELECT g.GroupId id,g.Revision revision,g.Name name,g.SubProjectId subProjectId,g.IsVipOnly vipOnly,JSON_QUERY(gp._VisitGroupProjection(g.GroupId,g.MembersJson,@now,@cutoff)) members FROM gp.VisitPlanGroups g WHERE g.PlanId=@plan AND g.Version=@version AND(@actor=@owner OR @full=1 OR @office=1 OR g.SubProjectId IS NOT NULL AND gp._PlanProjectReadable(@actor,@plan,@version,g.SubProjectId,@now,@cutoff)=1) ORDER BY g.Name,g.GroupId FOR JSON PATH),N''[]'')));
';
IF CHARINDEX(@needle,@d)=0 THROW 52000,'Detail projection contract required.',1;
SET @d=REPLACE(@d,@needle,@replacement);
SET @needle=N'   DECLARE @ownerDraft nvarchar(max)=';
/* Insert after migration 134 has normalized the owner draft into a JSON object. */
SET @needle=N'   SET @result=JSON_MODIFY(@result,''$.draft.additionalPeople'',JSON_QUERY';
SET @replacement=N'   SET @result=JSON_MODIFY(@result,''$.draft.groups'',JSON_QUERY(COALESCE((SELECT GroupId id,Revision revision FROM gp.VisitPlanGroups WHERE PlanId=@plan AND Version=@version ORDER BY GroupId FOR JSON PATH),N''[]'')));
'+@needle;
IF CHARINDEX(@needle,@d)=0 THROW 52000,'Draft recipient contract required.',1;
SET @d=REPLACE(@d,@needle,@replacement);SET @d=STUFF(@d,1,CHARINDEX(' ',@d)-1,'ALTER');EXEC sys.sp_executesql @d;
GO
DECLARE @d nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ChangePlannedVisit')),@needle nvarchar(max);
SET @needle=N' END ELSE IF @kind IN(''CANCEL'',''REVISE'') BEGIN';
IF CHARINDEX(@needle,@d)=0 THROW 52000,'Submission notice contract required.',1;
SET @d=REPLACE(@d,@needle,N'  INSERT @notices SELECT DISTINCT TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,''$.userId'')),''FYI'',NULL FROM gp.VisitPlanGroups g CROSS APPLY OPENJSON(g.MembersJson) m WHERE g.PlanId=@PlanId AND g.Version=@version AND JSON_VALUE(m.value,''$.kind'')=''NOTIFY'' AND JSON_VALUE(m.value,''$.userId'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM @notices n WHERE n.UserId=TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,''$.userId'')) AND n.Kind=''FYI'');
'+@needle);
SET @d=REPLACE(@d,N'UNION SELECT RecipientUserId FROM gp.VisitPlanNotices WHERE PlanId=@PlanId AND Kind=''FYI''',N'UNION SELECT RecipientUserId FROM gp.VisitPlanNotices WHERE PlanId=@PlanId AND Kind=''FYI'' AND RecipientUserId IS NOT NULL');
SET @needle=N' INSERT gp.VisitPlanNotices SELECT DISTINCT';
IF CHARINDEX(@needle,@d)=0 THROW 52000,'Notice insertion contract required.',1;
SET @d=REPLACE(@d,@needle,N' INSERT gp.VisitPlanNotices(PlanId,EventSequence,NoticeId,RecipientUserId,Kind,TargetId) SELECT DISTINCT');
SET @needle=N' SET @result=(SELECT @PlanId id';
IF CHARINDEX(@needle,@d)=0 THROW 52000,'Command receipt contract required.',1;
SET @d=REPLACE(@d,@needle,N' IF @kind IN(''SUBMIT'',''CANCEL'',''REVISE'') BEGIN
  DECLARE @groupSource int=@version;
  IF @kind IN(''CANCEL'',''REVISE'') SELECT @groupSource=MAX(Version) FROM gp.VisitPlanEvents WHERE PlanId=@PlanId AND Kind=''SUBMIT'' AND Sequence<@sequence;
  INSERT gp.VisitPlanNotices(PlanId,EventSequence,NoticeId,RecipientUserId,Kind,TargetId,RecipientEmail)
   SELECT @PlanId,@sequence,NEWID(),NULL,CASE @kind WHEN ''SUBMIT'' THEN ''FYI'' WHEN ''CANCEL'' THEN ''CANCELLED'' ELSE ''UPDATE'' END,NULL,x.Email FROM(SELECT DISTINCT LOWER(JSON_VALUE(m.value,''$.email'')) Email FROM gp.VisitPlanGroups s JOIN gp.VisitRoutingGroups g ON g.GroupId=s.GroupId CROSS APPLY OPENJSON(s.MembersJson) m
    WHERE s.PlanId=@PlanId AND s.Version=@groupSource AND g.IsActive=1 AND JSON_VALUE(m.value,''$.kind'')=''NOTIFY'' AND JSON_VALUE(m.value,''$.userId'') IS NULL AND JSON_VALUE(m.value,''$.email'') IS NOT NULL AND EXISTS(SELECT 1 FROM OPENJSON(g.MembersJson) c WHERE LOWER(JSON_VALUE(c.value,''$.email''))=LOWER(JSON_VALUE(m.value,''$.email'')) AND JSON_VALUE(c.value,''$.kind'')=''NOTIFY'')) x WHERE NOT EXISTS(SELECT 1 FROM gp.VisitPlanNotices n JOIN gp.Employees e ON e.UserId=n.RecipientUserId WHERE n.PlanId=@PlanId AND n.EventSequence=@sequence AND n.Kind=CASE @kind WHEN ''SUBMIT'' THEN ''FYI'' WHEN ''CANCEL'' THEN ''CANCELLED'' ELSE ''UPDATE'' END AND LOWER(e.OfficialEmail)=x.Email);
 END;
'+@needle);SET @d=STUFF(@d,1,CHARINDEX(' ',@d)-1,'ALTER');EXEC sys.sp_executesql @d;
GO
/* Re-evaluate every queued notification under current group membership. */
DECLARE @d nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp._PlanningMailAudience')),@needle nvarchar(max);
SET @needle=N' IF @user IS NULL OR @current<>@version';
IF CHARINDEX(@needle,@d)=0 THROW 52000,'Mail audience contract required.',1;
SET @d=REPLACE(@d,@needle,N' DECLARE @groupEmail nvarchar(320)=(SELECT RecipientEmail FROM gp.VisitPlanNotices WHERE PlanId=@Plan AND NoticeId=@Notice);
 IF @groupEmail IS NOT NULL BEGIN
  IF @kind NOT IN(''FYI'',''UPDATE'',''CANCELLED'') OR @current<>@version OR @until IS NULL OR NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@location AND IsActive=1) OR(@event NOT IN(''CANCEL'',''REVISE'') AND(@state<>''SUBMITTED'' OR @Now>=@until)) RETURN ''NONE'';
  IF EXISTS(SELECT 1 FROM gp.VisitPlanGroups s JOIN gp.VisitRoutingGroups g ON g.GroupId=s.GroupId CROSS APPLY OPENJSON(s.MembersJson) m WHERE s.PlanId=@Plan AND s.Version=@source AND g.IsActive=1 AND LOWER(JSON_VALUE(m.value,''$.email''))=LOWER(@groupEmail) AND JSON_VALUE(m.value,''$.kind'')=''NOTIFY'' AND EXISTS(SELECT 1 FROM OPENJSON(g.MembersJson) c WHERE LOWER(JSON_VALUE(c.value,''$.email''))=LOWER(@groupEmail) AND JSON_VALUE(c.value,''$.kind'')=''NOTIFY'')) RETURN ''FYI'';
  RETURN ''NONE'';
 END;
'+@needle);
SET @needle=N' /* FYI is current-policy information, never membership or approval authority. */';
SET @d=REPLACE(@d,@needle,N' IF @kind IN(''FYI'',''UPDATE'',''CANCELLED'') AND EXISTS(SELECT 1 FROM gp.VisitPlanGroups s JOIN gp.VisitRoutingGroups g ON g.GroupId=s.GroupId CROSS APPLY OPENJSON(s.MembersJson) m WHERE s.PlanId=@Plan AND s.Version=@source AND g.IsActive=1 AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,''$.userId''))=@user AND JSON_VALUE(m.value,''$.kind'')=''NOTIFY'' AND EXISTS(SELECT 1 FROM OPENJSON(g.MembersJson) c WHERE TRY_CONVERT(uniqueidentifier,JSON_VALUE(c.value,''$.userId''))=@user AND JSON_VALUE(c.value,''$.kind'')=''NOTIFY'')) RETURN ''FYI'';
'+@needle);SET @d=STUFF(@d,1,CHARINDEX(' ',@d)-1,'ALTER');EXEC sys.sp_executesql @d;
SET @d=OBJECT_DEFINITION(OBJECT_ID('gp._PlanningMailJson'));SET @needle=N' SET @result=(SELECT ''READY'' status';
IF CHARINDEX(@needle,@d)=0 THROW 52000,'Mail rendering contract required.',1;
SET @d=REPLACE(@d,@needle,N' DECLARE @externalEmail nvarchar(320)=(SELECT RecipientEmail FROM gp.VisitPlanNotices WHERE PlanId=@Plan AND NoticeId=@NoticeId);
 IF @externalEmail IS NOT NULL BEGIN
  SET @result=(SELECT ''READY'' status,@NoticeId noticeId,@plan planId,@kind kind,''FYI'' audience,@event eventKind,@source version,@externalEmail recipientEmail,CONVERT(bit,0) canReview,
   JSON_QUERY((SELECT v.VisitorName visitorName,l.LocationName locationName,h.FullName hostName,v.IsVip vip,REPLACE(CONVERT(char(23),v.StartsAtUtc,121),'' '',''T'')+''Z'' startsAtUtc,REPLACE(CONVERT(char(23),v.UntilUtc,121),'' '',''T'')+''Z'' untilUtc,JSON_QUERY(N''[]'') destinations FROM gp.VisitPlanVersions v JOIN gp.Locations l ON l.LocationId=v.LocationId JOIN gp.VisitPlans p ON p.PlanId=v.PlanId JOIN gp.Employees h ON h.UserId=p.HostUserId WHERE v.PlanId=@plan AND v.Version=@source FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) details FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);RETURN;
 END;
'+@needle);SET @d=STUFF(@d,1,CHARINDEX(' ',@d)-1,'ALTER');EXEC sys.sp_executesql @d;
INSERT gp.SchemaMigrations(Version,Description) VALUES('136',N'Visible scoped group membership, versioned selection and deduplicated internal/explicit-email FYI through existing fenced mail dispatch');
COMMIT;
