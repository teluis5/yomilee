// Past-only overnight observations. Incomplete tracking can still bias these samples.
const mins = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; };
const fn = s => { const n = String(s || '').match(/^NH0*(\d+)$/i); return n ? `NH${n[1]}` : null; };
const nextDate = s => new Date(`${s}T00:00:00Z`).valueOf() + 86400000;

export function overnightPairs(flights) {
  const days = new Map();
  for (const f of Object.values(flights || {})) {
    if (!f.reg || !f.date || !f.orig || !f.dest || !fn(f.flightNo) || mins(f.depTime) === null) continue;
    const key = `${f.reg}:${f.date}`;
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(f);
  }
  const pairs = [];
  for (const [key, list] of days) {
    const [reg, date] = key.split(':');
    const following = new Date(nextDate(date)).toISOString().slice(0, 10);
    const tomorrow = days.get(`${reg}:${following}`);
    if (!tomorrow) continue;
    const last = [...list].sort((a,b) => mins(a.depTime)-mins(b.depTime)).at(-1);
    const first = [...tomorrow].sort((a,b) => mins(a.depTime)-mins(b.depTime))[0];
    const arrival = mins(last.arrTime);
    // Require plausible evening arrival and morning departure, consecutive dates and same airport.
    if (arrival === null || arrival < 1020 || mins(first.depTime) > 660 || last.dest !== first.orig) continue;
    pairs.push({ date: following, reg, airport: last.dest, arrivalFlight: fn(last.flightNo),
      arrivalMin: arrival, firstFlight: fn(first.flightNo), firstDepMin: mins(first.depTime),
      weekday: new Date(`${following}T00:00:00Z`).getUTCDay() });
  }
  return pairs.sort((a,b) => a.date.localeCompare(b.date));
}

// Shrink sparse, aircraft-specific signals heavily toward the fleet baseline.
export function overnightWeights(pairs, context, candidates) {
  const pool = pairs.filter(p => p.airport === context.airport && p.date < context.date);
  const scores = new Map(candidates.map(c => [fn(c.flightNo), 1]));
  if (pool.length < 12) return scores;
  const groups = [
    [pool.filter(p => p.arrivalFlight === fn(context.arrivalFlight)), 0.45, 4],
    [pool.filter(p => Math.abs(p.arrivalMin - context.arrivalMin) <= 60), 0.15, 8],
    [pool.filter(p => p.weekday === new Date(`${context.date}T00:00:00Z`).getUTCDay()), 0.10, 5],
    [pool.filter(p => p.reg === (context.reg || 'JA609A')), 0.20, 4]
  ];
  for (const [group, strength, minimum] of groups) {
    if (group.length < minimum) continue;
    for (const [flight, value] of scores) {
      const base = pool.filter(p => p.firstFlight === flight).length / pool.length;
      const observed = group.filter(p => p.firstFlight === flight).length / group.length;
      scores.set(flight, value * Math.max(0.8, Math.min(1.2, 1 + strength * (observed - base))));
    }
  }
  return scores;
}

// Evaluation candidates are observed same-airport departures: useful for signal screening,
// but not a replay of historical schedules or saved site predictions.
export function walkForward(pairs) {
  const result = { samples: 0, baselineHits: 0, modelHits: 0, chiikawaSamples: 0, chiikawaBaselineHits: 0, chiikawaModelHits: 0 };
  for (const p of pairs) {
    const train = pairs.filter(x => x.date < p.date && x.airport === p.airport);
    const candidates = [...new Set(pairs.filter(x => x.date === p.date && x.airport === p.airport).map(x => x.firstFlight))];
    if (train.length < 12 || candidates.length < 2) continue;
    const baseline = f => train.filter(x => x.firstFlight === f).length + 1;
    const weights = overnightWeights(train, p, candidates.map(flightNo => ({ flightNo })));
    const rank = useModel => [...candidates].sort((a,b) => baseline(b) * (useModel ? weights.get(b) : 1) - baseline(a) * (useModel ? weights.get(a) : 1) || a.localeCompare(b))[0];
    const b = rank(false) === p.firstFlight, m = rank(true) === p.firstFlight;
    result.samples++; result.baselineHits += +b; result.modelHits += +m;
    if (p.reg === 'JA609A') { result.chiikawaSamples++; result.chiikawaBaselineHits += +b; result.chiikawaModelHits += +m; }
  }
  return result;
}
