import {join} from 'node:path';
import {PrivateDirectory} from '../storage/PrivateDirectory.ts';
import {FileQrKeySource} from '../storage/FileQrKeySource.ts';
import {WindowsCurrentUserKeyProtector} from '../storage/PlatformProtection.ts';
import {EmailLinkCodec} from './EmailLinkCodec.ts';
/** Dedicated signing keys; QR encryption keys are never reused for email links. */
export async function localEmailLinks(privateRoot:string){const directory=await PrivateDirectory.create(join(privateRoot,'email-link-keys'),[]);const source=new FileQrKeySource(directory,new WindowsCurrentUserKeyProtector());await source.initialize();return new EmailLinkCodec(source);}
