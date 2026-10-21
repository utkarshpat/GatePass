import { homedir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrivateDirectory } from './PrivateDirectory.ts';
import { FilePhotoStore } from './FilePhotoStore.ts';
import { FileQrKeySource } from './FileQrKeySource.ts';
import { WindowsCurrentUserKeyProtector } from './PlatformProtection.ts';
/** Local Windows bootstrap. Linux will use its own protected-key provider, never fake DPAPI. */
export async function openLocalPrivateStorage(testRoot?:string){
  if(testRoot&&process.env.NODE_ENV!=='test')throw new Error('TEST_STORAGE_ROOT_FORBIDDEN');
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw new Error('LOCAL_WINDOWS_STORAGE_REQUIRED');
  const workspace=resolve(fileURLToPath(new URL('../../',import.meta.url)));
  const forbidden=[workspace,...[process.env.OneDrive,process.env.OneDriveCommercial,process.env.OneDriveConsumer].filter((v):v is string=>!!v),join(homedir(),'OneDrive')];
  // Avoid MSIX LocalAppData virtualization: the user-profile location is stable
  // for both Codex-launched and ordinary terminal processes.
  const container=await PrivateDirectory.create(testRoot??join(homedir(),'.gatepass','private-v1'),forbidden);
  const root=container.root;
  const photosDirectory=await PrivateDirectory.create(join(root,'photos'),forbidden);
  const keyDirectory=await PrivateDirectory.create(join(root,'qr-keys'),forbidden);
  const photos=new FilePhotoStore(photosDirectory);const keys=new FileQrKeySource(keyDirectory,new WindowsCurrentUserKeyProtector());
  const active=await keys.initialize();return {root,photos,keys,active};
}
