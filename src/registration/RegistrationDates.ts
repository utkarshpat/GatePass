import { RegistrationError } from './RegistrationService.ts';
import type { ProductRequestType } from './RegistrationService.ts';

function day(value: unknown): number {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value)||value.startsWith('0000'))throw new RegistrationError('INVALID_INPUT');
  const result=Date.parse(value+'T00:00:00.000Z');
  if(!Number.isFinite(result)||new Date(result).toISOString().slice(0,10)!==value)throw new RegistrationError('INVALID_INPUT');
  return result;
}
/** India office calendar bounds, independent of browser/host timezone. */
export function registrationDates(type:ProductRequestType,visitDate:unknown,currentDate:string,maxVisitDate:string) {
  const today=day(currentDate),maximum=day(maxVisitDate);
  if(type!=='EXTERNAL'&&visitDate!==undefined)throw new RegistrationError('INVALID_INPUT');
  if(type==='DIGITAL_ID')return {};
  const selected=type==='EXTERNAL'?day(visitDate):today;
  if(selected<today||selected>maximum)throw new RegistrationError('INVALID_INPUT');
  return {validFromUtc:new Date(selected-330*60000).toISOString(),validUntilUtc:new Date(selected+86400000-330*60000).toISOString()};
}
