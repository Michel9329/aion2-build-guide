// How far to take each passive skill, from two numbers stored in the class data:
//   gear: on how many of the top Korean players' pieces the skill's +1 trait appears (out of 100), per mode
//   top:  the average level the top Global players keep it at
// Rule: from 50% of pieces up it is worth hunting for, from 10% keep it if it comes up, below that do not seek it.
// A class without those numbers has no list: passiveTiers returns null and the build stops.
const SEEK = 50;
const MAYBE = 10;

// seek: look for it on gear; maybe: keep it if it comes up; stop: do not seek it
export const seekTier = (share) => (share >= SEEK ? 'seek' : share >= MAYBE ? 'maybe' : 'stop');

const TIER_ORDER = { seek: 0, maybe: 1, stop: 2 };
export function passiveTiers(hub, mode = 'pve') {
  const list = (hub && hub.passive) || [];
  if (!list.length || list.some((e) => !(e.top > 0) || !e.gear || !(e.gear[mode] >= 0))) return null;
  return list.map((e) => ({ id: e.id, name: e.name, tier: seekTier(e.gear[mode]), top: e.top, ref: Math.round(e.top), share: e.gear[mode] }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (a.tier === 'stop' ? b.top - a.top : b.share - a.share || b.top - a.top) || a.name.localeCompare(b.name));
}

// What to do about it, in a few words (the text is Italian, like the guide).
export const tierSays = (row) => ({ seek: 'Da portare in alto: cercala su equip e carte', maybe: 'Punti e nodi; sull’equip tienila se capita', stop: `Può fermarsi a ${row.ref}` }[row.tier]);
