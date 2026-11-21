import { cronOf, formOf } from './routine-schedule.mjs';

// Good morning's times (#182), apart from the module that reaches the Engine so the Agent's page can draw them.
// The reference's times (design-reference/app.js CK_TIMES): every half hour from 7:00 to 11:00; 9:00 is drawn first.
export const morningTimes=['7:00','7:30','8:00','8:30','9:00','9:30','10:00','10:30','11:00'];
export const morningDefault='9:00';
// The level from which an Agent may do scheduled work (lib/agent-levels.mjs, ADR 0014).
export const morningLevel=3;
// What marks the daily message among a profile's Routines: a line only gtmworks writes at the head of the job's prompt, so
// a Routine renamed in a chat stays the daily message and one merely named "Good morning" never becomes it.
export const morningMarker='[gtmworks: good morning]';
const clock=/^([01]?\d|2[0-3]):([0-5]\d)$/;

// "9:00" for a job that runs every day at a time, null for any other schedule.
/** @param {{schedule:{expr:string|null}}} routine */
export function morningTime(routine) {
 const form=formOf(routine.schedule.expr);
 return form?.kind==='daily'?`${form.h}:${String(form.m).padStart(2,'0')}`:null;
}
// The cron expression for "9:00", or null for a time that is not one.
/** @param {unknown} time */
export function morningCron(time) {
 const match=typeof time==='string'?clock.exec(time):null;
 return match?cronOf({kind:'daily',h:Number(match[1]),m:Number(match[2])}):null;
}

// The cities whose names the catalogues hold (`zoneCity<City>`), for the "Cairo time" line under the time; any other zone
// shows its IANA city as it is.
export const zoneCities=['Cairo','Riyadh','Dubai','Kuwait','Qatar','Bahrain','Amman','Beirut','Baghdad','Muscat','Casablanca','Tunis','Algiers','Tripoli','Khartoum','Jerusalem','Damascus','Aden','London','Paris','Berlin','Istanbul'];
