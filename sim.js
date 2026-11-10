/* ================= damage simulator: attack skills + awakening stones =================
   Inserted into template.html by build.py (after CATS is defined, before ORDER).
   Everything is relative: damage is in "% of ATK/MATK" unless the player calibrates with
   one real damage number, because the game's ATK -> damage formula runs on the server. */
const STONES = DATA.stones.list || [];
const stoneById = new Map(STONES.map(s => [s.id, s]));
const TIERS = ['common', 'rare', 'epic', 'legendary'];
const UNLOCK = (DATA.stones.unlock || [{skillLevel:5}, {skillLevel:10}, {skillLevel:10}]).map(u => u.skillLevel);
const PER_LV = DATA.stones.level?.perLevelMainPercent ?? 4, STONE_MAXLV = DATA.stones.level?.maxLevel ?? 5;
const stoneName = st => st.name || st.thai || st.id;
const isWhole = st => (st.conditions || []).some(c => c.startsWith('ใส่ได้สกิลละ 1 ก้อน'));
const rng = (re, t, d) => { const m = (t || '').match(re); return m ? (m[2] ? (+m[1] + +m[2]) / 2 : +m[1]) : d; };
const SIM_TAGS = ['attack','physical','spell','melee','projectile','area','multihit','casttime','elemental','endow','fire','water','wind','earth','holy','poison','dark','trap','movement','stealth','longcd'];
const TAG_TH = {attack:'โจมตี', physical:'กายภาพ', spell:'เวท', melee:'ประชิด', projectile:'ยิง/กระสุน', area:'วง/พื้นที่', multihit:'ตีหลายครั้ง', casttime:'มีเวลาร่าย', elemental:'มีธาตุ', endow:'เคลือบธาตุ', fire:'ไฟ', water:'น้ำ', wind:'ลม', earth:'ดิน', holy:'ศักดิ์สิทธิ์', poison:'พิษ', dark:'มืด', trap:'กับดัก', movement:'เคลื่อนที่', stealth:'ซ่อนตัว', longcd:'คูลยาว'};

function skillInfo(s){
  const row = re => (s.rows || []).find(r => re.test(r.label));
  const per = row(/^ดาเมจต่อครั้ง/); if (!per) return null;
  const hits = row(/^จำนวนครั้ง$/), cd = row(/^คูลดาวน์/);
  const facts = (s.facts || []).join(' | '), all = facts + ' ' + (s.description || '');
  const val = (r, i) => r ? (parseFloat(String(r.values[Math.min(i, r.values.length - 1)]).replace(/[^\d.]/g, '')) || 0) : null;
  const elTh = (facts.match(/ดาเมจ(?:กายภาพ|เวท) ธาตุ(\S+)/) || [])[1];
  const el = Object.keys(EL).find(k => EL[k] === elTh) || 'neutral';
  const physical = /ดาเมจกายภาพ/.test(facts), spell = /ดาเมจเวท/.test(facts);
  const rm = facts.match(/ระยะ (\d+) ช่อง/), range = rm ? +rm[1] : (/ระยะโจมตีของอาวุธ/.test(facts) ? 1 : 0);
  const rangedFlag = /นับเป็นระยะไกล/.test(facts);
  const area = /วงรัศมี|รูปกรวย|จุดบนพื้น|ตัวเอง \/ รอบตัว|แนวยาว|แนวตรง/.test(all);
  const cm = facts.match(/ร่าย ([\d.]+) วิ(?: \+ ร่ายตายตัว ([\d.]+) วิ)?/);
  const cast = cm ? +cm[1] + (+cm[2] || 0) : 0;
  const maxHits = hits ? Math.max(...hits.values.map(x => parseFloat(x) || 1)) : 1;
  const tags = new Set(['attack']);
  if (physical) tags.add('physical');
  if (spell) tags.add('spell');
  if (area) tags.add('area');
  if (physical && !rangedFlag && range <= 3) tags.add('melee');
  if (!area && (rangedFlag || range >= 4)) tags.add('projectile');
  if (maxHits > 1) tags.add('multihit');
  if (cast > 0) tags.add('casttime');
  if (el !== 'neutral') { tags.add('elemental'); tags.add(el === 'shadow' ? 'dark' : el); }
  if (/เคลือบอาวุธ/.test(facts)) tags.add('endow');
  if (/กับดัก/.test(s.description || '')) tags.add('trap');
  if (/ซ่อนตัว/.test(all)) tags.add('stealth');
  if (cd && Math.max(...cd.values.map(x => parseFloat(x) || 0)) >= 15) tags.add('longcd');
  return {s, per, area, el, cast, guess:tags, mag:/MATK/.test(per.label), levels:per.values.length,
    at: lv => ({pct:val(per, lv - 1), n:hits ? val(hits, lv - 1) : 1, cd:cd ? val(cd, lv - 1) : 0})};
}
const SIM_SKILLS = SB.skills.map(skillInfo).filter(Boolean);
const simById = new Map(SIM_SKILLS.map(i => [i.s.id, i]));
const fitsStone = (st, tags) => { const r = st.requires || {}; return (r.all || []).every(t => tags.has(t)) && (!r.any || r.any.some(t => tags.has(t))) && !(r.not || []).some(t => tags.has(t)); };

// numbers of one stone at a tier / stone level / roll
function stoneNums(st, tier, lv, roll){
  const t = st.tiers.find(x => x.tier === tier) || st.tiers[st.tiers.length - 1];
  const [a, b] = t.main, base = roll === 'min' ? a : roll === 'max' ? b : (a + b) / 2;
  return {X: base * (1 + PER_LV * (lv - 1) / 100), raw: base, text: t.text};
}

/* Each modelled stone returns how it changes one cast. Units:
   plus  = bonus added to the whole-skill multiplier (1 = +100%)
   pre   = extra damage in "skill damage before stones" units, summed over all targets
   post  = extra damage in "skill damage after the whole-skill stone" units, summed over all targets */
const MODEL = {
  // whole-skill stones (one per skill)
  // confirmed in game: total = normal cast + 2 repeats at X% each (×4.96 with X≈198)
  multistrike: (X, T) => ({repeat:2, repeatX:X / 100, cdMul:1 + rng(/คูลดาวน์ \+(\d+)%/, T, 20) / 100, note:'ตีปกติ 1 รอบ + ตีซ้ำอีก 2 รอบ รอบละ X% (ยืนยันกับในเกมแล้ว)'}),
  ruthless: X => ({ruthless:X / 100, note:'ทุกครั้งที่ 3 ×X อื่น ๆ −5%'}),
  concentrate: X => ({plus:X / 100, note:'พื้นที่ −1 ช่อง (ไม่ได้คิดว่าโดนมอนน้อยลง)'}),
  aftershock: (X, T, e) => ({post:X / 100 * e.skillT}),
  static: (X, T, e) => { const k = rng(/(\d+)(?:-(\d+))? ตัว \(ระยะกระโดด/, T, 2); return {post:X / 100 * (e.N > 1 ? Math.min(k, e.N - 1) : 0.5)}; },
  'elemental-focus': X => ({plus:X / 100}),
  'arcane-flow': X => ({arcane:X / 100, note:'บัฟ 5 วิหลังร่าย — ครั้งแรกยังไม่ได้'}),
  'controlled-destruction': X => ({plus:X / 100, castMul:1.2}),
  brutality: X => ({sep:1 + X / 100, neutral:true, note:'ตีเป็นไร้ธาตุเสมอ (ตัวคูณธาตุ = 1)'}),
  executioner: (X, T, e) => { const third = rng(/ดาเมจ \+(\d+)(?:-(\d+))?% กับทุกเป้า/, T, X / 3), below = rng(/ต่ำกว่า (\d+)%/, T, 50);
    return {plus:(third + (X - third) * below / 100) / 100, note:`เฉลี่ยตามเลือดเป้า: ต่ำกว่า ${below}% ได้เต็ม`}; },
  bloodlust: (X, T, e) => ({plus:e.bleed ? X / 100 : 0, note:e.bleed ? 'เป้าเลือดไหลจากศิลาฝังบาดแผล' : 'ต้องใส่คู่ศิลาฝังบาดแผล ไม่งั้นไม่ทำงาน'}),
  volley: (X, T, e) => ({post:X / 100}),
  'far-shot': X => ({plus:X / 200, note:'คิดที่ระยะกลาง ได้ครึ่งหนึ่ง'}),
  'point-blank': (X, T, e) => ({plus:e.near ? X / 100 : -0.15}),
  epicenter: (X, T, e) => ({primary:X / 100}),
  overcharge: (X, T, e) => ({hitsAdd:1, plus:rng(/ดาเมจสกิลนี้ \+(\d+)%/, T, 0) / 100 * e.lvScale, cdMul:1 + X / 100 / e.lvScale}),
  combo: X => ({combo:X / 100, note:'ทุกครั้งที่ 5 ในการร่าย คริแน่นอน + ดาเมจคริ X%'}),
  flurry: X => ({plus:X / 100}),
  'focused-channel': X => ({plus:X / 100, castMul:1.2}),
  shatter: (X, T, e) => ({plus:e.frozen ? X / 100 : 0, note:e.frozen ? '' : 'ต้องให้เป้าแข็งก่อน'}),
  'trap-support': X => ({plus:X / 100, note:'ต้องวางล่วงหน้าเป็นกับดัก'}),
  archmage: X => ({plus:X / 100, note:'SP +80%'}),
  pinpoint: X => ({plus:X / 100}),
  jackpot: (X, T) => { const p = rng(/โอกาส (\d+)%/, T, 7) / 100; return {jackpot:1 + p * (X - 1), note:`ค่าเฉลี่ย: โอกาส ${p * 100}% คูณ ×X`}; },
  'fire-dragon': (X, T, e) => ({set:X / 100, post:0.6 * e.N, note:'หัวมังกร X% + ไฟลุก 15% × 4 วิ ทุกตัวในวง'}),
  berserk: (X, T, e) => ({plus:X / 100 * Math.min(1, Math.max(0, (90 - e.myHp) / 60))}),
  'charged-cast': X => ({plus:X / 100, castAdd:2.4, note:'ชาร์จ 3 ขั้น +2.4 วิ'}),
  'divine-dice': X => ({plus:X / 100, note:'ธาตุสุ่มทุกครั้ง (ไม่ได้คิดตัวคูณธาตุ)'}),
  'party-combo': (X, T, e) => ({post:e.party ? X / 100 * e.N : 0, note:e.party ? '' : 'ต้องตีพร้อมปาร์ตี้'}),
  'time-bomb': (X, T, e) => ({post:X / 100 * e.N, cdMul:1.1}),
  'gold-rush': X => ({plus:X / 100, note:'Zeny +400%'}),
  // extra hits, based on damage before stones
  chain: (X, T, e) => ({pre:X / 100 * Math.min(rng(/ทีละตัว (\d+) ตัว/, T, 2), e.N - 1)}),
  fork: (X, T, e) => ({pre:X / 100 * Math.min(2, e.N - 1)}),
  piercing: (X, T, e) => ({pre:X / 100 * (e.N - 1)}),
  cleave: (X, T, e) => ({pre:X / 100 * (e.N - 1)}),
  'spell-echo': (X, T, e) => ({pre:X / 100 * e.skillT, cdMul:1.3}),
  'spell-cascade': (X, T, e) => ({pre:X / 100 * e.N}),
  'meteor-core': (X, T, e) => ({pre:X / 100 * e.N}),
  returning: (X, T, e) => ({pre:X / 100 * e.N}),
  mirage: (X, T, e) => ({preTime:{dur:4, every:1, per:X / 100 * e.skillT}, note:'ร่างเงาใช้สกิลซ้ำทุก 1 วิ นาน 4 วิ'}),
  'spell-totem': (X, T, e) => ({preTime:{dur:8, every:1.2, per:X / 100 * e.skillT}, cdMul:1.3}),
  'blade-storm': (X, T, e) => ({preTime:{dur:4, every:0.5, per:X / 100 * e.N}}),
  'storm-follow': (X, T, e) => ({preTime:{dur:rng(/อีก (\d+)-(\d+) วิ/, T, 3), every:1, per:X / 100 * e.N}}),
  'meteor-shower': (X, T, e) => ({pre:X / 100 * Math.min(2 * e.N, rng(/(\d+)-(\d+) ลูก/, T, 6)), cdMul:1.2}),
  'scatter-rain': (X, T, e) => ({pre:X / 100 * rng(/(\d+)-(\d+) จุด/, T, 7) * Math.min(1, e.N / 2), note:'ถือว่าครึ่งหนึ่งของจุดตกโดนมอน (ถ้ามอน 1 ตัว)'}),
  'fan-shot': (X, T, e) => ({pre:X / 100 * Math.min(rng(/ลูกเพิ่ม (\d+)-(\d+) ลูก/, T, 3), e.N - 1)}),
  'nova-burst': (X, T, e) => ({pre:X / 100 * e.N, cdMul:1.15}),
  shockwave: (X, T, e) => ({pre:X / 100 * (e.N - 1)}),
  // status stones that turn into damage
  impale: X => ({dot:{pct:X / 100, sec:4}, bleed:true}),
  ignite: X => ({dot:{pct:X / 100, sec:3}}),
  trauma: X => ({trauma:X / 100, delayMul:1.15, note:'ซ้อน 1 ชั้นต่อครั้งที่ตีโดน สูงสุด 10 ชั้น (หายถ้าไม่ได้ตี 4 วิ)'}),
  hex: X => ({hex:X / 100, note:'เป้ารับดาเมจเพิ่ม 4 วิ'}),
  proliferation: () => ({directMul:0.85, note:'ดาเมจตรง −15% (ส่วนสถานะที่ลามไม่ได้คิด)'}),
};
const modelled = st => !!MODEL[st.id];

/* simulate casting the skill back-to-back for env.D seconds */
function simulate(info, lv, picks, env){
  const b = info.at(lv), pct = b.pct / 100;
  const lvScale = 1;
  const effs = [], warn = [];
  const bleed = picks.some(p => p.st.id === 'impale');
  const e0 = {...env, bleed, lvScale, skillT:info.area ? env.N : 1};
  for (const p of picks) {
    const {X, text} = stoneNums(p.st, p.tier, p.lv, env.roll);
    const f = MODEL[p.st.id];
    effs.push({p, X, eff:f ? f(X, text, {...e0, lvScale:1 + PER_LV * (p.lv - 1) / 100}) : null});
  }
  const agg = {plus:0, set:null, sep:1, cdMul:1, castMul:1, castAdd:0, delayMul:1, hitsAdd:0, directMul:1, jackpot:1, primary:0, neutral:false, trauma:0, combo:0, ruthless:0, arcane:0, hex:0, repeat:0, repeatX:0};
  for (const {eff} of effs) if (eff) {
    if (eff.repeat) { agg.repeat = eff.repeat; agg.repeatX = eff.repeatX; }
    for (const k of ['plus','hitsAdd','castAdd','primary','trauma','combo','ruthless','arcane','hex']) if (eff[k]) agg[k] += eff[k];
    for (const k of ['sep','cdMul','castMul','delayMul','directMul','jackpot']) if (eff[k]) agg[k] *= eff[k];
    if (eff.set != null) agg.set = eff.set;
    if (eff.neutral) agg.neutral = true;
  }
  const E = agg.neutral ? 1 : env.elMult, c = Math.min(1, Math.max(0, env.crit / 100)), cmul = env.critDmg / 100;
  const cf = 1 + c * (cmul - 1), base = pct * E * (1 + env.bonus / 100);
  const n = b.n + agg.hitsAdd, N = env.N, skillT = info.area ? N : 1;
  const cdT = b.cd * agg.cdMul, castT = info.cast * agg.castMul + agg.castAdd, minI = env.minI * agg.delayMul;
  const cycle = Math.max(cdT, castT + minI, 0.2);
  const B0 = base * b.n * cf;                       // one target, before stones
  const src = new Map(); const add = (k, v) => src.set(k, (src.get(k) || 0) + v);
  let t = 0, casts = 0, stacks = 0, lastHit = -99, dmgCount = 0;
  const hexOn = () => agg.hex && cycle <= 4 && casts > 1 ? 1 + agg.hex : 1;
  while (t < env.D - 1e-9) {
    casts++;
    if (t - lastHit > 4) stacks = 0;
    // every hit of the cast in order: the normal round, then any repeat rounds (Multistrike);
    // each hit can add a Trauma stack, count toward Combo's 5th hit and Ruthless' 3rd hit
    let hs = 0, k = 0;
    for (let round = 0; round <= agg.repeat; round++) {
      const w = round === 0 ? 1 : agg.repeatX;
      for (let j = 1; j <= n; j++) {
        k++;
        let m = (agg.combo && k % 5 === 0) ? cmul + agg.combo : cf;
        if (agg.trauma) { m *= 1 + stacks * agg.trauma; stacks = Math.min(10, stacks + 1); }
        if (agg.ruthless) { dmgCount++; m *= dmgCount % 3 === 0 ? agg.ruthless : 0.95; }
        hs += m * w;
      }
    }
    lastHit = t;
    const arc = agg.arcane && casts > 1 && cycle <= 5 ? agg.arcane : 0;
    const wMul = agg.set != null ? agg.set + agg.plus + arc : 1 + agg.plus + arc;
    const hx = hexOn();
    const direct = base * hs * Math.max(0, wMul) * agg.sep * agg.directMul * agg.jackpot * hx;
    add('skill', direct * skillT + direct * agg.primary);
    for (const {p, eff} of effs) {
      if (!eff) continue;
      const key = p.st.id;
      if (eff.post) add(key, base * hs * agg.sep * agg.jackpot * hx * eff.post);
      if (eff.pre) add(key, B0 * eff.pre * hx);
      if (eff.preTime) add(key, B0 * eff.preTime.per * Math.min(eff.preTime.dur, cycle) / eff.preTime.every * hx);
      if (eff.dot) add(key, B0 * eff.dot.pct * Math.min(eff.dot.sec, cycle) * skillT * hx);
    }
    t += cycle;
  }
  const total = [...src.values()].reduce((a, v) => a + v, 0);
  for (const {p, eff} of effs) if (!eff) warn.push(`${stoneName(p.st)}: ยังไม่ได้คำนวณผลของศิลานี้`);
  return {total, dps:total / env.D, casts, cycle, src, effs, B0, base, cf, n, warn};
}
function checkPicks(info, tags, picks){
  const issues = [];
  const whole = picks.filter(p => isWhole(p.st));
  if (whole.length > 1) issues.push(`ศิลาป้าย "ดาเมจทั้งสกิล" ใส่ได้สกิลละ 1 ก้อน: ${whole.map(p => stoneName(p.st)).join(', ')}`);
  if (picks.some(p => p.st.id === 'pinpoint') && picks.some(p => ['fork','volley','chain','returning'].includes(p.st.id))) issues.push('ศิลาลูกเดียวแรงใส่คู่กับศิลาที่ให้ลูกเพิ่มไม่ได้');
  const ids = picks.map(p => p.st.id); if (new Set(ids).size < ids.length) issues.push('ใส่ศิลาชนิดเดียวกันซ้ำ');
  for (const p of picks) if (!fitsStone(p.st, tags)) issues.push(`${stoneName(p.st)} อาจใส่กับสกิลนี้ไม่ได้ (ต้องการ: ${reqText(p.st)})`);
  return issues;
}
const reqText = st => { const r = st.requires || {}, f = a => a.map(t => TAG_TH[t] || t).join(' + ');
  return [r.all?.length ? f(r.all) : '', r.any?.length ? 'อย่างใดอย่างหนึ่ง: ' + r.any.map(t => TAG_TH[t] || t).join(' / ') : '', r.not?.length ? 'ไม่ใช่: ' + r.not.map(t => TAG_TH[t] || t).join(' / ') : ''].filter(Boolean).join(' · '); };

/* ---------- state ---------- */
calc.sim = Object.assign({N:1, D:30, crit:0, critDmg:150, elMult:1, myHp:100, minI:0.5, bonus:0, party:false, frozen:false, near:true, roll:'avg', searchTier:'legendary', searchLv:1, per:{}}, calc.sim || {});
const simState = id => calc.sim.per[id] ||= {lv:null, stones:[], tags:null, real:0};
const simTags = info => new Set(simState(info.s.id).tags || [...info.guess]);
const sockets = lv => UNLOCK.filter(u => lv >= u).length;
const envOf = () => { const s = calc.sim; return {N:Math.max(1, +s.N || 1), D:Math.max(1, +s.D || 30), crit:+s.crit || 0, critDmg:+s.critDmg || 150, elMult:+s.elMult || 0, myHp:+s.myHp || 100, minI:Math.max(0.1, +s.minI || 0.5), bonus:+s.bonus || 0, party:!!s.party, frozen:!!s.frozen, near:!!s.near, roll:s.roll}; };
const picksOf = (info, st) => (st.stones || []).slice(0, sockets(st.lv)).filter(x => x && stoneById.has(x.id)).map(x => ({st:stoneById.get(x.id), tier:x.tier || 'legendary', lv:x.lv || 1}));

function bestCombos(info, lv, tags, env){
  const k = sockets(lv); if (!k) return [];
  const cand = STONES.filter(st => modelled(st) && fitsStone(st, tags));
  const mk = st => ({st, tier:calc.sim.searchTier, lv:+calc.sim.searchLv || 1});
  const out = [], base = simulate(info, lv, [], env).total;
  const rec = (start, cur) => {
    if (cur.length) {
      const picks = cur.map(mk);
      if (!checkPicks(info, tags, picks).length) { const r = simulate(info, lv, picks, env); out.push({picks, total:r.total, dps:r.dps}); }
    }
    if (cur.length === k) return;
    for (let i = start; i < cand.length; i++) rec(i + 1, [...cur, cand[i]]);
  };
  rec(0, []);
  // best first; on a tie the set with fewer stones wins, and sets that only add useless stones are dropped
  out.sort((a, b) => b.total - a.total || a.picks.length - b.picks.length);
  const list = [];
  for (const x of out) {
    if (list.some(y => Math.abs(y.total - x.total) < 1e-6 * Math.max(1, x.total))) continue;
    list.push(x); if (list.length === 8) break;
  }
  return {list, base, cand:cand.length};
}

/* ---------- UI ---------- */
const fmtD = (v, scale) => scale ? Math.round(v * scale).toLocaleString('en-US') : (v * 100).toFixed(0) + '%';
function simDetail(info){
  const s = info.s, st = simState(s.id), env = envOf(), S = calc.sim;
  if (!st.lv) st.lv = Math.min(s.learnMaxLevel || info.levels, info.levels);
  const tags = simTags(info), k = sockets(st.lv), b = info.at(st.lv);
  const unit = info.mag ? 'MATK' : 'ATK';
  const stoneOpt = (cur) => {
    const groups = [['ใส่ได้ · คำนวณได้', x => fitsStone(x, tags) && modelled(x)], ['ใส่ได้ · ยังไม่คำนวณ', x => fitsStone(x, tags) && !modelled(x)], ['ประเภทไม่ตรง (เผื่อระบบเดาประเภทสกิลผิด)', x => !fitsStone(x, tags)]];
    return `<option value="">— ไม่ใส่ —</option>` + groups.map(([g, f]) => `<optgroup label="${g}">${STONES.filter(f).map(x => `<option value="${x.id}"${x.id === cur ? ' selected' : ''}>${isWhole(x) ? '◆ ' : ''}${esc(stoneName(x))} (${esc(x.thai)})</option>`).join('')}</optgroup>`).join('');
  };
  const num = (k2, label, w = 70, step = 'any', unitTxt = '') => `<label>${label} <input type="number" data-sim="${k2}" step="${step}" value="${esc(S[k2])}" style="width:${w}px">${unitTxt}</label>`;
  const chk = (k2, label) => `<label><input type="checkbox" data-sim="${k2}"${S[k2] ? ' checked' : ''}> ${label}</label>`;
  let h = `<div class="dh"><div class="big">${img(skillIcon(s.id))}</div><div><h1>${esc(s.name)} <span class="note" style="font-size:14px">${esc(s.thai || '')}</span></h1>
    <div class="sub">${esc(className.get(s.classId) || s.classId)} · Lv.${st.lv}: ${b.pct}% ของ ${unit} × ${b.n} ครั้ง · คูลดาวน์ ${b.cd} วิ${info.cast ? ` · ร่าย ${info.cast} วิ` : ''} · ${info.area ? 'โดนเป็นวง' : 'เป้าเดียว'}</div>
    <div class="tags"><a class="tag" href="#skills/${s.id}">ดูข้อมูลสกิล</a></div></div></div>`;
  h += `<section><h2>ประเภทสกิล (ใช้เช็กว่าใส่ศิลาอะไรได้)</h2>
    <p class="note">ข้อมูลเกมไม่ได้บอกประเภทสกิล ระบบเดาจากคำอธิบาย — กดเพื่อแก้ถ้าเดาผิด${st.tags ? ' · <button class="chipbtn" data-sim-tagreset>กลับไปค่าที่ระบบเดา</button>' : ''}</p>
    <div class="cc-els">${SIM_TAGS.map(t => `<label class="${tags.has(t) ? 'on' : ''}"><input type="checkbox" data-sim-tag="${t}"${tags.has(t) ? ' checked' : ''}><span class="tag">${TAG_TH[t]}</span></label>`).join('')}</div></section>`;
  h += `<section><h2>ตั้งค่า</h2>
    <div class="cc-ctl"><label>เลเวลสกิล <select data-sim-lv>${Array.from({length:info.levels}, (_, i) => `<option${i + 1 === st.lv ? ' selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      ${num('N', 'มอนในระยะ', 56, 1, ' ตัว')}${num('D', 'ตีต่อเนื่อง', 60, 1, ' วิ')}${num('minI', 'ดีเลย์ขั้นต่ำต่อการกด', 60, 0.1, ' วิ')}</div>
    <div class="cc-ctl">${num('crit', 'CRIT', 60, 1, ' %')}${num('critDmg', 'ดาเมจคริ', 64, 1, ' %')}${num('elMult', 'ตัวคูณธาตุ', 56, 0.05)}${num('bonus', 'ดาเมจสกิลนี้เพิ่ม (อาวุธ/พาสซีฟ)', 64, 1, ' %')}</div>
    <div class="cc-ctl">${num('myHp', 'HP ตัวเอง', 56, 1, ' %')}${chk('party', 'ตีพร้อมปาร์ตี้')}${chk('frozen', 'เป้าแข็งอยู่')}${chk('near', 'เป้าอยู่ใกล้ 3 ช่อง')}
      <label>ค่าศิลา <select data-sim="roll">${[['min','ต่ำสุด'],['avg','กลาง'],['max','สูงสุด']].map(([v, l]) => `<option value="${v}"${S.roll === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="cc-ctl"><label>ดาเมจจริงของสกิลนี้ 1 ครั้ง (ไม่ใส่ศิลา) <input type="number" data-sim-real value="${st.real || ''}" placeholder="ไม่ใส่ก็ได้" style="width:120px"></label>
      <span class="note">ใส่แล้วจะแสดงเป็นตัวเลขดาเมจโดยประมาณ แทน % ของ ${unit}</span></div>
    <p class="note">CRIT 100% ขึ้นไป = คริทุกครั้ง · "ดาเมจคริ" ตามหน้า status (เช่น 198% = ตอนคริแรง 1.98 เท่า) · ตัวคูณธาตุดูได้จากหน้าแผนที่ (เช่นพิษตีน้ำ = 1.25)</p></section>`;
  h += `<section><h2>ศิลาที่ใส่ <span class="note">(สกิล Lv.${st.lv} มี ${k} ช่อง — ปลดช่องที่ Lv.${UNLOCK.join(' / ')})</span></h2>
    ${k ? Array.from({length:k}, (_, i) => { const x = (st.stones || [])[i] || {}; return `<div class="cc-ctl"><b>ช่อง ${i + 1}</b>
      <select data-sim-stone="${i}" style="flex:1;min-width:200px">${stoneOpt(x.id)}</select>
      <select data-sim-tier="${i}">${TIERS.map(t => `<option value="${t}"${(x.tier || 'legendary') === t ? ' selected' : ''}>${RARITY[t]}</option>`).join('')}</select>
      <label>เลเวล <select data-sim-slv="${i}">${Array.from({length:STONE_MAXLV}, (_, j) => `<option${(x.lv || 1) === j + 1 ? ' selected' : ''}>${j + 1}</option>`).join('')}</select></label></div>`; }).join('') : '<p class="empty">สกิลเลเวลนี้ยังไม่มีช่องศิลา</p>'}
    <div id="sim-stones"></div></section>
    <section><h2>ผลจำลอง</h2><div id="sim-out"></div></section>
    <section><h2>ชุดศิลาที่ดีที่สุดสำหรับสกิลนี้</h2>
      <div class="cc-ctl"><label>ค้นหาด้วยศิลาระดับ <select data-sim="searchTier">${TIERS.map(t => `<option value="${t}"${S.searchTier === t ? ' selected' : ''}>${RARITY[t]}</option>`).join('')}</select></label>
      <label>เลเวลศิลา <select data-sim="searchLv">${Array.from({length:STONE_MAXLV}, (_, j) => `<option${+S.searchLv === j + 1 ? ' selected' : ''}>${j + 1}</option>`).join('')}</select></label></div>
      <div id="sim-best"></div></section>
    <p class="note">สูตรเป็นการประมาณ: ไม่รู้สูตรดาเมจจริงของเกม (ATK → ดาเมจ, DEF) จึงแสดงเป็น % ของ ${unit} · ศิลาป้าย "ดาเมจทั้งสกิล" (◆) ใส่ได้ก้อนเดียว · ศิลาที่ตีเพิ่ม/เลือดไหลคิดจากดาเมจก่อนศิลาตามที่เกมเขียนไว้ ·
    เลเวลศิลาเพิ่มค่าหลัก ${PER_LV}% ต่อเลเวล · ไม่นับ DEF ของมอน ความเร็วโจมตี และการ์ด</p>`;
  return h;
}
function runSim(info){
  const out = $('#sim-out'); if (!out) return;
  const st = simState(info.s.id), env = envOf(), tags = simTags(info);
  const picks = picksOf(info, st), r = simulate(info, st.lv, picks, env), r0 = simulate(info, st.lv, [], env);
  const scale = st.real > 0 ? st.real / r0.B0 : 0, unit = info.mag ? 'MATK' : 'ATK';
  const issues = checkPicks(info, tags, picks);
  const name = k => k === 'skill' ? 'ดาเมจสกิล' : (stoneById.has(k) ? stoneName(stoneById.get(k)) : k);
  $('#sim-stones').innerHTML = picks.map(p => { const {X, text} = stoneNums(p.st, p.tier, p.lv, env.roll); const e = r.effs.find(x => x.p === p)?.eff;
    return `<div class="note" style="margin-top:4px">${isWhole(p.st) ? '◆ ' : ''}<b>${esc(stoneName(p.st))}</b> ${esc(RARITY[p.tier])} Lv.${p.lv}: ${esc(text)} → ใช้ค่า <b>${+X.toFixed(1)}</b>${e?.note ? ` · ${esc(e.note)}` : ''}${!e ? ' · <span style="color:var(--warn)">ยังไม่คำนวณ</span>' : ''}</div>`; }).join('');
  out.innerHTML = `${issues.length ? `<div class="mul w" style="display:block;text-align:left;padding:6px 10px;margin-bottom:8px">${issues.map(esc).join('<br>')}</div>` : ''}
    <div class="kv">
      <div><span>ดาเมจรวม ${env.D} วิ</span><b>${fmtD(r.total, scale)}</b></div>
      <div><span>ต่อวินาที</span><b>${fmtD(r.dps, scale)}</b></div>
      <div><span>เฉลี่ยต่อการกด</span><b>${fmtD(r.total / r.casts, scale)}</b></div>
      <div><span>กดได้</span><b>${r.casts} ครั้ง (ทุก ${r.cycle.toFixed(2)} วิ)</b></div>
      <div><span>เทียบไม่ใส่ศิลา</span><b>${r0.total ? `${r.total >= r0.total ? '+' : ''}${Math.round((r.total / r0.total - 1) * 100)}%` : '-'}</b></div>
    </div>
    <div class="tw" style="margin-top:10px"><table><tr><th>แหล่งดาเมจ</th><th class="num">รวม ${env.D} วิ</th><th class="num">สัดส่วน</th></tr>
    ${[...r.src].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(name(k))}</td><td class="num">${fmtD(v, scale)}</td><td class="num">${r.total ? Math.round(v / r.total * 100) : 0}%</td></tr>`).join('')}
    <tr><td class="note">ไม่ใส่ศิลา</td><td class="num note">${fmtD(r0.total, scale)}</td><td></td></tr></table></div>
    <p class="note">${scale ? 'ตัวเลขเทียบจากดาเมจจริงที่ใส่ไว้' : `ตัวเลขเป็น % ของ ${unit} รวมทุกเป้า (มอน ${env.N} ตัว)`}${r.warn.length ? ' · ' + r.warn.map(esc).join(' · ') : ''}</p>`;
  const best = bestCombos(info, st.lv, tags, env);
  $('#sim-best').innerHTML = !best.list?.length ? `<p class="empty">${sockets(st.lv) ? 'ไม่มีศิลาที่คำนวณได้สำหรับสกิลประเภทนี้' : 'สกิลเลเวลนี้ยังไม่มีช่องศิลา'}</p>`
    : `<div class="tw"><table><tr><th>#</th><th>ศิลา</th><th class="num">รวม ${env.D} วิ</th><th class="num">เทียบไม่ใส่</th><th></th></tr>
      ${best.list.map((x, i) => `<tr class="${i === 0 ? 'best' : ''}"><td>${i + 1}</td><td>${x.picks.map(p => `${isWhole(p.st) ? '◆ ' : ''}${esc(stoneName(p.st))}`).join(' + ')}</td><td class="num">${fmtD(x.total, scale)}</td><td class="num"><b>+${Math.round((x.total / best.base - 1) * 100)}%</b></td>
      <td><button class="chipbtn" data-sim-use="${i}">ใส่ชุดนี้</button></td></tr>`).join('')}</table></div>
      <p class="note">ลองทุกชุดจากศิลาที่ใส่ได้และคำนวณได้ ${best.cand} แบบ ตามประเภทสกิลด้านบนและสถานการณ์ที่ตั้งไว้</p>`;
  window.__simBest = best.list;
}

CATS.sim = {
  label:'จำลองดาเมจ',
  all: SIM_SKILLS,
  filters: st => `<input type="search" data-k="q" placeholder="ค้นหาสกิลโจมตี" value="${esc(st.q)}">
    <select data-k="cls">${opts(Object.fromEntries(SB.classes.filter(c => SIM_SKILLS.some(i => i.s.classId === c.id)).map(c => [c.id, `${c.name} · ${c.thai || ''}`])), 'ทุกอาชีพ', st.cls)}</select>`,
  match: (i, st) => !st.cls || i.s.classId === st.cls,
  text: i => `${i.s.name} ${i.s.thai} ${className.get(i.s.classId) || ''}`,
  row: i => { const b = i.at(i.levels); return {ic:img(skillIcon(i.s.id)), name:esc(i.s.name), sub:`${esc(i.s.thai || '')} · ${esc(className.get(i.s.classId) || '')}`, right:`${b.n > 1 ? b.n + '×' : ''}${b.pct}%`}; },
  get: id => simById.get(id),
  detail: simDetail,
};
CATS.sim.all.forEach(i => { i.id = i.s.id; i.name = i.s.name; });
