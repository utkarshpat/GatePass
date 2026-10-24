/** Build the bounded range-response contract from a synthetic per-day fixture. */
export function summaryRange(body:any,daily:any){
 const days=[];for(let day=body.from;day<=body.to;day=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10))days.push({localVisitDate:day,visits:{...daily.visits}});
 return{from:body.from,to:body.to,days,visits:Object.fromEntries(Object.entries(daily.visits).map(([k,v])=>[k,String(BigInt(String(v))*BigInt(days.length))])),recordedPresence:daily.recordedPresence,checkedAtUtc:daily.checkedAtUtc??'2026-10-24T00:00:00Z'};
}
