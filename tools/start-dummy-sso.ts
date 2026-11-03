import {PlanningRoutes} from '../src/development/PlanningRoutes.ts';
import {PlanningService} from '../src/planning/PlanningService.ts';
import {buildFrontend} from './frontend-build.mjs';
import {reactDocument} from '../src/app/ReactDocuments.ts';
import {loadRuntimeEnvironment} from '../src/runtime/Environment.ts';
import {ActionCentreService} from '../src/operations/ActionCentreService.ts';
import {ActionCentreRoutes} from '../src/development/ActionCentreRoutes.ts';
import {GuardThumbnailService} from '../src/visits/GuardThumbnailService.ts';
import{PhotoThumbnails}from'../src/visits/PhotoThumbnails.ts';
import {AdministrationReadService,SqlAdministrationReadRepository} from '../src/administration/AdministrationReadService.ts';
import {AdminConsoleService} from '../src/administration/AdminConsoleService.ts';
import {HostReminderService} from '../src/email/HostReminderService.ts';
import {EmailWorkflowRoutes} from '../src/development/EmailWorkflowRoutes.ts';
import {EmailWorkflowService} from '../src/email/EmailWorkflowService.ts';
import {localEmailLinks} from '../src/email/LocalEmailLinks.ts';
import {GuardRoutes} from '../src/development/GuardRoutes.ts';
import {GuardWorkspaceService} from '../src/visits/GuardWorkspaceService.ts';
import {GuardDutyService} from '../src/visits/GuardDutyService.ts';
import {localNameReadings} from '../src/development/LocalNameReadings.ts';
import {AdminRoutes} from '../src/development/AdminRoutes.ts';
import {AdminWorkspaceService} from '../src/administration/AdminWorkspaceService.ts';
import {StaffAdministrationService,SqlStaffAdministrationRepository} from '../src/administration/StaffAdministrationService.ts';
import {StaffEntryRoutes} from '../src/development/StaffEntryRoutes.ts';
import {loadPwaAssets} from '../src/app/PwaAssets.ts';
import {StaffAuthService} from '../src/security/StaffAuthService.ts';
import {SqlStaffAuthRepository} from '../src/security/StaffAuthService.ts';
import {ReceptionService} from '../src/reception/ReceptionService.ts';
import {ReceptionRegistrationRoutes} from '../src/development/ReceptionRegistrationRoutes.ts';
import {ReceptionRoutes} from '../src/development/ReceptionRoutes.ts';
import {PassPrintService,PassRenderService} from '../src/printing/PassPrintService.ts';
import {SqlPassPrintRepository} from '../src/printing/SqlPassPrintRepository.ts';
import {OwnDigitalIdCardService,OwnCardError} from '../src/printing/OwnDigitalIdCardService.ts';
import {PassCardRenderer} from '../src/printing/PassCardRenderer.ts';
import {rasterizeCardPng} from '../src/printing/CardPngRasterizer.ts';
import {NodeQrMatrixEncoder} from '../src/printing/NodeQrMatrixEncoder.ts';
import { getCountries } from 'libphonenumber-js/max';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash,randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DummyEmployeeSso, LocalDevelopmentSsoRepository, requireDummySso } from '../src/development/DummyEmployeeSso.ts';
import { DummySsoRoutes } from '../src/development/DummySsoRoutes.ts';
import { createLoopbackHttpHandler } from '../src/development/LoopbackHttpHandler.ts';
import { LocalDevelopmentApiClient } from '../src/development/LocalDevelopmentApiClient.ts';
import { EmployeeDigitalIdRoutes } from '../src/development/EmployeeDigitalIdRoutes.ts';
import { RegistrationService } from '../src/registration/RegistrationService.ts';
import { SqlRegistrationRepository } from '../src/registration/SqlRegistrationRepository.ts';
import { SharpPhotoNormalizer } from '../src/registration/RegistrationPhoto.ts';
import { RegistrationHttpRoutes } from '../src/transport/RegistrationHttpRoutes.ts';
import { VisitReadService,VisitPhotoService } from '../src/visits/VisitReadService.ts';
import { SqlVisitReadRepository } from '../src/visits/SqlVisitReadRepository.ts';
import { openLocalPrivateStorage } from '../src/storage/LocalPrivateStorage.ts';
import {OfficeEntryContext,officeNames} from '../src/development/OfficeEntryContext.ts';
import {WorkspaceChanges} from '../src/development/WorkspaceChanges.ts';
import {WorkspaceEventRoutes} from '../src/development/WorkspaceEventRoutes.ts';
import {HttpFailure} from '../src/transport/ApiHandler.ts';
import {LoadDiagnostics} from '../src/development/LoadDiagnostics.ts';

// Explicit alternative entry point. Production start-api never imports this module.
try {
  loadRuntimeEnvironment();requireDummySso();
  const port = Number(process.env.GATEPASS_DUMMY_PORT ?? '8443'); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_LOCAL_PORT');
  const origin = `http://localhost:${port}`;
  const pwaAssets=await loadPwaAssets();
  const repository = new LocalDevelopmentSsoRepository();
  const sso = new DummyEmployeeSso(repository);
  if ((await repository.execute('refresh', null, null, null)).ok !== true) throw new Error('DUMMY_DIRECTORY_UNAVAILABLE');
  const [globalStyles,styles,staffStyles,guardStyles,receptionStyles,adminStyles,workspaceShellStyles,actionStyles,imageViewerStyles,printMarkup,exportWorker,qrDecoder,emailStyles]=await Promise.all([
    ...['global.css','employee-portal.css','staff-entry.css','guard.css','reception.css','admin.css','workspace-shell.css','action-centre.css','image-viewer.css','reception-print.html','register-export-worker.js'].map(name=>readFile(new URL('../src/app/'+name,import.meta.url),'utf8')),
    readFile(new URL('../node_modules/@zxing/library/umd/index.min.js',import.meta.url),'utf8'),readFile(new URL('../src/frontend/email.css',import.meta.url),'utf8')
  ]);
  const exportWorkerUrl='/assets/register-export-'+createHash('sha256').update(exportWorker).digest('hex').slice(0,16)+'.js';
  const qrDecoderUrl='/assets/qr-decoder-'+createHash('sha256').update(qrDecoder).digest('hex').slice(0,16)+'.js';
  const staffBrand=(await readFile(new URL('../assets/brand/gatepass-logo.png',import.meta.url))).toString('base64');
  const companyLogo=(await readFile(new URL('../assets/brand/sopra-steria-logo.png',import.meta.url))).toString('base64');
  const reactFrontend=await buildFrontend({testMode:process.env.NODE_ENV==='test'});
  const planningStyles=await readFile(new URL('../src/frontend/coordination.css',import.meta.url),'utf8');
  const reactStyles={coordination:globalStyles+'\n'+workspaceShellStyles+'\n'+planningStyles,staff:globalStyles+'\n'+workspaceShellStyles+'\n'+staffStyles,'self-service':globalStyles+'\n'+styles,guard:globalStyles+'\n'+workspaceShellStyles+'\n'+guardStyles+'\n'+actionStyles+'\n'+imageViewerStyles,reception:globalStyles+'\n'+workspaceShellStyles+'\n'+receptionStyles+'\n'+actionStyles+'\n'+imageViewerStyles,admin:globalStyles+'\n'+workspaceShellStyles+'\n'+planningStyles+'\n'+adminStyles+'\n'+actionStyles+'\n'+imageViewerStyles,email:globalStyles+'\n'+emailStyles};
  const reactPage=(page:import('../src/frontend/types.ts').PageName,officeCode='NOIDA',manualReception=false)=>reactDocument({page,companyLogo:'data:image/png;base64,'+companyLogo,gatepassLogo:'data:image/png;base64,'+staffBrand,officeCode,officeName:officeNames[officeCode],manualReception,qrDecoderUrl,exportWorkerUrl},reactStyles[page],reactFrontend.pages[page]);
  const officeImage=await readFile(new URL('../assets/locations/office-background.png',import.meta.url));
  const countryFlags=new Map(await Promise.all(getCountries().map(async code=>[code.toLowerCase(),await readFile(new URL('../node_modules/flag-icons/flags/4x3/'+(code==='AC'?'sh-ac':code==='TA'?'sh-ta':code.toLowerCase())+'.svg',import.meta.url))] as const)));
  const officeContext=new OfficeEntryContext(randomBytes(32));
  const storage = await openLocalPrivateStorage(process.env.GATEPASS_TEST_STORAGE_ROOT);
  const require = createRequire(import.meta.url);
  const sharp = require(process.env.GATEPASS_SHARP_PATH ?? join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','sharp'));
  const client = new LocalDevelopmentApiClient();
  const changes=new WorkspaceChanges();client.onSuccess=(name,parameters,result)=>changes.observe(name,parameters,result);
  const diagnostics=process.env.NODE_ENV==='test'&&process.env.GATEPASS_LOAD_DIAGNOSTICS==='1'&&typeof process.send==='function'?new LoadDiagnostics():undefined;
  if(diagnostics){
    client.onTiming=row=>diagnostics.record(row);
    process.on('message',(message:any)=>{if(message?.type==='gatepass-load-stop'){stop();return;}if(message?.type!=='gatepass-load-snapshot'||typeof message.id!=='string')return;if(message.gc===true)global.gc?.();process.send?.({type:'gatepass-load-snapshot',id:message.id,runId:process.env.GATEPASS_LOAD_RUN_ID,...diagnostics.snapshot(message.reset===true),streams:changes.connections});});
  }
  const registration = new RegistrationService(new SqlRegistrationRepository(client),storage.keys,new SharpPhotoNormalizer(sharp),storage.photos);
  const [organisationLogoPng,applicationLogoPng,organisationIconPng]=await Promise.all(['sopra-steria-logo.png','gatepass-logo.png','sopra-steria-icon.png'].map(name=>readFile(new URL('../assets/brand/'+name,import.meta.url))));
  const thumbnails=new PhotoThumbnails(sharp);
  const cardRenderer=new PassCardRenderer(new NodeQrMatrixEncoder(),{organisationLogoPng,applicationLogoPng,organisationIconPng});
  const publicCards=new OwnDigitalIdCardService(client,storage.keys,storage.photos,cardRenderer,svg=>rasterizeCardPng(sharp,svg),'PUBLIC');
  const ownCards=new OwnDigitalIdCardService(client,storage.keys,storage.photos,cardRenderer,svg=>rasterizeCardPng(sharp,svg));
  const receptionReads=new VisitReadService(new SqlVisitReadRepository(client,'api'));
  const receptionPhotos=new VisitPhotoService(new SqlVisitReadRepository(client,'media'),storage.photos);
  const receptionCards=new OwnDigitalIdCardService(client,storage.keys,storage.photos,cardRenderer,svg=>rasterizeCardPng(sharp,svg),'RECEPTION');
  const guardAuth=await StaffAuthService.create(new SqlStaffAuthRepository(client));
  const staffEntry=new StaffEntryRoutes(sso,guardAuth,client);
  const reception=new ReceptionRoutes(sso,new ReceptionService(client),receptionReads,receptionPhotos,receptionCards,new PassPrintService(new SqlPassPrintRepository(client,'api'),storage.keys),new PassRenderService(new SqlPassPrintRepository(client,'render'),storage.keys,storage.photos,cardRenderer),staffEntry,new HostReminderService(client));
  const emailService=new EmailWorkflowService(client,await localEmailLinks(storage.root));
  const employeeRequestCards=new OwnDigitalIdCardService(client,storage.keys,storage.photos,cardRenderer,svg=>rasterizeCardPng(sharp,svg),'REQUEST');
  const externalRequestCards=new OwnDigitalIdCardService(client,storage.keys,storage.photos,cardRenderer,svg=>rasterizeCardPng(sharp,svg),'EMAIL');
  const manualRegistration=new ReceptionRegistrationRoutes(staffEntry,new ReceptionService(client),registration,randomBytes(32),client,(ctx,id)=>publicCards.image({sessionToken:ctx.intakeToken,csrfToken:ctx.intakeCsrfToken},id,undefined,ctx.intakeId));
  // Explicit opt-in only: public Input Tools is an experimental display aid.
  const nameReadings=await localNameReadings(storage.root);
  const adminConsole=new AdminConsoleService(client),duties=new GuardDutyService(client),receptionWorkspace=new ReceptionService(client);
  const events=new WorkspaceEventRoutes(staffEntry,changes,async(session,input)=>{
    const location=input.locationId,topics=new Set<string>();
    if(input.workspace==='ADMIN'){
      // A successful office-only read is the authority for office-wide invalidations.
      // The role list can contain grants from other offices and must not widen this subscription.
      await adminConsole.read(session,'scope',{locationId:location,...(input.projectLocationId?{projectLocationId:input.projectLocationId}:{})});
      if(input.projectLocationId){topics.add('p:'+location+':'+input.projectLocationId);topics.add('d:'+location);topics.add('s:'+location+':'+input.projectLocationId);}
      else topics.add('o:'+location);
    }else if(input.workspace==='GUARD'){
      const scope=await duties.duties(session,{locationId:location});
      topics.add('s:'+location);
      for(const duty of scope.duties)if(duty.kind==='COMMON')topics.add('c:'+location);else topics.add('p:'+location+':'+duty.dutyId);
      topics.add('d:'+location);
    }else{
      const scope=await receptionWorkspace.context(session);
      if(!scope.locations.some((l:{locationId:number})=>l.locationId===location))throw new HttpFailure(403);
      topics.add('o:'+location);
    }
    return topics;
  });
  const routes = [new PlanningRoutes(staffEntry,new PlanningService(client)),new ActionCentreRoutes(staffEntry,sso,new ActionCentreService(client)),events,manualRegistration,new EmailWorkflowRoutes(sso,emailService,receptionPhotos,employeeRequestCards,externalRequestCards),staffEntry,new GuardRoutes(staffEntry,new GuardWorkspaceService(client),receptionReads,receptionPhotos,duties,new HostReminderService(client),nameReadings,thumbnails,new GuardThumbnailService(client,storage.photos,thumbnails)),new AdminRoutes(staffEntry,new AdminWorkspaceService(client),new StaffAdministrationService(new SqlStaffAdministrationRepository(client)),duties,new AdministrationReadService(new SqlAdministrationReadRepository(client)),adminConsole,receptionReads,organisationIconPng,sharp),reception,new DummySsoRoutes(sso,{localHttp:true}),
    new RegistrationHttpRoutes(registration,randomBytes(32),sso,{localHttp:true,allowedTypes:['DIGITAL_ID','EXTERNAL','EMPLOYEE_PROJECT'],card:async(ctx,id)=>{try{return await publicCards.image({sessionToken:ctx.intakeToken,csrfToken:ctx.intakeCsrfToken},id,undefined,ctx.intakeId);}catch(e){throw new HttpFailure(e instanceof OwnCardError?e.status:503);}},office:req=>officeContext.read(req)}),
    new EmployeeDigitalIdRoutes(sso,new VisitReadService(new SqlVisitReadRepository(client,'api')),ownCards)];
  const api = createLoopbackHttpHandler(origin,{handles:path=>routes.some(route=>route.handles(path)),handle:(req,res)=>{
    const route=routes.find(route=>route.handles(req.url??''));if(!route)throw new Error('UNKNOWN_ROUTE');return route.handle(req,res);
  }});
  const server = createServer({ maxHeaderSize: 16384 }, (req, res) => {
    // Public login shell may be opened from an external link. API POSTs still
    // enforce exact Origin/Host and CSRF through the separate handler below.
    const publicPeer=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')&&req.headers.host===`localhost:${port}`;
    if(publicPeer&&pwaAssets(req,res))return;
    const reactAsset=reactFrontend.assets.get((req.url??'').split('?')[0]);if(req.method==='GET'&&publicPeer&&reactAsset){res.setHeader('Content-Type','application/javascript; charset=utf-8');res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.setHeader('X-Content-Type-Options','nosniff');res.end(reactAsset);return;}
    const pathname=(req.url??'').split('?')[0];
    if(req.method==='GET'&&pathname===exportWorkerUrl&&publicPeer){res.setHeader('Content-Type','application/javascript; charset=utf-8');res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.setHeader('X-Content-Type-Options','nosniff');res.end(exportWorker);return;}
    if(req.method==='GET'&&pathname===qrDecoderUrl&&publicPeer){res.setHeader('Content-Type','application/javascript; charset=utf-8');res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.setHeader('X-Content-Type-Options','nosniff');res.end(qrDecoder);return;}
    if(req.method==='GET'&&pathname==='/assets/office-background.png'&&publicPeer){
      res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','public, max-age=86400');res.setHeader('X-Content-Type-Options','nosniff');res.end(officeImage);return;
    }
    const flag=/^\/assets\/flags\/([a-z]{2})\.svg$/u.exec(pathname);
    if(req.method==='GET'&&flag&&publicPeer&&countryFlags.has(flag[1])){res.setHeader('Content-Type','image/svg+xml');res.setHeader('Cache-Control','public, max-age=86400');res.setHeader('X-Content-Type-Options','nosniff');res.end(countryFlags.get(flag[1]));return;}
    if(req.method==='GET'&&['/','/coordination','/coordination/','/guard','/guard/','/admin','/admin/','/reception','/reception/','/reception/print'].includes(pathname)&&publicPeer){
      if(['/coordination','/coordination/','/guard','/guard/','/admin','/admin/','/reception','/reception/'].includes(pathname)&&!/(?:^|;\s*)gp-(?:staff|reception)-session=/.test(req.headers.cookie??'')){res.statusCode=303;res.setHeader('Location',pathname.startsWith('/coordination')?'/?next=coordination':'/');res.setHeader('Cache-Control','no-store');res.end();return;}
      const nonce=randomBytes(24).toString('base64');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; worker-src 'self'; manifest-src 'self'; style-src 'nonce-${nonce}'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; frame-ancestors ${pathname==='/reception/print'?"'self'":"'none'"}; base-uri 'none'; form-action 'self'`);
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy',['/guard','/guard/','/reception','/reception/'].includes(pathname)?'camera=(self), microphone=(), geolocation=()':'camera=(), microphone=(), geolocation=()');
      const page=pathname==='/'?reactPage('staff'):['/coordination','/coordination/'].includes(pathname)?reactPage('coordination'):['/guard','/guard/'].includes(pathname)?reactPage('guard'):['/admin','/admin/'].includes(pathname)?reactPage('admin'):pathname==='/reception/print'?printMarkup:reactPage('reception');
      res.end(page.replaceAll('__NONCE__',nonce).replaceAll('__COMPANY_LOGO__',companyLogo));return;
    }
    if(req.method==='GET'&&/^\/(approval|request)\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/?$/iu.test(pathname)&&publicPeer){
      const nonce=randomBytes(24).toString('base64');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);res.end(reactPage('email').replaceAll('__NONCE__',nonce).replaceAll('__COMPANY_LOGO__',companyLogo));return;
    }
    const manualEntry=/^\/reception\/register\/(noida|bengaluru|chennai|pune)$/u.exec(pathname);
    if(req.method==='GET'&&manualEntry&&publicPeer){
      const officeCode=manualEntry[1].toUpperCase(),nonce=randomBytes(24).toString('base64');
      res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data: blob:; media-src blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'`);
      res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
      res.end(reactPage('self-service',officeCode,true).replaceAll('__NONCE__',nonce));return;
    }
    const entry=/^\/office\/(noida|bengaluru|chennai|pune)\/?$/u.exec(pathname);
    if (req.method === 'GET' && entry && publicPeer) {
      const officeCode=entry[1].toUpperCase();
      officeContext.issue(res,officeCode);
      const nonce = randomBytes(24).toString('base64'); res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; worker-src 'self'; manifest-src 'self'; style-src 'nonce-${nonce}'; img-src 'self' data: blob:; media-src blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
      res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy','no-referrer'); res.end(reactPage('self-service',officeCode).replaceAll('__NONCE__',nonce));
    } else void api(req, res);
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxConnections=16;server.maxRequestsPerSocket=100;
  const refresh = setInterval(() => { void repository.execute('refresh',null,null,null).then(result=>{if(result.ok!==true)console.error('DUMMY_DIRECTORY_REFRESH_FAILED');}).catch(()=>console.error('DUMMY_DIRECTORY_REFRESH_FAILED')); },60000);refresh.unref();
  const stop = () => { clearInterval(refresh);diagnostics?.close();changes.close();thumbnails.close();server.close(async () => { storage.keys.clearCache();await sso.close();await client.close(); process.exitCode=0;if(diagnostics)process.disconnect?.(); });server.closeIdleConnections(); };
  server.on('error', async () => { clearInterval(refresh);changes.close();thumbnails.close();storage.keys.clearCache();console.error('DUMMY_SSO_LISTENER_UNAVAILABLE');await sso.close();await client.close();process.exitCode=1; });
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  // Advertise HTTP readiness only after every configured helper acknowledges.
  await client.warmUp();
  server.listen(port,'127.0.0.1',()=>{
    console.log(`GatePass employee portal: ${origin} (local HTTP; temporary employee sign-in adapter)`);
    if(diagnostics)process.send?.({type:'gatepass-load-ready',runId:process.env.GATEPASS_LOAD_RUN_ID,pid:process.pid});
  });
} catch { console.error('DUMMY_SSO_STARTUP_FAILED: requires development/test, GATEPASS_SSO_MODE=dummy, GATEPASS_DIRECTORY_MODE=mock, local SQL and PowerShell 7.');process.exitCode=1; }
