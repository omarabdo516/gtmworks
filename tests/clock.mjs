// Fixed instants and ids for tests (#266), so none depends on the runner's clock, its zone or a generated id.
export const runnerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// How far the zone's wall clock is ahead of UTC at an instant, in milliseconds.
const offsetAt = (instant, timeZone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(instant).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(instant / 1000) * 1000;
};

// The instant `seconds` before the local day `day` (YYYY-MM-DD) ends in `timeZone`. The next day's midnight is found
// with the offset at a first guess and checked again with the offset there, so a day with a clock change still ends right.
export function beforeMidnight(day, timeZone = runnerZone, seconds = 30) {
  const [year, month, date] = day.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, date + 1);
  const guess = wall - offsetAt(wall, timeZone);
  return new Date(wall - offsetAt(guess, timeZone) - seconds * 1000);
}

// The n-th fixed id, shaped as a version 4 UUID.
export const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
