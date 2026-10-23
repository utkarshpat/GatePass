import {mkdir,writeFile} from 'node:fs/promises';
import {NameReadings,googleInputTools,nameLocales} from '../src/visits/NameReadings.ts';
// Synthetic examples only. Outputs are candidates, not a native-reader accuracy score.
const names=['Rohan Mehta','Kunal Verma','Meera Singh','Asha Iyer','Nikhil Shah','Nisha Kapoor','Pooja Shah','Aditya Rao','Ishita Verma','Utkarsh Patel','Rahul Sharma','Priya Nair','Arjun Menon','Ananya Joshi','Vikram Desai','Neha Kulkarni','Amit Kumar','Sneha Reddy','Deepak Gupta','Kavya Krishnan','Akash Jain','Divya Rao','Manoj Shetty','Pallavi Patil','Suresh Bhat','Lakshmi Narayanan','Prakash Hegde','Shreya Bose','Anil George','Farah Khan','Mohammed Ali','Yusuf Shaikh','Saima Ansari','Varun Sethi','Sanjana Kulkarni','Harish Gowda','Ravi Prasad','Preeti Mishra','Shivani Pandey','Gaurav Agrawal','Aditi Chatterjee','Abhishek Banerjee','Ajay Fernandes',"John D'Souza",'Mary Thomas','Anne-Marie Smith','K R Srinivas','R K Sharma','Sai Teja','Omar Hassan'];
let providerCalls=0;const provider=googleInputTools();const service=new NameReadings(async(name,locale)=>{providerCalls++;return provider(name,locale);});
const results=[];
for(const locale of nameLocales){
 const start=performance.now(),items=[];
 for(let offset=0;offset<names.length;offset+=10)items.push(...(await service.read({locale,names:names.slice(offset,offset+10)})).items);
 const coldMs=Math.round(performance.now()-start),before=providerCalls,warm=performance.now();
 for(let offset=0;offset<names.length;offset+=10)await service.read({locale,names:names.slice(offset,offset+10)});
 results.push({locale,coldMs,warmMs:Math.round((performance.now()-warm)*100)/100,candidates:items.filter(v=>v.reading).length,cacheProviderCalls:providerCalls-before,items});
 console.log(JSON.stringify({locale,coldMs,candidates:items.filter(v=>v.reading).length,cacheProviderCalls:providerCalls-before}));
}
await mkdir('output/name-readings',{recursive:true});
await writeFile('output/name-readings/synthetic-benchmark.json',JSON.stringify({provider:'Google Input Tools public endpoint (experimental)',accuracy:'Not assessed by native speakers; presence of a candidate is not proof of pronunciation accuracy',providerCalls,names:names.length,results},null,2));
