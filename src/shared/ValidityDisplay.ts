/** Calendar-day ends are exclusive in storage; show the last included minute. */
export function displayedValidityEnd(value:string):Date {
 const instant=Date.parse(value),day=86400000,local=instant+330*60000;
 return new Date(Number.isFinite(instant)&&((local%day)+day)%day===0?instant-60000:instant);
}
export function passValidityLabel(value:string):string {
 return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(displayedValidityEnd(value))+' IST';
}
