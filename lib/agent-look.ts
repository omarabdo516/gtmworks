// An Agent's look, as the approved orb draws it (design-reference-orb/agent-orb-v2.html: SHAPE_D, EYE_AT, PRESETS,
// TEMPERS; ADR 0027; GLOSSARY: Look, Temperament). The keys are the ones public.agent_looks keeps (#696); a look is
// never computed from a name or an id at drawing time. The values of each part are lib/agent-look-words' lists.
import type { lookChoices } from './agent-look-words.mjs';

export type LookShape=typeof lookChoices.shape[number];
type LookColour=typeof lookChoices.colour[number];
export type Temperament=typeof lookChoices.temperament[number];
export type AgentLook={shape:LookShape,colour:LookColour,temperament:Temperament};

// The three outlines, in a 100 by 100 box: the rim draws them, and the squircle and the blob mask the body with them
// (app/face.css).
export const shapePaths:Record<LookShape,string>={
 circle: "M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z",
 squircle: "M99.50 50.00C99.50 56.81 99.44 65.84 99.32 70.42C99.19 75.01 99.01 75.47 98.76 77.50C98.51 79.53 98.20 81.08 97.83 82.60C97.45 84.12 97.01 85.41 96.50 86.62C95.99 87.84 95.41 88.90 94.76 89.89C94.11 90.88 93.39 91.76 92.58 92.58C91.76 93.39 90.88 94.11 89.89 94.76C88.90 95.41 87.84 95.99 86.62 96.50C85.41 97.01 84.12 97.45 82.60 97.83C81.08 98.20 79.53 98.51 77.50 98.76C75.47 99.01 75.01 99.19 70.42 99.32C65.84 99.44 56.81 99.50 50.00 99.50C43.19 99.50 34.16 99.44 29.58 99.32C24.99 99.19 24.53 99.01 22.50 98.76C20.47 98.51 18.92 98.20 17.40 97.83C15.88 97.45 14.59 97.01 13.38 96.50C12.16 95.99 11.10 95.41 10.11 94.76C9.12 94.11 8.24 93.39 7.42 92.58C6.61 91.76 5.89 90.88 5.24 89.89C4.59 88.90 4.01 87.84 3.50 86.62C2.99 85.41 2.55 84.12 2.17 82.60C1.80 81.08 1.49 79.53 1.24 77.50C0.99 75.47 0.81 75.01 0.68 70.42C0.56 65.84 0.50 56.81 0.50 50.00C0.50 43.19 0.56 34.16 0.68 29.58C0.81 24.99 0.99 24.53 1.24 22.50C1.49 20.47 1.80 18.92 2.17 17.40C2.55 15.88 2.99 14.59 3.50 13.38C4.01 12.16 4.59 11.10 5.24 10.11C5.89 9.12 6.61 8.24 7.42 7.42C8.24 6.61 9.12 5.89 10.11 5.24C11.10 4.59 12.16 4.01 13.38 3.50C14.59 2.99 15.88 2.55 17.40 2.17C18.92 1.80 20.47 1.49 22.50 1.24C24.53 0.99 24.99 0.81 29.58 0.68C34.16 0.56 43.19 0.50 50.00 0.50C56.81 0.50 65.84 0.56 70.42 0.68C75.01 0.81 75.47 0.99 77.50 1.24C79.53 1.49 81.08 1.80 82.60 2.17C84.12 2.55 85.41 2.99 86.62 3.50C87.84 4.01 88.90 4.59 89.89 5.24C90.88 5.89 91.76 6.61 92.58 7.42C93.39 8.24 94.11 9.12 94.76 10.11C95.41 11.10 95.99 12.16 96.50 13.38C97.01 14.59 97.45 15.88 97.83 17.40C98.20 18.92 98.51 20.47 98.76 22.50C99.01 24.53 99.19 24.99 99.32 29.58C99.44 34.16 99.50 43.19 99.50 50.00Z",
 blob: "M98.45 51.95C98.81 53.70 99.01 55.53 99.00 57.32C98.99 59.11 98.78 60.94 98.40 62.69C98.01 64.43 97.41 66.17 96.68 67.81C95.95 69.44 95.02 71.02 94.02 72.49C93.02 73.97 91.86 75.36 90.67 76.66C89.48 77.95 88.18 79.15 86.87 80.28C85.57 81.41 84.20 82.45 82.84 83.43C81.47 84.41 80.08 85.31 78.68 86.16C77.28 87.01 75.88 87.80 74.46 88.53C73.04 89.26 71.61 89.94 70.16 90.55C68.71 91.15 67.25 91.70 65.78 92.16C64.31 92.62 62.81 93.02 61.32 93.33C59.83 93.64 58.32 93.86 56.82 94.02C55.32 94.17 53.81 94.24 52.32 94.26C50.83 94.28 49.35 94.22 47.88 94.13C46.40 94.05 44.94 93.90 43.48 93.75C42.02 93.60 40.57 93.42 39.10 93.23C37.63 93.05 36.16 92.85 34.66 92.64C33.15 92.42 31.63 92.21 30.07 91.93C28.52 91.66 26.93 91.38 25.33 90.99C23.74 90.61 22.10 90.19 20.50 89.63C18.90 89.08 17.27 88.44 15.73 87.65C14.19 86.86 12.66 85.95 11.28 84.90C9.89 83.85 8.57 82.65 7.42 81.34C6.27 80.04 5.24 78.58 4.39 77.06C3.54 75.54 2.86 73.89 2.33 72.23C1.81 70.57 1.47 68.82 1.25 67.10C1.02 65.38 0.98 63.62 1.00 61.91C1.02 60.20 1.19 58.50 1.37 56.84C1.56 55.18 1.84 53.55 2.11 51.95C2.39 50.35 2.71 48.79 3.03 47.24C3.35 45.68 3.67 44.16 4.02 42.63C4.36 41.10 4.70 39.57 5.10 38.05C5.49 36.52 5.89 34.99 6.38 33.48C6.88 31.96 7.40 30.43 8.04 28.95C8.68 27.47 9.39 25.99 10.21 24.59C11.04 23.18 11.96 21.81 12.98 20.53C14.00 19.25 15.14 18.04 16.34 16.93C17.54 15.81 18.85 14.79 20.20 13.86C21.55 12.93 22.99 12.10 24.44 11.36C25.89 10.61 27.40 9.96 28.92 9.38C30.44 8.79 31.99 8.30 33.55 7.86C35.11 7.41 36.68 7.04 38.27 6.74C39.85 6.43 41.45 6.18 43.05 6.01C44.65 5.85 46.27 5.74 47.88 5.74C49.49 5.74 51.11 5.82 52.70 6.01C54.30 6.21 55.90 6.51 57.45 6.93C58.99 7.35 60.52 7.89 61.98 8.54C63.44 9.19 64.85 9.97 66.19 10.82C67.52 11.67 68.79 12.64 69.99 13.65C71.19 14.65 72.30 15.75 73.38 16.85C74.45 17.95 75.45 19.10 76.44 20.23C77.43 21.36 78.36 22.51 79.32 23.64C80.27 24.77 81.21 25.89 82.19 27.02C83.16 28.15 84.16 29.26 85.17 30.41C86.19 31.57 87.25 32.72 88.30 33.95C89.35 35.18 90.44 36.44 91.45 37.79C92.47 39.14 93.50 40.56 94.40 42.06C95.30 43.56 96.16 45.15 96.84 46.80C97.51 48.45 98.09 50.20 98.45 51.95Z",
};
// Where the eyes sit on each shape: x in %, a nudge down in %.
const eyeAt:Record<LookShape,{x:number,dy:number}>={circle:{x:50,dy:0},squircle:{x:50,dy:0},blob:{x:48,dy:1.5}};

// Eight fixed colours, light to deep; none is orange, which means "waiting on you".
const lookColours:Record<LookColour,readonly [string,string,string,string]>={
 indigo:['#8670F0','#5A58DE','#2C44B4','#18236E'],
 violet:['#B062DE','#8443D0','#4E2B9C','#2A165C'],
 sky:['#2F8FE0','#2A6AD8','#2A3FA8','#162464'],
 teal:['#18918A','#117A80','#0D5470','#073446'],
 jade:['#2A9457','#1B8253','#0E5E57','#073A36'],
 rose:['#DC4F92','#C23C86','#88287A','#4C1550'],
 dusk:['#5D6CEE','#8F52DC','#C24C96','#561C58'],
 slate:['#6E7C94','#4D586B','#2E3548','#191E2B'],
};

// A temperament is a handful of numbers (agent-orb-v2.html TEMPERS). eye: width, height and half the gap between the
// eyes as parts of the size, the eyes' centre from the top in %, corner radius, tilt (deg), and a resting lid (dreamy) or
// an outer droop (caring) in %, and a resting look up (dreamy). breath: its period (s), swell, lift, sway (deg);
// energetic bounces instead (app/face.css). innerColour: how strongly the inner colour shows (the build holds it still,
// #697). glance: seconds between looks, how it looks, how fast the eyes move (ms). presence: how strongly its glow and
// inner light show.
type Glance='steady'|'dart'|'soft'|'up'|'precise'|'nod';
export type TemperamentNumbers={
 eye:{width:number,height:number,gap:number,top:number,radius:string,tilt:number,lid?:number,lookUp?:number,droop?:number},
 breath:{seconds:number,swell:number,lift:number,sway:number},
 innerColour:number,
 glance:{seconds:number,style:Glance,eyeMs:number},
 presence:number,
};
export const temperaments:Record<Temperament,TemperamentNumbers>={
 calm:{eye:{width:.1,height:.225,gap:.19,top:42,radius:'999px',tilt:0},breath:{seconds:6,swell:.018,lift:.012,sway:0},innerColour:.5,glance:{seconds:9,style:'steady',eyeMs:620},presence:1.22},
 energetic:{eye:{width:.086,height:.21,gap:.165,top:39,radius:'999px',tilt:-4},breath:{seconds:2.4,swell:.022,lift:.045,sway:0},innerColour:.6,glance:{seconds:2.8,style:'dart',eyeMs:110},presence:1},
 warm:{eye:{width:.14,height:.15,gap:.2,top:45,radius:'999px',tilt:0},breath:{seconds:4.4,swell:.024,lift:.016,sway:3.5},innerColour:.55,glance:{seconds:5,style:'soft',eyeMs:380},presence:1},
 dreamy:{eye:{width:.112,height:.19,gap:.19,top:43,radius:'999px',tilt:0,lid:20,lookUp:-.28},breath:{seconds:5.2,swell:.02,lift:.022,sway:1.5},innerColour:.95,glance:{seconds:6,style:'up',eyeMs:950},presence:1},
 neat:{eye:{width:.118,height:.14,gap:.18,top:42,radius:'28%',tilt:0},breath:{seconds:3.6,swell:.01,lift:.006,sway:0},innerColour:.45,glance:{seconds:4,style:'precise',eyeMs:140},presence:1},
 caring:{eye:{width:.122,height:.155,gap:.172,top:46,radius:'999px',tilt:6,droop:10},breath:{seconds:5.4,swell:.02,lift:.012,sway:0},innerColour:.5,glance:{seconds:7,style:'nod',eyeMs:620},presence:1},
};

// A face whose Agent has no look in hand yet (a record read before its look, a page with no looks) is drawn plain:
// slate and calm, never a colour guessed from its name.
export const plainLook:AgentLook={shape:'circle',colour:'slate',temperament:'calm'};

// The custom properties that draw a look (agent-orb-v2.html applyFace), set on the face itself.
export function lookStyle(look:AgentLook):Record<string,string|number> {
 const [c1,c2,c3,c4]=lookColours[look.colour], t=temperaments[look.temperament], at=eyeAt[look.shape], eye=t.eye;
 const lid=eye.lid||0, droop=eye.droop||0;
 const top=(outer:boolean)=>lid?lid:droop?(outer?droop:0):-40;
 return {
  '--c1':c1,'--c2':c2,'--c3':c3,'--c4':c4,
  '--eW':eye.width,'--eH':eye.height,'--eG':eye.gap,'--eR':eye.radius,'--eT':`${eye.tilt}deg`,'--eX':`${at.x}%`,'--eYp':`${eye.top+at.dy}%`,
  '--br':`${t.breath.seconds}s`,'--ba':t.breath.swell,'--bb':t.breath.lift,'--sw':t.breath.sway,'--flk':t.innerColour,'--gd':`${t.glance.eyeMs}ms`,'--pres':t.presence,'--sy0':eye.lookUp||0,
  '--clL0':`polygon(-40% ${top(true)}%, 140% ${top(false)}%, 140% 140%, -40% 140%)`,
  '--clR0':`polygon(-40% ${top(false)}%, 140% ${top(true)}%, 140% 140%, -40% 140%)`,
 };
}
