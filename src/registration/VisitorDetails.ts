export const DEVICE_TYPES = ['LAPTOP','TABLET','PEN_DRIVE','CAMERA','OTHER'] as const;
/** Shared input/output contract; no document IDs or device identifiers are collected. */
export function visitorDetails(company:unknown,devices:unknown){
 if(company!==undefined&&company!==null&&(typeof company!=='string'||!company.isWellFormed()||company.length>200||/[\u0000-\u001f\u007f-\u009f]/u.test(company)))throw Error('INVALID_VISITOR_DETAILS');
 if(devices!==undefined&&(!Array.isArray(devices)||devices.length>DEVICE_TYPES.length||devices.some(d=>!DEVICE_TYPES.includes(d))||new Set(devices).size!==devices.length))throw Error('INVALID_VISITOR_DETAILS');
 const name=typeof company==='string'?company.trim():'';
 return {...(name?{companyName:name}:{}),...(devices!==undefined?{deviceTypes:[...(devices as string[])].sort()}:{} )};
}
