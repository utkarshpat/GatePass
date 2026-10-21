import { openLocalPrivateStorage } from '../src/storage/LocalPrivateStorage.ts';
try{
  const storage=await openLocalPrivateStorage();
  console.log(JSON.stringify({status:'READY',root:storage.root,photoUsage:await storage.photos.usage(),activeKeyId:storage.active.id,keyProtection:storage.active.scheme,privateKeyMaterialIncluded:false}));
}catch{console.error('PRIVATE_STORAGE_INITIALIZATION_FAILED: root permissions, DPAPI or manifest must be valid. Existing keys are never silently replaced.');process.exitCode=1;}
