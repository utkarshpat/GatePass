import {join} from 'node:path';
import {homedir} from 'node:os';
import {PrivateDirectory} from '../storage/PrivateDirectory.ts';
import {FileQrKeySource} from '../storage/FileQrKeySource.ts';
import {WindowsCurrentUserKeyProtector} from '../storage/PlatformProtection.ts';
/** Single-Windows-service-account adapter. Multi-host deployment supplies its own protected shared provider. */
export async function createOutlookActionKeys(){
 const directory=await PrivateDirectory.create(join(homedir(),'.gatepass','outlook-action-keys'),[process.cwd()]);
 const source=new FileQrKeySource(directory,new WindowsCurrentUserKeyProtector());await source.initialize();return source;
}
