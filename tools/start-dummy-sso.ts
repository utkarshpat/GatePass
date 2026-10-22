import {EmailWorkflowRoutes} from '../src/development/EmailWorkflowRoutes.ts';
import {EmailWorkflowService} from '../src/email/EmailWorkflowService.ts';
import {localEmailLinks} from '../src/email/LocalEmailLinks.ts';
import {GuardRoutes} from '../src/development/GuardRoutes.ts';
import {GuardWorkspaceService} from '../src/visits/GuardWorkspaceService.ts';
import {GuardDutyService} from '../src/visits/GuardDutyService.ts';
import {AdminRoutes} from '../src/development/AdminRoutes.ts';
import {AdminWorkspaceService} from '../src/administration/AdminWorkspaceService.ts';
import {StaffAdministrationService,SqlStaffAdministrationRepository} from '../src/administration/StaffAdministrationService.ts';
import {StaffEntryRoutes} from '../src/development/StaffEntryRoutes.ts';
import {loadPwaAssets,pwaHead} from '../src/app/PwaAssets.ts';
import {StaffAuthService} from '../src/security/StaffAuthService.ts';
import {SqlStaffAuthRepository} from '../src/security/StaffAuthService.ts';
import {ReceptionService} from '../src/reception/ReceptionService.ts';
import {ReceptionRoutes} from '../src/development/ReceptionRoutes.ts';
import {PassPrintService,PassRenderService} from '../src/printing/PassPrintService.ts';
import {SqlPassPrintRepository} from '../src/printing/SqlPassPrintRepository.ts';
import {OwnDigitalIdCardService} from '../src/printing/OwnDigitalIdCardService.ts';
import {PassCardRenderer} from '../src/printing/PassCardRenderer.ts';
import {NodeQrMatrixEncoder} from '../src/printing/NodeQrMatrixEncoder.ts';
import { getCountries } from 'libphonenumber-js/max';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
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

// Explicit alternative entry point. Production start-api never imports this module.
try {
  requireDummySso();
  const port = Number(process.env.GATEPASS_DUMMY_PORT ?? '8443'); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_LOCAL_PORT');
  const origin = `http://localhost:${port}`;
  const pwaAssets=await loadPwaAssets();
  const pwaScript=await readFile(new URL('../src/app/pwa.js',import.meta.url),'utf8');
  const withPwa=(page:string)=>page.replace('</head>',pwaHead+'</head>').replace('</body>','<script nonce="__NONCE__">'+pwaScript+'</script></body>');
  const repository = new LocalDevelopmentSsoRepository();
  const sso = new DummyEmployeeSso(repository);
  if ((await repository.execute('refresh', null, null, null)).ok !== true) throw new Error('DUMMY_DIRECTORY_UNAVAILABLE');
  const [markup, globalStyles, styles, cameraScript, script, phoneLibrary, visitorComponents, toastScript,selectScript,receptionMarkup,receptionStyles,receptionScript,printMarkup,staffMarkup,staffScript] = await Promise.all([
    readFile(new URL('../src/app/employee-portal.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/global.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/employee-portal.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/camera-session.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/employee-portal.js', import.meta.url), 'utf8'),
    readFile(new URL('../node_modules/libphonenumber-js/bundle/libphonenumber-mobile.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/visitor-components.js', import.meta.url), 'utf8'),
    ...['toast-notifications.js','select-control.js','reception.html','reception.css','reception.js','reception-print.html','staff-entry.html','staff-entry.js'].map(name=>readFile(new URL('../src/app/'+name,import.meta.url),'utf8')),
  ]);
  const cropScript=await readFile(new URL('../src/app/photo-crop.js',import.meta.url),'utf8');
  const html = markup.replace('__APP_STYLES__',()=>globalStyles+'\n'+styles).replace('__APP_SCRIPT__',()=>phoneLibrary+'\n'+visitorComponents+'\n'+toastScript+'\n'+selectScript+'\n'+cameraScript+'\n'+cropScript+'\n'+script);
  const [adminMarkup,adminStyles,adminScript]=await Promise.all(['admin.html','admin.css','admin.js'].map(name=>readFile(new URL('../src/app/'+name,import.meta.url),'utf8')));
  const adminHtml=adminMarkup.replace('__STYLES__',()=>globalStyles+'\n'+receptionStyles+'\n'+adminStyles).replace('__SCRIPT__',()=>toastScript+'\n'+selectScript+'\n'+adminScript);
  const guardI18n=await readFile(new URL('../src/app/guard-i18n.js',import.meta.url),'utf8');
  const [guardMarkup,guardStyles,guardScript,qrDecoder]=await Promise.all(['../src/app/guard.html','../src/app/guard.css','../src/app/guard.js','../node_modules/@zxing/library/umd/index.min.js'].map(name=>readFile(new URL(name,import.meta.url),'utf8')));
  const guardHtml=guardMarkup.replace('__STYLES__',()=>globalStyles+'\n'+receptionStyles+'\n'+guardStyles).replace('__SCRIPT__',()=>qrDecoder+'\n'+toastScript+'\n'+selectScript+'\n'+cameraScript+'\n'+guardI18n+'\n'+guardScript);
  const staffStyles=await readFile(new URL('../src/app/staff-entry.css',import.meta.url),'utf8');
  const staffBrand=(await readFile(new URL('../assets/brand/gatepass-logo.png',import.meta.url))).toString('base64');
  const staffHtml=staffMarkup.replace('__STYLES__',()=>globalStyles+'\n'+receptionStyles+'\n'+staffStyles).replace('__GATEPASS_LOGO__',staffBrand).replace('__SCRIPT__',()=>toastScript+'\n'+staffScript);
  const receptionPrintState=await readFile(new URL('../src/app/reception-print-state.js',import.meta.url),'utf8');
  const receptionHtml=receptionMarkup.replace('__STYLES__',()=>globalStyles+'\n'+receptionStyles).replace('__SCRIPT__',()=>toastScript+'\n'+selectScript+'\n'+receptionPrintState+'\n'+receptionScript);
  const companyLogo = (await readFile(new URL('../assets/brand/sopra-steria-logo.png', import.meta.url))).toString('base64');
  const [emailMarkup,emailScript]=await Promise.all(['email-request.html','email-request.js'].map(name=>readFile(new URL('../src/app/'+name,import.meta.url),'utf8')));
  const emailHtml=emailMarkup.replace('__GLOBAL_STYLES__',()=>globalStyles).replace('__EMAIL_SCRIPT__',()=>emailScript);
  const officeImage=await readFile(new URL('../assets/locations/office-background.png',import.meta.url));
  const countryFlags=new Map(await Promise.all(getCountries().map(async code=>[code.toLowerCase(),await readFile(new URL('../node_modules/flag-icons/flags/4x3/'+(code==='AC'?'sh-ac':code==='TA'?'sh-ta':code.toLowerCase())+'.svg',import.meta.url))] as const)));
  const officeContext=new OfficeEntryContext(randomBytes(32));
  const storage = await openLocalPrivateStorage(process.env.GATEPASS_TEST_STORAGE_ROOT);
  const require = createRequire(import.meta.url);
  const sharp = require(process.env.GATEPASS_SHARP_PATH ?? join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','sharp'));
  const client = new LocalDevelopmentApiClient();
  const registration = new RegistrationService(new SqlRegistrationRepository(client),storage.keys,new SharpPhotoNormalizer(sharp),storage.photos);
  const [organisationLogoPng,applicationLogoPng,organisationIconPng]=await Promise.all(['sopra-steria-logo.png','gatepass-logo.png','sopra-steria-icon.png'].map(name=>readFile(new URL('../assets/brand/'+name,import.meta.url))));
  const cardRenderer=new PassCardRenderer(new NodeQrMatrixEncoder(),{organisationLogoPng,applicationLogoPng,organisationIconPng});
  const ownCards=new OwnDigitalIdCardService(client,storage.keys,storage.photos,cardRenderer,async svg=>sharp(svg,{density:300}).resize(1712,1080).png().toBuffer());
  const receptionReads=new VisitReadService(new SqlVisitReadRepository(client,'api'));
  const receptionPhotos=new VisitPhotoService(new SqlVisitReadRepository(client,'media'),storage.photos);
  const receptionCards=new OwnDigitalIdCardService(client,storage.keys,storage.photos,cardRenderer,async svg=>sharp(svg,{density:300}).resize(1712,1080).png().toBuffer(),'RECEPTION');
  const guardAuth=await StaffAuthService.create(new SqlStaffAuthRepository(client));
  const staffEntry=new StaffEntryRoutes(sso,guardAuth,client);
  const reception=new ReceptionRoutes(sso,new ReceptionService(client),receptionReads,receptionPhotos,receptionCards,new PassPrintService(new SqlPassPrintRepository(client,'api'),storage.keys),new PassRenderService(new SqlPassPrintRepository(client,'render'),storage.keys,storage.photos,cardRenderer),staffEntry);
  const emailService=new EmailWorkflowService(client,await localEmailLinks(storage.root));
  const employeeRequestCards=new OwnDigitalIdCardService(client,storage.keys,storage.photos,cardRenderer,async svg=>sharp(svg,{density:300}).resize(1712,1080).png().toBuffer(),'REQUEST');
  const externalRequestCards=new OwnDigitalIdCardService(client,storage.keys,storage.photos,cardRenderer,async svg=>sharp(svg,{density:300}).resize(1712,1080).png().toBuffer(),'EMAIL');
  const routes = [new EmailWorkflowRoutes(sso,emailService,receptionPhotos,employeeRequestCards,externalRequestCards),staffEntry,new GuardRoutes(staffEntry,new GuardWorkspaceService(client),receptionReads,receptionPhotos,new GuardDutyService(client)),new AdminRoutes(staffEntry,new AdminWorkspaceService(client),new StaffAdministrationService(new SqlStaffAdministrationRepository(client)),new GuardDutyService(client)),reception,new DummySsoRoutes(sso,{localHttp:true}),
    new RegistrationHttpRoutes(registration,randomBytes(32),sso,{localHttp:true,allowedTypes:['DIGITAL_ID','EXTERNAL','EMPLOYEE_PROJECT'],office:req=>officeContext.read(req)}),
    new EmployeeDigitalIdRoutes(sso,new VisitReadService(new SqlVisitReadRepository(client,'api')),ownCards)];
  const api = createLoopbackHttpHandler(origin,{handles:path=>routes.some(route=>route.handles(path)),handle:(req,res)=>{
    const route=routes.find(route=>route.handles(req.url??''));if(!route)throw new Error('UNKNOWN_ROUTE');return route.handle(req,res);
  }});
  const server = createServer({ maxHeaderSize: 16384 }, (req, res) => {
    // Public login shell may be opened from an external link. API POSTs still
    // enforce exact Origin/Host and CSRF through the separate handler below.
    const publicPeer=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')&&req.headers.host===`localhost:${port}`;
    if(publicPeer&&pwaAssets(req,res))return;
    const pathname=(req.url??'').split('?')[0];
    if(req.method==='GET'&&pathname==='/assets/office-background.png'&&publicPeer){
      res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','public, max-age=86400');res.setHeader('X-Content-Type-Options','nosniff');res.end(officeImage);return;
    }
    const flag=/^\/assets\/flags\/([a-z]{2})\.svg$/u.exec(pathname);
    if(req.method==='GET'&&flag&&publicPeer&&countryFlags.has(flag[1])){res.setHeader('Content-Type','image/svg+xml');res.setHeader('Cache-Control','public, max-age=86400');res.setHeader('X-Content-Type-Options','nosniff');res.end(countryFlags.get(flag[1]));return;}
    if(req.method==='GET'&&['/','/guard','/guard/','/admin','/admin/','/reception','/reception/','/reception/print'].includes(pathname)&&publicPeer){
      if(['/guard','/guard/','/admin','/admin/','/reception','/reception/'].includes(pathname)&&!/(?:^|;\s*)gp-(?:staff|reception)-session=/.test(req.headers.cookie??'')){res.statusCode=303;res.setHeader('Location','/');res.setHeader('Cache-Control','no-store');res.end();return;}
      const nonce=randomBytes(24).toString('base64');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; worker-src 'self'; manifest-src 'self'; style-src 'nonce-${nonce}'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy',['/guard','/guard/'].includes(pathname)?'camera=(self), microphone=(), geolocation=()':'camera=(), microphone=(), geolocation=()');
      const page=pathname==='/'?staffHtml:['/guard','/guard/'].includes(pathname)?guardHtml:['/admin','/admin/'].includes(pathname)?adminHtml:pathname==='/reception/print'?printMarkup:receptionHtml;
      res.end((pathname==='/reception/print'?page:withPwa(page)).replaceAll('__NONCE__',nonce).replaceAll('__COMPANY_LOGO__',companyLogo));return;
    }
    if(req.method==='GET'&&/^\/(approval|request)\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/?$/iu.test(pathname)&&publicPeer){
      const nonce=randomBytes(24).toString('base64');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);res.end(emailHtml.replaceAll('__NONCE__',nonce).replaceAll('__COMPANY_LOGO__',companyLogo));return;
    }
    const entry=/^\/office\/(noida|bengaluru|chennai|pune)\/?$/u.exec(pathname);
    if (req.method === 'GET' && entry && publicPeer) {
      const officeCode=entry[1].toUpperCase();
      officeContext.issue(res,officeCode);
      const nonce = randomBytes(24).toString('base64'); res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; worker-src 'self'; manifest-src 'self'; style-src 'nonce-${nonce}'; img-src 'self' data: blob:; media-src blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
      res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy','no-referrer'); res.end(withPwa(html).replaceAll('__NONCE__', nonce).replaceAll('__COMPANY_LOGO__',companyLogo).replaceAll('__OFFICE_NAME__',officeNames[officeCode]).replaceAll('__OFFICE_CODE__',officeCode).replaceAll('__Host-gp-csrf','gp-dev-csrf'));
    } else void api(req, res);
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxConnections=16;server.maxRequestsPerSocket=100;
  const refresh = setInterval(() => { void repository.execute('refresh',null,null,null).then(result=>{if(result.ok!==true)console.error('DUMMY_DIRECTORY_REFRESH_FAILED');}).catch(()=>console.error('DUMMY_DIRECTORY_REFRESH_FAILED')); },60000);refresh.unref();
  const stop = () => { clearInterval(refresh);server.close(async () => { await sso.close(); process.exitCode=0; });server.closeIdleConnections(); };
  server.on('error', async () => { clearInterval(refresh);console.error('DUMMY_SSO_LISTENER_UNAVAILABLE');await sso.close();process.exitCode=1; });
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  server.listen(port,'127.0.0.1',()=>{
    console.log(`GatePass employee portal: ${origin} (local HTTP; temporary employee sign-in adapter)`);
  });
} catch { console.error('DUMMY_SSO_STARTUP_FAILED: requires development/test, GATEPASS_SSO_MODE=dummy, GATEPASS_DIRECTORY_MODE=mock, local SQL and PowerShell 7.');process.exitCode=1; }
