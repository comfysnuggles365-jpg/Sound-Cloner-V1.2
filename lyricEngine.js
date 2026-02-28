// ============================================================
// LYRIC ENGINE v2 — Professional Grade
// Combinatorial construction · Seeded PRNG · Near-duplicate detection
// Grammy-level genre intelligence · Rolling history anti-repeat
// ============================================================

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. SEEDED PRNG — mulberry32 (deterministic, no Math.random)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function strToSeed(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

function makePRNG(seedInfo) {
  const { userId = 'anon', sessionId = 'default', nonce = 0, genre = 'pop', songId = 0, timestamp = 0 } = seedInfo;
  const raw = `${userId}|${sessionId}|${nonce}|${genre}|${songId}|${timestamp}`;
  return mulberry32(strToSeed(raw));
}

// PRNG-based helpers
function rPick(rng, arr) {
  if (!arr || arr.length === 0) return '';
  return arr[Math.floor(rng() * arr.length)];
}
function rShuffle(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function rPickN(rng, arr, n) { return rShuffle(rng, arr).slice(0, n); }
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function titleCase(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. NEAR-DUPLICATE DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const STOPWORDS = new Set(['a','an','the','and','but','or','so','of','in','on','at','to','for','is','are','was','were','be','been','i','my','me','we','you','your','it','its','that','this','with','as','by','from','up','do','did','has','have','not','no','he','she','they','their','our','all','just','when','then','now','what','how','who','why','can','will','would','could','should','may','might','get','got','let','like']);

function normTokens(line) {
  return line.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function bigrams(tokens) {
  const bg = [];
  for (let i = 0; i < tokens.length - 1; i++) bg.push(tokens[i] + '_' + tokens[i+1]);
  return bg;
}

function lineHash(line) {
  const tokens = normTokens(line);
  const bgs = bigrams(tokens);
  return { tokens, bgs, key: tokens.slice(0, 6).join('|') };
}

function tokenOverlap(hashA, hashB) {
  if (hashA.tokens.length === 0 || hashB.tokens.length === 0) return 0;
  // Token Jaccard
  const setA = new Set(hashA.tokens);
  const setB = new Set(hashB.tokens);
  let tShared = 0;
  setA.forEach(t => { if (setB.has(t)) tShared++; });
  const tUnion = setA.size + setB.size - tShared;
  const tokenScore = tUnion === 0 ? 0 : tShared / tUnion;
  // Bigram Jaccard (more sensitive to order/structure)
  const bgA = new Set(hashA.bgs);
  const bgB = new Set(hashB.bgs);
  let bgShared = 0;
  bgA.forEach(b => { if (bgB.has(b)) bgShared++; });
  const bgUnion = bgA.size + bgB.size - bgShared;
  const bigramScore = bgUnion === 0 ? 0 : bgShared / bgUnion;
  // Weight: 60% token, 40% bigram — bigrams catch reordered duplicates
  return tokenScore * 0.6 + bigramScore * 0.4;
}

// ── Rolling History Manager ───────────────────────────────────
class RecentHistory {
  constructor(maxSize = 200) {
    this.maxSize = maxSize;
    this.hashes = []; // array of {tokens, bgs, key}
    this.keySet = new Set();
  }
  add(line) {
    const h = lineHash(line);
    if (this.keySet.has(h.key)) return; // exact near-match already in
    this.hashes.push(h);
    this.keySet.add(h.key);
    if (this.hashes.length > this.maxSize) {
      const removed = this.hashes.shift();
      this.keySet.delete(removed.key);
    }
  }
  isDuplicate(line, threshold = 0.70) {
    const h = lineHash(line);
    if (this.keySet.has(h.key)) return true;
    for (const prev of this.hashes) {
      if (tokenOverlap(h, prev) > threshold) return true;
    }
    return false;
  }
  addSong(lines) { lines.forEach(l => this.add(l)); }
  toJSON() { return { hashes: this.hashes, maxSize: this.maxSize }; }
  static fromJSON(data) {
    const h = new RecentHistory(data.maxSize || 200);
    (data.hashes || []).forEach(entry => {
      h.hashes.push(entry);
      if (entry.key) h.keySet.add(entry.key);
    });
    return h;
  }
}

// Global in-memory history (per session, persist via localStorage)
const _globalHistory = new RecentHistory(500);
const _songUsedLines = new Set(); // cleared per song
const _persistentOpeners = new Set(); // permanently used openers — loaded from localStorage
let _composeRatio = 0.50; // Dynamic: increases as batch progresses to avoid pool exhaustion
const _batchUsedLines = new Set(); // Exact-match dedup across all songs in a batch — cleared per batch

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. RHYME DICTIONARY — pre-paired end words for reliable rhymes
// Groups of 4-8 words that all rhyme with each other.
// Used to anchor line endings before building full lines.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const RHYME_GROUPS = [
  // ── CORE ONE-SYLLABLE ──────────────────────────────────────────
  // -ight / -ite
  ['night','light','right','fight','sight','might','flight','bright','height','write','ignite','tonight','midnight','moonlight','starlight','daylight','spotlight','oversight','hindsight','insight','delight'],
  // -ound / -own (hard)
  ['ground','sound','found','bound','crown','down','town','around','profound','surround','renowned','underground','background','rebound','resound','astound','compound','expound'],
  // -ain / -ane
  ['pain','rain','gain','remain','sustain','domain','terrain','maintain','explain','refrain','campaign','obtain','complain','entertain','contain','insane','hurricane','champagne','cocaine','mundane','vain','chain','lane','plane','train','brain','strain','drain','plain'],
  // -eal / -eel
  ['real','feel','deal','heal','reveal','conceal','appeal','steel','zeal','ideal','surreal','ordeal','kneel','wheel','peel','steal','seal','meal','reel','repeal'],
  // -ive / -rive
  ['alive','drive','thrive','survive','arrive','strive','revive','five','hive','connive','deprive','contrive','beehive','nosedive','archive'],
  // -ore / -oor
  ['more','before','restore','ignore','explore','adore','hardcore','floor','door','score','shore','implore','encore','deplore','folklore','metaphor','therefore','offshore','rapport','sophomore','furthermore','galore','roar','soar','pour','swore','wore','core','bore','war','lore','four'],
  // -ame / -aim
  ['name','game','flame','fame','claim','came','same','frame','aim','proclaim','reclaim','became','aflame','disclaim','defame','nickname','overcome','shame','blame','tame','lame'],
  // -ong / -rong
  ['strong','long','belong','song','along','wrong','prolong','lifelong','headstrong','all along','before long','come along','carry on','carry strong'],
  // -art / -ark
  ['heart','start','art','apart','smart','chart','part','spark','dark','mark','stark','remark','hallmark','benchmark','restart','depart','impart','upstart'],
  // -ack / -act
  ['back','track','fact','act','stack','black','crack','pack','attack','impact','setback','feedback','counteract','abstract','attract','interact','contract','contact','exact','extract'],
  // -ell / -eal
  ['tell','well','fell','sell','spell','dwell','compel','excel','expel','rebel','repel','quell','swell','shell','yell','smell','propel','farewell','parallel','carousel'],
  // -ove / -un
  ['love','above','overcome','become','run','done','won','one','begun','gun','none','sun','fun','son','front','hunt','stunt','blunt','unt','confront','affront','upfront'],
  // -end / -ent
  ['end','friend','defend','extend','transcend','depend','bend','blend','trend','ascend','intend','offend','pretend','recommend','amend','spend','lend','mend','blend','comprehend'],
  // -eed / -ead (alive)
  ['need','freed','lead','speed','proceed','succeed','bleed','seed','feed','creed','indeed','exceed','concede','precede','supersede','agreed','guaranteed'],
  // -ead / -ed (dead)
  ['head','said','ahead','instead','spread','dread','thread','led','fed','wed','bed','dead','red','bread','shed','tread','widespread','overhead','mislead'],
  // -all / -aul
  ['call','fall','tall','wall','recall','enthrall','install','overall','rainfall','downfall','freefall','appall','overhaul','nightfall','pitfall','footfall','windfall','snowfall','curtain call'],
  // -ife / -ife
  ['life','knife','wife','strife','afterlife','nightlife','wildlife','midlife'],

  // ── TWO-SYLLABLE (most important for quality rhymes) ───────────
  // -ation / -ation
  ['nation','foundation','dedication','elevation','transformation','celebration','revelation','liberation','salvation','determination','frustration','temptation','imagination','inspiration','situation','destination','conversation','generation','sensation','vibration','education','motivation','hesitation','graduation','medication','expectation','reputation','isolation','domination','damnation','creation','starvation','deviation'],
  // -ness
  ['greatness','realness','darkness','loneliness','awareness','completeness','forgiveness','restlessness','willingness','readiness','emptiness','happiness','sadness','madness','gladness','hardness','coldness','boldness','oldness','weakness','sickness','thickness','quickness','stillness','illness','fullness','numbness','dumbness'],
  // -ing (present participle rhyme groups)
  ['rising','shining','grinding','defining','climbing','finding','surviving','arriving','thriving','deciding','providing','dividing','residing','confiding','presiding','abiding'],
  ['breaking','making','taking','faking','waking','shaking','aching','chasing','facing','racing','pacing','placing','tracing','spacing','embracing'],
  ['falling','calling','stalling','crawling','bawling','appalling','installing','enthralling','recalling'],
  ['running','coming','becoming','numbing','humming','drumming','strumming','overcoming','succumbing'],
  ['trying','crying','dying','flying','lying','sighing','defying','relying','denying','satisfying','terrifying','unifying','magnifying','intensifying'],
  ['living','giving','forgiving','unforgiving','misgiving','outliving'],
  // -tion (action nouns)
  ['motion','emotion','devotion','ocean','notion','potion','commotion','promotion','explosion','erosion','corrosion','implosion'],
  ['passion','fashion','action','fraction','distraction','attraction','abstraction','satisfaction','reaction','transaction','compassion'],
  // -ture
  ['future','picture','capture','rapture','mixture','fixture','fracture','manufacture','departure','adventure','venture','nature','culture','vulture','sculpture'],
  // -ory
  ['story','glory','victory','territory','category','allegory','inventory','mandatory','mandatory','contradictory','exploratory','promissory'],

  // ── MULTI-SYLLABLE (for sophisticated internal rhymes) ─────────
  // -ation (full words)
  ['imagination','determination','transformation','liberation','celebration','elevation','revelation','desperation','exhilaration','contemplation','manifestation','hallucination','anticipation','procrastination','accumulation'],
  // -ity
  ['city','pretty','witty','gritty','pity','committee','reality','mortality','brutality','vitality','mentality','formality','originality','spirituality','individuality','universality','personality','capability','possibility','probability','visibility','responsibility','opportunity','community','immunity','unity','purity','security','maturity','obscurity','authority','majority','minority','priority','celebrity','gravity','clarity','charity','rarity','scarcity','familiarity'],
  // -ible / -able
  ['capable','stable','able','label','table','fable','payable','unshakeable','relatable','comfortable','remarkable','comparable','unbreakable','unforgettable','insatiable','unimaginable','unavoidable'],
  // -ious / -eous
  ['glorious','victorious','notorious','mysterious','delirious','serious','curious','furious','hilarious','laborious','inglorious','meritorious','uproarious'],

  // ── SLANT RHYMES (genre-specific feel) ────────────────────────
  // Soul / R&B slant
  ['emotions','oceans','devotion','notion','motion','commotion','slow motion'],
  ['desire','fire','higher','inspire','entire','acquire','admire','perspire','aspire','choir','liar','buyer','flyer','dryer'],
  ['tender','remember','surrender','defender','gender','render','sender','slender','vendor','wonder','under','thunder','blunder','plunder','asunder'],
  // Hip-hop slant (internal cadence words)
  ['real','deal','feel','steal','meal','appeal','conceal','congeal','ordeal','zeal','heel','kneel','peel','reel','seal','wheel'],
  ['stack','back','track','black','crack','pack','attack','whack','lack','knack','rack','tack','flak','fact','act'],
  ['grind','mind','find','blind','kind','bind','wind','signed','aligned','defined','designed','refined','combined','behind','remind','mankind','rewind','intertwined'],
  // Country / folk slant
  ['home','alone','stone','bone','known','grown','shown','flown','throne','tone','phone','zone','moan','groan','prone','drone','loan','hone','own','sown','blown','flow','know','go','though','so'],
  ['road','load','ode','abode','episode','commode','railroad','threshold','behold','uphold','household','stronghold','marigold','manifold','blindfold'],
  // Jazz / blues slant
  ['blue','true','through','new','knew','you','do','few','view','grew','flew','drew','brew','clue','due','glue','pursue','construe','imbue','renew','review','debut','taboo','bamboo','tattoo','voodoo'],
  ['rain','again','remain','explain','complain','contain','maintain','sustain','terrain','obtain','insane','campaign','hurricane','mundane','vain','chain','plane','strain'],
  // Metal slant
  ['darkness','starkness','arcane','domain','profane','slain','pain','reign','chain','disdain','campaign','bane','wane','cane','crane'],
  ['fire','pyre','empire','inspire','entire','vampire','ire','dire','tire','wire','hire','squire','mire','quagmire','conspire','expire'],
  ['power','tower','hour','devour','flower','shower','cower','glower','sour','empower','overpower'],
  // Gospel slant
  ['grace','place','face','chase','race','embrace','erase','replace','disgrace','space','trace','base','case','pace','phase','praise'],
  ['free','be','see','me','key','plea','decree','agree','jubilee','guarantee','devotee','marquee','spree','flee','glee','knee','lee','fee','foresee'],
  // K-pop / pop slant
  ['shine','mine','fine','line','divine','align','design','define','combine','decline','entwine','assign','confine','malign','refine','resign','intertwine','crystalline','serpentine','borderline','underline','valentine','superfine'],
  ['together','forever','never','clever','endeavor','whatever','whenever','wherever','however','whoever','deliver','consider','remember','surrender','weather','feather','leather','tether','whether'],
  // Reggae / afrobeats slant
  ['truth','youth','proof','roof','uncouth','sleuth','aloof'],
  ['rise','eyes','skies','prize','size','wise','lies','ties','surprise','realize','recognize','sympathize','harmonize','organize','memorize','summarize','authorize','energize','minimize','maximize','analyze','emphasize','advertise','compromise','agonize','patronize','exercise','supervise','disguise','surmise','advise','devise','revise','demise','despise'],

  // ── COMMON PHRASE ENDINGS (for natural line completion) ────────
  ['before','anymore','at my core','ignore','restore','explore','adore','explore more','what I\'m for','open the door','hit the floor','keep the score','nothing more','to the core','settle the score'],
  ['tonight','feels right','hold tight','out of sight','burning bright','in the night','second sight','takes flight','wins the fight','makes things right','see the light','all my might','black and white','pure delight','day and night'],
  ['in the end','around the bend','a message to send','time to mend','hard to comprehend','the rules I bend','on me you depend','a new trend'],
  ['let it go','high and low','steal the show','undertow','afterglow','overflow','status quo','what I know','watch it grow','go with the flow','reap what you sow'],
];

// Pick a rhyme group and return N words from it
function pickRhymeSet(rng, count) {
  const group = rPick(rng, RHYME_GROUPS);
  const shuffled = [...group].sort(() => rng() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. RHYME ENGINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getLastSyllable(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g,'');
  if (w.length < 2) return w;
  const stripped = w.replace(/(ing|tion|sion|ness|ment|er|ed|ly|est|ful|less|al)$/,'') || w;
  const match = stripped.match(/[aeiou]+[^aeiou]*$/);
  return match ? match[0] : stripped.slice(-3);
}
function rhymeFamily(word) {
  const syl = getLastSyllable(word);
  return syl.length >= 3 ? syl.slice(-3) : syl;
}
// Force a generated line to end with a specific rhyme word
// Strips the last word and replaces with rhymeWord — preserves line content
function forceEndRhyme(line, rhymeWord) {
  if (!line || !rhymeWord) return line;
  const clean = line.trim().replace(/[.,!?;]+$/, '');
  const words = clean.split(/\s+/);
  if (words.length <= 2) return clean + ' ' + rhymeWord;

  // If line has a natural em-dash break in the second half, cut there and append
  const dashIdx = clean.lastIndexOf('\u2014');
  const dashIdx2 = clean.lastIndexOf(' — ');
  const breakIdx = Math.max(dashIdx, dashIdx2);
  if (breakIdx > 0 && breakIdx > clean.length * 0.35) {
    const before = clean.slice(0, breakIdx).trim();
    return before + ' — ' + rhymeWord;
  }

  // Standard: remove last word, append rhyme word
  const body = words.slice(0, -1).join(' ').replace(/[,—\s]+$/, '').trim();
  return body + ' ' + rhymeWord;
}

// Build a line guaranteed to end with a rhyme-word from the rhyme dictionary
function buildAnchoredVerseLine(rng, genre, songUsed, globalHist, rhymeWord, isOpener, theme, register, genreKey, arcPhase) {
  // Strategy 1: scan the pre-written pool, arc-phase biased
  // 'establish' (verse1) → prefer first half of pool (origin/scene-setting lines)
  // 'complicate'/'pivot' (verse2/bridge) → prefer second half (depth/reflection)
  // 'resolve' (outro) → prefer last quarter (earned/conclusive lines)
  const fullPool = (GENRE_LINES[genreKey] || GENRE_LINES.default || []);
  const half = Math.floor(fullPool.length / 2);
  const quarter = Math.floor(fullPool.length * 0.75);
  let pool;
  if (arcPhase === 'establish' || arcPhase === 'origin') {
    // Early lines: first 60% — scene-setting, origin, concrete
    pool = fullPool.slice(0, Math.ceil(fullPool.length * 0.6));
  } else if (arcPhase === 'complicate' || arcPhase === 'struggle' || arcPhase === 'fall') {
    // Mid lines: full pool with preference for middle section
    pool = fullPool;
  } else if (arcPhase === 'pivot' || arcPhase === 'rock_bottom') {
    // Bridge lines: second half — pivot, turn, revelation
    pool = fullPool.slice(half);
  } else if (arcPhase === 'resolve' || arcPhase === 'victory' || arcPhase === 'impact') {
    // Outro lines: last 40% — earned, conclusive, legacy
    pool = fullPool.slice(quarter);
  } else {
    pool = fullPool;
  }
  // Ensure pool is never empty
  if (pool.length < 5) pool = fullPool;
  // Try composing first if batch is deep
  if (rng() < _composeRatio) {
    for (let ci = 0; ci < 8; ci++) {
      const composed = composeLine(rng, genre, genreKey, songUsed);
      if (composed && !_batchUsedLines.has(composed)) {
        if (rhymesFast(rhymeWord, lastWord(composed)) || ci >= 5) {
          songUsed.add(composed);
          _batchUsedLines.add(composed);
          return composed;
        }
      }
    }
  }

  const shuffled = rShuffle(rng, pool);
  for (const candidate of shuffled) {
    if (!songUsed.has(candidate) && !_batchUsedLines.has(candidate)) {
      if (rhymesBetter(rhymeWord, lastWord(candidate))) {
        songUsed.add(candidate);
        _batchUsedLines.add(candidate);
        return candidate;
      }
    }
  }

  // Strategy 2: loosen the rhyme requirement — accept near-rhyme (rhymesFast)
  const shuffled2 = rShuffle(rng, pool);
  for (const candidate of shuffled2) {
    if (!songUsed.has(candidate) && !_batchUsedLines.has(candidate)) {
      if (rhymesFast(rhymeWord, lastWord(candidate))) {
        songUsed.add(candidate);
        _batchUsedLines.add(candidate);
        return candidate;
      }
    }
  }

  // Strategy 3: compose a unique line (quality over forced rhyme)
  for (let ci = 0; ci < 10; ci++) {
    const composed = composeLine(rng, genre, genreKey, songUsed);
    if (composed && !_batchUsedLines.has(composed)) {
      songUsed.add(composed);
      _batchUsedLines.add(composed);
      return composed;
    }
  }

  // Strategy 4: fresh unused pool line without rhyme constraint
  for (const candidate of rShuffle(rng, pool)) {
    if (!songUsed.has(candidate) && !_batchUsedLines.has(candidate)) {
      songUsed.add(candidate);
      _batchUsedLines.add(candidate);
      return candidate;
    }
  }

  // Final fallback: duplicate is okay, quality over destruction
  return rPick(rng, pool) || buildLine(rng, genre, songUsed, globalHist, 12, isOpener, theme, register, genreKey, arcPhase);
}

function buildAnchoredHookLine(rng, genre, songUsed, globalHist, rhymeWord, theme, register, genreKey) {
  const pool = (GENRE_LINES[genreKey] || GENRE_LINES.default || []);
  const hookFrags = genre.hookFragments || [];

  // Strategy 1: compose a unique hook line first (later songs compose more aggressively)
  if (rng() < _composeRatio) {
    for (let ci = 0; ci < 8; ci++) {
      const composed = composeHookLine(rng, genre, genreKey, songUsed);
      if (composed && !_batchUsedLines.has(composed)) {
        if (rhymesFast(rhymeWord, lastWord(composed)) || ci >= 5) {
          songUsed.add(composed);
          _batchUsedLines.add(composed);
          return composed;
        }
      }
    }
  }

  // Strategy 2: Try hook fragments (short/punchy — ideal for chorus)
  const shuffledHooks = rShuffle(rng, hookFrags);
  for (const candidate of shuffledHooks) {
    if (!songUsed.has(candidate) && !_batchUsedLines.has(candidate) && rhymesBetter(rhymeWord, lastWord(candidate))) {
      songUsed.add(candidate);
      _batchUsedLines.add(candidate);
      return candidate;
    }
  }

  // Strategy 3: Try full pool for rhyme match
  for (const candidate of rShuffle(rng, pool)) {
    if (!songUsed.has(candidate) && !_batchUsedLines.has(candidate)) {
      if (rhymesBetter(rhymeWord, lastWord(candidate))) {
        songUsed.add(candidate);
        _batchUsedLines.add(candidate);
        return candidate;
      }
    }
  }

  // Strategy 4: Loosen to near-rhyme
  for (const candidate of rShuffle(rng, [...hookFrags, ...pool])) {
    if (!songUsed.has(candidate) && !_batchUsedLines.has(candidate) && rhymesFast(rhymeWord, lastWord(candidate))) {
      songUsed.add(candidate);
      _batchUsedLines.add(candidate);
      return candidate;
    }
  }

  // Strategy 5: Compose without rhyme constraint
  for (let ci = 0; ci < 5; ci++) {
    const composed = composeHookLine(rng, genre, genreKey, songUsed);
    if (composed && !_batchUsedLines.has(composed)) {
      songUsed.add(composed);
      _batchUsedLines.add(composed);
      return composed;
    }
  }

  // Final fallback
  return buildHookLine(rng, genre, songUsed, globalHist, theme, register, genreKey);
}

function rhymesFast(a,b) {
  if (!a||!b) return false;
  const la=a.toLowerCase().replace(/[^a-z]/g,'');
  const lb=b.toLowerCase().replace(/[^a-z]/g,'');
  if (la===lb) return false;
  for (let n=4;n>=2;n--) if (la.length>=n&&lb.length>=n&&la.slice(-n)===lb.slice(-n)) return true;
  return false;
}
function rhymesBetter(a,b) {
  if (rhymesFast(a,b)) return true;
  const fa=rhymeFamily(a), fb=rhymeFamily(b);
  if (fa&&fb&&fa===fb) return true;
  const PAIRS=[['tion','sion'],['ing','ring'],['ight','ite'],['ane','ain'],['eed','ead'],['ize','ise'],['ent','ant'],['ome','oan'],['own','ound'],['ive','rive'],['ore','oor'],['air','are']];
  for (const [x,y] of PAIRS) if ((a.endsWith(x)&&b.endsWith(y))||(a.endsWith(y)&&b.endsWith(x))) return true;
  return false;
}
function lastWord(line) {
  const clean=line.replace(/[.,!?;—–\-'"]+$/,'').trim();
  const words=clean.split(/\s+/);
  return words[words.length-1].toLowerCase().replace(/[^a-z]/g,'');
}

// Safety filter
const SLUR_PATTERNS = [];
function safetyFilter(line) {
  let out = line;
  SLUR_PATTERNS.forEach(p => { out = out.replace(p,'***'); });
  return out;
}




// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. PER-GENRE LINE TEMPLATES
// Each genre gets templates that match its lyrical cadence
// {S}=subject {V}=verbPhrase {I}=image {M}=modifier {T}=topic
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GENRE_TEMPLATES = {

  hiphop: [
    // Bar-forward declarative (most authentic hip-hop cadence)
    '{S} {V}',
    '{S} {V}, {M}',
    '{S} {V} — {M}',
    // Internal / double-time feel
    '{S} {V}, {S} {V}',
    '{V}, {V} — {M}',
    // Topic / flex lines
    'every {T} {V}',
    'real {T} {V}, {M}',
    '{T} on my mind, {S} {V}',
    // Image-driven
    '{I}, {S} {V}',
    '{I} — {S} {V}',
    // Punchline structure
    '{S} {V} {I}',
    'said {S} {V}',
    // Boast / anthem
    '{M} — {S} {V}',
    'watch {S} {V}',
    'they said {S} {V}',
    'told me {S} would never {V}',
  
    // Additional lines for variety
    "Every syllable I write is a decision, not an accident",
    "I treat every sixteen like it might be the last one I get",
    "The pen is the only thing they couldn't confiscate from me",
    "I let the beat breathe before I say the thing that matters",
    "My flow is the proof of concept — the lyrics are the argument",
    "Ive been sharpening this craft since before it had a name",
    "Every bar I drop is something I lived before I said it",
    "I don't write songs — I write evidence of where Ive been",
    "The verse is the map of the journey that the chorus celebrates",
    "I earn every metaphor I use — nothing borrowed, all mine",
    "Summer nights in the city taught me the value of survival",
    "The corner where we grew up is a character in every song I write",
    "I know every pothole on the route from nothing to something",
    "The city gave me everything and tried to take it back at interest",
    "There are streets that shaped me more than any school I ever sat in",
    "Late nights on the block — the streetlight was the only audience",
    "Every city has a language — mine was written in persistence",
    "We were products of a system built to produce our failure",
    "The zip code on my birth certificate was supposed to be my ceiling",
    "I turned the soundtrack of my struggle into the anthem of my city",
    "Generational wealth starts with somebody who refused to stop",
    "Im not chasing paper — Im building something that outlasts it",
    "My ambition is not a phase — it's the permanent state of operation",
    "The goal was never to be rich — the goal was to be free",
    "I work like the opportunity could close any second because it could",
    "Every investment I make I make with my children in the calculation",
    "The hustle is a discipline — it's not about the money first",
    "I learned early that the dream requires infrastructure to support it",
    "From sleeping on the floor to owning what I sleep inside — that's real",
    "The version of success I want doesn't have a number on it",
    "I move different now but the fundamentals never changed",
    "Pressure made me polished — ask anybody in this building",
    "Im not the loudest in the room — Im the reason the room is full",
    "Earned every accolade with time that I can never get returned",
    "They copied the blueprint without understanding what it cost to build",
    "I don't need to announce my arrival — the results do that",
    "The aura is a product of the discipline they never saw",
    "Every feature I do becomes the best thing on the project — facts",
    "I was built for rooms like this long before I had access",
    "The difference between us is I never stopped when stopping made sense",
    "I am the first in a long line of lasts — the chain breaks with me",
    "My name in the credits next to the ones I studied as a kid",
    "They said the genre was saturated — I said that's not my problem",
    "I count the hours nobody saw before I count the money anyone sees",
    "Every stage Ive stood on I prepared for in a room with no audience",
    "The journey from the audition to the headliner spot — every step was real",
    "Nobody handed me the beat — I learned to build the room around the sound",
    "I filed the paperwork on my own dreams because nobody else believed",
    "My story isn't over — Im still in the part that's hardest to explain",
    "This is the version of me that the version before me was working toward",
  ],

  pop: [
    // Big singable lines
    '{S} {V}',
    '{S} {V}, {M}',
    'I {V} {I}',
    // Emotional / romantic
    '{I} — {M}',
    '{I}, {S} {V}',
    '{S} {V} every time',
    '{S} {V} — {M}',
    // Anthemic / universal
    'we {V} {I}',
    'every {T} {V}',
    '{M} — {S} {V}',
    // Conversational
    'you make {S} {V}',
    'I know {S} {V}',
    'tell me {S} {V} {I}',
    'maybe {S} {V}',
    '{S} {V} again',
  
    // Additional lines for variety
    "I drove past your street three times before I let myself go home",
    "Your laugh is the ringtone I never changed even after everything",
    "We were the kind of careless that only happens when you're twenty-two",
    "I found your name in the playlist I said I'd deleted",
    "Something in the chorus of that song still makes me catch my breath",
    "The version of us in the photos — I understand why I miss it",
    "You were the beautiful mistake I keep learning from",
    "I had a whole speech prepared and lost it when I saw your face",
    "We could keep pretending this is nothing if you want to",
    "The thing about almost-love is it almost doesn't hurt — almost",
    "I made my peace with ordinary living — then you showed up",
    "There's a whole category of feeling that only has your name",
    "I thought I was over you until I wasn't — classic plot twist",
    "All the plans I made for someone else — they all fit you better",
    "I told everyone I was fine and meant it until tonight",
    "Standing in the kitchen at midnight and missing something I can't name",
    "Every city I visit I look for somewhere we could have gone together",
    "You are the reason certain songs still hit different than they should",
    "I want the version of this story where we both say yes at the same time",
    "We built something impossible and then managed to make it real",
    "The light through the curtains and your coffee going cold — that was enough",
    "I keep the ticket stub from the first show in the pocket of that coat",
    "Whatever happens after this Im glad this version of me got to exist",
    "Tonight feels like the kind of night that gets remembered forever",
    "I want to give you the version of me Ive been working on",
    "The universe conspired wildly just to put us in the same room",
    "I know exactly when I fell — it was that Wednesday in October",
    "You didn't save me — you made it possible for me to save myself",
    "I want the simple version: just us, just this, just here",
    "Every song I love sounds different since I met you",
    "I used to think I was complicated — turns out I just hadn't found my match",
    "Something shifted in the air the moment you walked in and I felt it",
    "Let's make the kind of memory that survives every hard year after",
    "The thing about a good thing is you know it even before you name it",
    "I have never been more willing to be completely wrong about the future",
    "You are the unexpected answer to a question I forgot I'd asked",
    "I stopped keeping score the day I realized it was never a competition",
    "Every version of tomorrow I can imagine has you somewhere in it",
    "I want to know every ordinary Tuesday you've ever had",
    "Whatever this is — I want more of it than Im supposed to say",
    "I put the album on and let it play until it means something else",
    "You make the reckless version of me seem completely reasonable",
    "I came here with no expectations and now Im reconsidering everything",
    "The world kept moving like it always does and we just stayed still",
    "Something about the way you say goodnight still hits like a first time",
    "I want to see you on a regular Tuesday with nowhere to be",
    "You are the reason I believe that good things still arrive without warning",
    "I stopped waiting for the right moment and made the moment right",
    "Every boundary I drew carefully — you made me want to redraw them all",
    "This is the feeling I was trying to describe in every song before this",
  ],

  rnb: [
    // Intimate / sensual
    '{S} {V}',
    '{S} {V}, {M}',
    '{I} — {M}',
    // Melodic / phrasing
    '{S} {V} {I}',
    'you {V} {I}',
    'baby {S} {V}',
    '{I}, {S} {V}',
    // Vulnerable / conversational
    'I need {S} to {V}',
    '{M} — {S} {V}',
    'when {S} {V}',
    'how {S} {V} {I}',
    'still {S} {V}',
    'every {T} {V}, {M}',
  
    // Additional lines for variety
    "I know the exact moment I stopped pretending this was casual",
    "You showed up quiet and rearranged everything without asking",
    "There's a specific kind of silence with you that I keep returning to",
    "I didn't plan for any of this — that's what makes it real",
    "Every time I think Ive got my guard back up you walk in",
    "Real love doesn't announce itself — it just keeps showing up",
    "You know me at the unglamorous hour and still chose to stay",
    "I been most honest with you at 2am when I have nothing left to perform",
    "The thing about desire is that it doesn't negotiate with logic",
    "You occupy a frequency that nothing else in my life accesses",
    "I want to give you the version of me I don't show anyone",
    "There is something about your patience that disarms me every time",
    "I came ready to leave and you gave me a reason to stay and mean it",
    "The most intimate thing you did was listen without trying to fix it",
    "I want to love you in the quiet hours when the world isn't watching",
    "Every argument we ever had was just us learning how to hold each other",
    "I found the version of safe I'd given up on finding — that was you",
    "You love me in the morning before Ive earned it and that's the whole thing",
    "The way you remember the small details — that's the love language I needed",
    "I have never been so willing to be this completely seen",
    "You are the specific warmth that all the poetry was trying to describe",
    "I keep all your voice notes — I play them when I need to feel less alone",
    "There are things I couldn't say to anyone — I tried to write them for you",
    "You stayed through the version of me that was hardest to stay through",
    "I trust you with the parts of me I spent years learning to protect",
    "After everything Ive been through you make me believe in trying",
    "You are the resolution of a tension Ive been carrying for years",
    "I want to spend the Sunday mornings and the difficult Tuesdays with you",
    "Something about your presence makes the hard things slightly smaller",
    "You didn't complete me — you reminded me I was already complete",
    "I love you most in the ordinary moments when you don't know Im watching",
    "We built this slowly and carefully and it is the best thing Ive made",
    "You make vulnerability feel less like exposure and more like connection",
    "The specific way you hold my face — I memorized it without trying",
    "I want to know all the versions of you that came before I did",
    "We talk about everything and nothing and both feel like the same gift",
    "The line between needing you and wanting you disappeared somewhere",
    "You are the reason I softened all the hard edges I'd spent years building",
    "I catch myself thinking about you at the most inconvenient moments",
    "Every song I write is trying to say something you already know",
    "The hardest part of loving you is being worthy of how you love back",
    "I want to be the person you come home to after every difficult thing",
    "You taught me the difference between being loved and being truly known",
    "I have been most alive in the moments I stopped trying to protect myself",
    "You are not what I planned for — you are better than what I planned for",
    "The way we disagree and come back — that's what I was looking for",
    "I chose you the first time — I keep choosing you every day after",
    "You are the steady thing inside every season that has tried to shake me",
    "I want to grow old enough to understand the full depth of loving you",
    "This is the love I wrote about before I knew it was real and possible",
  
    "I fall for you completely every time I think Ive gotten myself together",
  ],

  country: [
    // Storytelling / image-first
    '{I}, {S} {V}',
    '{I} — {M}',
    '{S} {V} {I}',
    // Plain-spoken truth
    '{S} {V}',
    '{S} {V}, plain and simple',
    'there\'s a {T} that {V}',
    // Character / place
    'back home {S} {V}',
    'down the {T}, {S} {V}',
    '{I} — {S} {V}',
    // Reflective
    'I remember when {S} {V}',
    'used to {V} {I}',
    'these days {S} {V}',
    '{M} — {S} {V}',
    'lord knows {S} {V}',
  
    // Additional lines for variety
    "The old truck still runs because he kept every part of it himself",
    "I got my mother's stubborn heart and my father's easy laugh",
    "Barefoot in the garden before the summer heat sets in",
    "There's a jar of lightning bugs in a memory I'll never let go of",
    "We put the kids to bed and sat outside til the fireflies found us",
    "I learned more about character from one hard winter than a lifetime of easy",
    "The county line is where the city promises stop meaning anything",
    "She left him on a Friday and he played guitar all weekend on the porch",
    "Some people need the ocean — I need this creek and this quiet",
    "Third generation on this land and the land still remembers every one of us",
    "I don't need the whole world — just this backroad and someone to share it",
    "The hymn they sang at his funeral is the same one he sang me to sleep with",
    "Rain on a tin roof is the only lullaby I ever really needed",
    "My grandmother could stretch a dollar into a whole week of dignity",
    "There's a version of home that only exists inside a specific summer",
    "Ive been carrying this hammer since he put it in my hands at twelve",
    "The garden teaches patience in a way that nothing else can",
    "We didn't have much but we always had the table full on Sunday",
    "Every pickup truck Ive owned has known the weight of grief and hope",
    "She left her lipstick by the mirror and thirty years of love in the hall",
    "The stars out here remind you that you're small in the best possible way",
    "I drove the back roads til I found the version of myself I'd misplaced",
    "Dirt roads and distant lightning — that's the summer I grew up in",
    "Some people find God in cathedrals — I find mine in open fields",
    "The front porch is the only therapist this town has ever really needed",
    "I am made of the same soil that made every generation before me",
    "The almanac was right about the frost and wrong about the heartbreak",
    "First light on a working farm is a cathedral with better acoustics",
    "We danced in the driveway to the radio because that's what we had",
    "The old barn still has names carved in the wood from before my time",
    "Nothing prepares you for the day the land you grew up on gets sold",
    "She kept her mother's recipe box and that's the whole inheritance I needed",
    "The difference between country music and therapy is the price of admission",
    "I stayed when everyone my age was leaving and I don't regret a single day",
    "Every creek crossing in this county has a story my family left in it",
    "I know the sound of this land in every season and I love it all the same",
    "Two steps and a spin and suddenly we're twenty again in the barn",
    "The cattle understand the weather better than the weatherman",
    "My grandfather said the land will tell you what it needs — listen",
    "A good dog, a cold morning, and no particular place to be",
    "Faith is what you hold when the harvest fails and you plant again",
    "I'll take the honest beauty of a hard season over the easy kind any day",
    "The kind of tired that comes from working your own land is a gift",
    "We don't lock the door because the neighbors are the whole security system",
    "I measure a good life in sunsets from the back porch of my own home",
    "The children we raised here carry this county in their bones forever",
    "First snow of winter falls and the whole farm gets a kind of silence",
    "She can read the sky better than any app Ive ever downloaded",
    "The creek flooded in '98 and we rebuilt — that's what we do here",
    "This land is the longest love story in our family's whole history",
  
    "I count my blessings in the small things the wealthy would drive right past",
    "The creek's still running where we used to sit and settle our biggest fights",
    "I swear this land grew richer every year we poured our lives into it",
  ],

  rock: [
    // Driving / declarative
    '{S} {V}',
    '{S} {V} — {M}',
    '{S} {V}, {M}',
    // Defiant / anthem
    'never {V} — {M}',
    'we {V} {I}',
    '{I} — {S} {V}',
    // Urgent / raw
    '{V} {I}',
    '{S} {V} right now',
    '{M} — {V} {I}',
    // Reflective
    'I {V} {I}',
    'always {V} {I}',
    '{I} but {S} {V}',
    'before {I}, {S} {V}',
  
    // Additional lines for variety
    "I found the most honest version of myself inside the loudest rooms",
    "The feedback is the feeling — everything else is just decoration",
    "We don't play for the critics — we play for the ones who came to feel it",
    "I have been healed by a guitar chord more times than I can count",
    "The basement show at seventeen was more church than church ever was",
    "Something in the distortion says the thing that words refuse to carry",
    "I am every band that played before me and something new besides",
    "The riff arrived at midnight and I played it until the neighbors complained",
    "This song was born in the worst year of my life and it shows",
    "We were built for the loud and the honest — the rest was always noise",
    "I poured every thing I couldn't say into the bridge of this song",
    "The crowd knows the lyrics better than they know their own address",
    "I have never felt less alone than in the loudest room Ive been in",
    "Rock and roll is just the truth at a volume that demands acknowledgment",
    "Every compromise I didn't make is somewhere inside this guitar tone",
    "The stage is the only place Ive ever been completely unafraid",
    "I write about the dark so the people in it know someone sees them",
    "We are the children of everyone who played too loud and meant it",
    "The song found me — I just showed up with the instrument",
    "Four people in a room trying to make one honest sound",
    "Ive been chasing the feeling of the first time I heard it live",
    "Nothing corporate about what happens when this guitar starts",
    "We built this band on borrowed gear and borrowed time and kept it",
    "The venue smells like sweat and effort and I will miss it every day Im gone",
    "I am not performing — I am converting pain into something shareable",
    "Every scar my body wears is a verse I didn't know how to write yet",
    "The amplifier is the honest friend that the audience deserves",
    "I don't care about the chart position — I care about the room we fill",
    "We play until the monitors feedback because that's where the truth lives",
    "I am the product of every band that showed me the cost of not playing",
    "The guitar was the first thing that ever talked back to me honestly",
    "We are not a brand — we are four people who need to make this sound",
    "Every song Ive written has saved me from something I can't name",
    "The music business tried to polish us — we came back more ourselves",
    "I play like the song is the only way I survive the week — because it is",
    "The drums and bass found each other and the whole room understood",
    "We were reckless in the way that only honest things are reckless",
    "I have never wanted the quiet version of anything in my life",
    "The melody came first and carried the pain the rest of the way out",
    "This is not entertainment — this is emergency communication",
    "Every great rock song was written by someone who had no other option",
    "I will play this song forever because it keeps meaning something new",
    "The road was hard and the shows were real and I wouldn't trade it",
    "We played every small room before we deserved the big one",
    "I remember when the song was just a feeling with no shape yet",
    "There is a version of this music that will outlast every version of me",
    "The power chord is the most democratic statement in all of music",
    "We gave everything every night and the nights gave everything back",
    "I don't write love songs — I write songs about survival that feel like love",
    "The guitar holds what the human voice is too controlled to say",
  
    "I learned everything worth knowing from the songs that made the car shake",
    "The honest song in the wrong room is still the honest song — play it",
    "We don't write for the radio — we write for the person who needs it at midnight",
    "The bridge is where the song stops pretending and says the actual thing",
    "I play harder when the room is small because the room being small is the point",
  ],

  metal: [
    // Commanding / epic
    '{S} {V}',
    '{S} {V} — {M}',
    'the {T} {V}',
    // Battle imagery
    '{V} — {M}',
    'rise — {S} {V}',
    '{S} {V} through the {T}',
    // Mythological
    '{I} — {S} {V}',
    'from the {T}, {S} {V}',
    '{M} — {S} {V}',
    // Power declarations
    'never {V} — {M}',
    '{S} {V} against {T}',
    'we {V} — {M}',
    '{I}: {M}',
  
    "The pit is not violence — it is the body finally speaking its own language",
    "We were the strange kids who became the ones everyone else needed eventually",
    "Heavy music for heavy times — we have never had more material to work with",
    "I found grace inside the heaviest music I have ever heard — go figure that",
    "The mosh pit remembered what the classroom forgot about human community",
    "I have been healed by decibels more than once — science will eventually catch up",
    "Every tuning drop is a decision about the weight this music needs to carry",
    "The distortion is not noise — it is the most honest signal available here",
    "Every blast beat is a conversation with chaos that ends in control",
  ],

  jazz: [
    // Atmospheric / literary
    '{I} — {M}',
    '{S} {V} {I}',
    '{I}, {S} {V}',
    // Wistful / reflective
    '{S} {V}',
    'still {S} {V}',
    'how {S} {V} {I}',
    // Late-night intimacy
    '{M} — {S} {V}',
    'the way {S} {V} {I}',
    'some nights {S} {V}',
    '{I}: {S} {V}',
    'I {V} {I}',
    'one more {T}, {S} {V}',
  
    // Additional lines for variety
    "The trumpet said the thing the room had been avoiding all evening",
    "There's a melody that knows the shape of every heartache Ive had",
    "In the small room at last call the most honest conversations begin",
    "I learned the standards but the standards taught me something back",
    "Every night a different city but the loneliness plays the same tempo",
    "The piano says the thing the lyrics are too disciplined to say",
    "Late night illuminated only by the low amber of the bar lamp",
    "Ive been carrying this feeling since before I had the chord for it",
    "The bassist knows what you're feeling before you've finished the phrase",
    "There's a dignity in the cigarette-smoke sadness of this particular bar",
    "Ive played this ballad in a hundred rooms and meant it every time",
    "The way the rhythm section breathes together — that's the whole education",
    "I played for the old man in the corner who never once looked up",
    "Sometimes the most moving thing is the note you decide not to play",
    "Every musician Ive played with has left something behind in my hands",
    "The chord change at the end of the bridge — that's where the truth lives",
    "I learned to bend the note the way a good sentence bends toward feeling",
    "After forty years I still find something new inside the standard",
    "The accompanist understood the song better than the soloist did",
    "We played it slow because fast was the way out of feeling it",
    "I spent years learning the changes and the changes taught me to listen",
    "The solo is a conversation with everyone who ever played this room",
    "I play from the gut when the head runs out of interesting things to say",
    "Every night I hope to find the version of this that I haven't played before",
    "The room is almost empty and the music is better for the intimacy",
    "I have never played the same song twice even when the notes were the same",
    "The blue notes are the ones that tell the whole biographical truth",
    "There is a generosity in jazz that no other form fully replicates",
    "I learned to hear the space between the notes as the actual music",
    "The standard is the container — what you pour into it is the art",
    "She came in at the second chorus and the room reorganized itself",
    "Ive been chasing that one perfect take since nineteen seventy-three",
    "The rhythm section is the foundation and the soloist is the conversation",
    "In this music the heart is the instrument and the instrument is the heart",
    "I play what I know and what I know is everything this life has given me",
    "The bridge is where the honest musicians go when the verse gets too easy",
    "I have played through grief and joy and most things in between this way",
    "The modal jazz opened a door and Ive been living on the other side",
    "Every improvisation is a conversation with everyone who came before",
    "I followed the melody into a room I'd never been in before and stayed",
    "The drummer counted us in and the whole room agreed on something",
    "I play better when Ive given up trying to play perfectly",
    "Late night is the only honest time in any city for this music",
    "The standard is the shared language — what you say in it is entirely yours",
    "I understood the lyric completely only after I'd played the song a hundred times",
    "There's a blue hour in every city where jazz makes the most sense",
    "The bass line is a conversation with the floor of every room it's ever played",
    "Ive been bending this note since I was twenty-two and Im still finding it",
    "The piano knows the weight of every story Ive carried to the bench",
    "Every night I play I am in conversation with everyone who played before me",
  
    "I understand now what the songwriter meant — it took thirty years to get there",
    "Every standard holds a room full of ghosts who played it before me",
    "The audience that knows when to hold their breath — those are my people",
    "I came back to this song after ten years and it had grown while I was gone",
    "The resonance of a note in an old room is its own kind of accumulated history",
    "I play every note like it might be the one that finally says the whole thing",
  ],

  gospel: [
    // Declarative faith
    '{S} {V}',
    '{S} {V}, {M}',
    'by {T}, {S} {V}',
    // Call and response feel
    'He {V} {I}',
    'every {T} {V}',
    '{I} — {S} {V}',
    // Testimony
    'I know {S} {V}',
    '{M} — {S} {V}',
    'through {T}, {S} {V}',
    // Worship
    '{S} {V} {I}',
    'we {V} {I}',
    'your {T} {V}',
  
    // Additional lines for variety
    "The altar call I answered changed the whole direction of my living",
    "I have seen His hand at work in places where the darkness was absolute",
    "Every morning mercy finds me before I have a reason to deserve it",
    "The congregation sang it back and suddenly I understood the song",
    "I knelt in the last pew and felt something shift that hasn't shifted back",
    "You are the same God who parted every impossible sea before this one",
    "Faith is not the comfortable feeling — faith is the movement through fear",
    "He meets me in the valley with the same grace as on the mountain",
    "I have prayed through the night and watched the morning answer every time",
    "The testimony is the evidence — and my life is the testimony",
    "I will praise before the breakthrough comes because praise is the breakthrough",
    "The Word that spoke the world spoke my name in the same voice",
    "I have been held by a grace larger than the sum of all my failures",
    "Every scar on my body is a miracle wrapped in a hard story",
    "The choir rehearsed Tuesday nights in the church basement for thirty years",
    "My grandmother's prayers are still working on my behalf — I believe that",
    "The spirit fell in the second hour of the service and the whole room knew",
    "I am not the product of my circumstances — I am the product of His promise",
    "Every valley Ive walked through prepared me for the mountain Im standing on",
    "I sang this song in the darkest hour and the darkness heard and left",
    "The grace that found me wasn't looking for someone deserving",
    "His mercies are new every morning whether Im ready for them or not",
    "I have been in rooms where the presence was so thick you could lean into it",
    "The church raised me when the world tried to break me and that is the whole",
    "I bring my doubt and my faith to the same altar — He receives both",
    "The breakthrough doesn't announce itself — you only recognize it after",
    "I sang through my grief until the grief became a different kind of feeling",
    "There is no testimony without the test — I understand that now",
    "Every person who prayed with me when I had nothing is a miracle I owe",
    "The Holy Spirit in the room is not an idea — it's the most present thing",
    "I am not defined by what tried to destroy me — I am defined by who kept me",
    "My faith is not a comfort — it is the most demanding thing I carry",
    "The anointing makes the impossible look like a different kind of possible",
    "I serve a God whose strength is most visible in my weakness",
    "The prayer circle on Tuesday changed the outcome — I have the evidence",
    "I will stand in the fire if He's in the fire because Ive seen this before",
    "Every generation of my family has needed a miracle — every one received one",
    "The praise breaks the chains that the petition couldn't reach",
    "I am not afraid of the storm because I know who walks on water",
    "The sanctuary is wherever Im kneeling — He meets me there every time",
    "My worship is not performance — it's the honest response to being kept alive",
    "I found the peace that passes understanding at the bottom of my hardest year",
    "The revival started with one honest prayer from one broken person — that's enough",
    "He didn't promise the storm wouldn't come — He promised to be in it with me",
    "The hymn they sang when I was five is still the one that reaches me deepest",
    "Every season of my life has confirmed what the first season tried to teach me",
    "I bring what I have to the altar — He multiplies it every time",
    "Faith is the substance of the things Im still waiting to see",
    "The testimony of God's faithfulness is the inheritance I leave my children",
    "I am living proof that the God of the impossible is still in operation",
  
    "Something lifted in that service and everyone in the room felt it go",
    "I have never praised my way through a season and come out worse — never once",
    "The God who sees sparrows saw me in my smallest and most hidden moment",
  ],

  reggae: [
    // Conscious / rootsical
    '{S} {V}',
    '{S} {V}, {M}',
    '{I} — {M}',
    // Jah-positive
    'jah {V} {I}',
    '{I}, {S} {V}',
    'every {T} {V}',
    // Community call
    'rise up — {S} {V}',
    'my people {V} {I}',
    '{M} — {S} {V}',
    // Narrative
    '{S} {V} {I}',
    'in the {T}, {S} {V}',
    'roots {V} — {M}',
  
    // Additional lines for variety
    "The drum was here before the word and it will carry truth after words are gone",
    "We are the sons and daughters of a people who survived everything",
    "The one-drop rhythm is the heartbeat of the whole conscious tradition",
    "Jah love is not philosophy — it is the daily practice of how I move",
    "Every generation is called to keep the truth alive for the next",
    "The bass line carries the weight of the whole culture on its shoulders",
    "I was raised in a yard where the riddim was the first language of feeling",
    "Positive vibration is not optimism — it is resistance to every lie",
    "The roots run deep enough that no storm has ever fully pulled them loose",
    "We don't forget where we came from — that memory is protection",
    "The reggae is the language my grandmother used to reach me across distance",
    "Jah music is the medicine and the world is sick enough to need the full dose",
    "I carry the island in my chest wherever the road has taken me",
    "The consciousness of the culture is older than the names they gave it",
    "Every conscious artist is a griot in the tradition of the long memory",
    "We were taught to sing the truth even when the truth was dangerous",
    "The riddim is the covenant between the living and the ones who passed it on",
    "Rise up — not in anger but in the knowledge of what you're rising toward",
    "The one-love doctrine is not naive — it is the most radical position possible",
    "I sing because silence in the face of injustice is its own kind of violence",
    "The music was always the underground railroad of consciousness",
    "Zion is not a place on any map — it is the state of righteous living",
    "We are from a tradition that refused to let oppression have the last word",
    "The roots music is the system's worst fear — people who know who they are",
    "Jah guidance is the only compass that has never led me wrong",
    "The culture survived because the music carried the culture through",
    "I learned to love myself by learning the history that was kept from me",
    "The revolution is the consciousness — everything else is the consequence",
    "We play this music for the ones who need a language for their dignity",
    "Every conscious lyric is a letter to the next generation from the current one",
    "The peace I seek is not passive — it is the result of knowing what to fight for",
    "I was born into a tradition of resistance and I take that inheritance seriously",
    "The sound system is the people's parliament — the selector is the speaker",
    "Every people with drums has a frequency that was never colonized",
    "We give thanks because gratitude is the opposite of the poverty mindset",
    "The rasta philosophy kept me from accepting what was always a lie",
    "I heard the nyahbinghi drum for the first time and I was already home",
    "The music says what the movement couldn't always say in public",
    "We are connected to an Africa that exists in the blood and in the song",
    "I don't need the validation of the system Im singing about the problem with",
    "The one-drop is the rhythm of walking in truth through an untruthful world",
    "Every island has a rhythm specific to its particular grief and joy",
    "I carry my grandfather's wisdom in the form of everything he sang",
    "The culture is the weapon and the culture is the medicine simultaneously",
    "We sing until the walls come down because the walls always come down eventually",
    "I found my freedom in understanding that I was always already free",
    "The conscious music is the long conversation between the oppressed and the truth",
    "Give thanks and praises every morning — that is the full spiritual practice",
    "The people's music is always the music the powerful most want silenced",
    "I learned to love life by learning to love the life of my people first",
  
    "The drum does not forget what the history books decided to omit",
    "Every generation of musicians extends the conversation one step further",
    "I hold the culture with both hands because both hands are required for it",
    "The song carries the people when the people have nothing else to carry them",
    "We built a music from the specific materials of our particular survival",
    "The rhythm is the one inheritance no empire has ever successfully confiscated",
    "I play for the ones who need to hear that they are not alone in this",
  ],

  folk: [
    // Story / image first
    '{I}, {S} {V}',
    '{I} — {M}',
    '{S} {V} {I}',
    // Plain truth
    '{S} {V}',
    '{M} — {S} {V}',
    // Nostalgic / memory
    'I remember {I}',
    'back when {S} {V}',
    '{T} {V} {I}',
    // Seasonal / place
    'in the {T}, {S} {V}',
    'the old {T} {V}',
    'somewhere {S} {V}',
    '{S} {V} all the same',
  
    // Additional lines for variety
    "I have been carrying a photograph of a house I'll never see again",
    "The guitar went silent when he died and I taught myself to play his songs",
    "There's a particular quality to grief that only shows in the third year",
    "I left the city looking for something and found it was here all along",
    "The old songs know the things the new ones are still learning",
    "I sang this at his graveside and finally understood what it meant",
    "The tradition is the conversation between every person who ever held this form",
    "I learned to listen to the land before I tried to write about it",
    "Every verse Ive written came from something I witnessed first",
    "The honest song is the rarest thing — and the most durable",
    "I follow the folk tradition because the folk tradition follows the truth",
    "She taught me three chords and the philosophy was the guitar itself",
    "Ive been playing these songs in kitchens more than concert halls and prefer it",
    "The song travels further than the singer — that is the whole plan",
    "I inherited the form and tried to fill it with something earned",
    "Every generation needs the songs that tell it where it's standing",
    "The acoustic guitar is the most democratic instrument in all of music",
    "I write about ordinary people because extraordinary people already have enough songs",
    "The folk song is the oral history that survived when the written one didn't",
    "I learned this verse from someone who learned it from someone who witnessed it",
    "The circle song continues as long as there are people willing to carry it forward",
    "I have played for rooms of five and the rooms of five were always the best ones",
    "The song that moves you in a small room is the song that always mattered most",
    "I write to remember things that would otherwise be lost by the next generation",
    "The protest song is the folk song that noticed the right enemy",
    "I learned the tune from the radio in 1974 and the meaning from living after",
    "The storytelling tradition is older than literacy and more trustworthy",
    "I am the fourth person to play this guitar and the wood remembers all of us",
    "The bridge of the song is where the songwriter finally tells the truth",
    "I play fingerstyle because it's the most honest conversation between hands and strings",
    "Every work song ever written was written by someone tired and still going",
    "The simplest lyric is usually the one that took the longest to find",
    "I have met my best audience in the smallest rooms and the quietest moments",
    "The traditional song is not old — it is timeless, which is different",
    "I play it slow because slowness is how you hear the whole thing",
    "The song is the map of the emotional journey — not the destination",
    "I write about loss because loss is the common language of the living",
    "The folk revival was people remembering that truth was always in the music",
    "I trust the song more than I trust myself — the song knows where it's going",
    "Every line I write is trying to be worthy of what it's about",
    "The guitar tells me when the lyric is wrong — it just stops feeling right",
    "I play these songs in the order of their necessity — not their chronology",
    "A song for the workers, a song for the grieving, a song for the stubborn ones",
    "I learned to write by listening to the songs that survived everything",
    "The ballad is the documentary form that predated the camera",
    "I am carrying forward a tradition that carried the people who carried me",
    "The chorus is the thing worth saying twice — that is its whole instruction",
    "I sing the same songs differently now that Ive lived enough to mean them",
    "The folk song asks nothing of you except your honest attention",
    "I play this song because every time I do, someone in the room exhales",
  
    "This form was here before me and will carry someone else's truth after",
    "The best verse comes from where observation meets feeling and holds still",
    "I found the melody first and built the story into the space it left open",
    "Every song Ive written started as a question I was too afraid to ask",
    "The tradition asks you to tell the truth and tell it plainly — I try",
    "Some songs want to be sung in the dark without anyone watching at all",
  ],

  punk: [
    // Short punchy / aggressive
    '{S} {V}',
    '{V} — now',
    'no {T} — {S} {V}',
    // Anti-establishment
    'they {V} {I}',
    'we {V} — {M}',
    '{S} {V}, no permission',
    // Raw energy
    '{V} {I}',
    '{M} — {V}',
    'I {V} {I}',
    // Youth / defiance
    'never {V} — never',
    '{S} {V} right now',
    'watch {S} {V}',
  
    // Additional lines for variety
    "The first show I played was in a basement and it was the best show of my life",
    "We don't need your production budget — we need your honest attention",
    "The three-chord song is the most efficient delivery system for truth ever invented",
    "I found my people in the loudest room before I found them anywhere else",
    "No genre polices itself harder than punk about what counts as punk",
    "The DIY ethic is not a poverty workaround — it is an ideological position",
    "We play fast because slow is how you give the establishment time to respond",
    "The mosh pit is the most democratic physical space in all of live music",
    "I make music that costs nothing to make and everything to mean",
    "The zine was the blog before the internet — the internet is the zine now",
    "Every punk band starts because something made someone angry enough",
    "The chorus is the place where everyone in the room becomes one person",
    "I wear my influences on my jacket and my politics in my lyrics",
    "The record label system was invented to do exactly what it does — avoid it",
    "We were never trying to be famous — we were trying to be heard by the right people",
    "The feedback loop is the honest conversation between the amp and the room",
    "I learned more about myself in three minutes of a Buzzcocks song than in years",
    "The punk scene gave me a community before any institution ever did",
    "Every safety pin is a statement about what kind of decoration matters",
    "The stage is level with the floor because the performer is not above the audience",
    "I don't write anthems — I write arguments that happen to be singable",
    "The spirit of punk is the refusal to accept the terms of the default negotiation",
    "We tour in a van because the experience is the whole point",
    "The energy in the room when everyone knows the words is indescribable",
    "I want every song to feel like it was written the day before it needed to exist",
    "The scene is the family you build when the one you were born into doesn't fit",
    "We play for the kids in the back who came looking for a reason to stay",
    "The two-minute song is a philosophical position about what deserves time",
    "I measure success in converted people, not in chart positions",
    "The amps are cranked because the truth is a loud thing when you finally say it",
    "Punk gave permission to everyone who didn't know they were allowed to make art",
    "The venue capacity doesn't matter if every person in it is completely present",
    "Ive been writing protest songs because the protest isn't over",
    "The chord progression is borrowed — the conviction is original",
    "We play until the set is done or the power goes out — whichever",
    "The label wanted us to soften the edge — we found a different label",
    "I learned from the Clash that political music can also be the best music",
    "Every show is a temporary autonomous zone — look it up",
    "The kids at the front are the reason the genre survives every decade",
    "I play guitar like Im arguing — because that's what playing guitar is for",
    "The band broke up and got back together because the music was still there",
    "We are louder than our influences because we have more to be angry about",
    "The honest song in the wrong room is still the honest song",
    "I learned to scream before I learned to sing and that is the correct order",
    "The audience becomes the band when they know all the words",
    "Every punk record is a time capsule of a specific outrage at a specific moment",
    "I play this fast because slow means I have to sit with the feeling longer",
    "The hardcore kids kept the flame burning every decade between the peaks",
    "We are not nostalgic for punk — we are actively continuing it",
    "The scene is not dead — it's just in a different basement this decade",
  
    "I came to punk because I needed somewhere to put the anger and the love together",
    "Hardcore kept the flame alive through every decade between the visible peaks",
    "The scene is not dead — it's in a different basement in a different decade now",
    "We are not nostalgic for punk — we are actively continuing it right now today",
    "I play guitar like Im arguing — because for me that's exactly what it's always for",
    "The audience becomes the band completely when they know every word of it",
    "Every punk record is a time capsule of a specific outrage at a specific moment",
    "I play fast because slow means sitting with the feeling considerably longer",
  ],

  kpop: [
    // Melodic / emotional
    '{S} {V}',
    '{S} {V}, {M}',
    'you and I {V}',
    // Energetic / anthem
    'we {V} {I}',
    '{I} — {S} {V}',
    'together {S} {V}',
    // Dreamy / romantic
    '{M} — {S} {V}',
    'I {V} {I}',
    'every {T} {V}',
    // Performance energy
    '{S} {V} — {M}',
    'shining {S} {V}',
    '{I}, {S} {V}',
  
    // Additional lines for variety
    "I gave up everything ordinary to stand in this particular light",
    "The practice room taught me things about myself I couldn't have learned anywhere",
    "You became the reason the hard years feel like they were worth every hour",
    "I memorized the choreography until my body knew it better than my mind did",
    "Every performance is a promise I make to everyone who waited for this",
    "The trainee years are the secret history that the stage career is built on",
    "I want to be someone who earns the stage every single time I step onto it",
    "We are not a product — we are people who chose to pour ourselves into this",
    "The spotlight found me before I was ready and I decided to be ready",
    "You traveled ten thousand miles to stand in the front row — I see you",
    "The choreography is the emotion made legible to a room of twenty thousand",
    "I became myself in public and asked everyone to witness it",
    "The second album is where the artist emerges from the trainee",
    "I want the fans to hear the real person underneath the production",
    "The debut was the beginning of the work — not the completion of it",
    "We built this together and the together is the whole point of it",
    "Ive been performing version 2.0 of myself for so long I forgot which came first",
    "The world tour taught me that longing looks the same in every language",
    "Every encore is an act of faith between the audience and the performer",
    "I wrote this during the tour and the jet lag is in every note",
    "The industry tried to make me smaller and I used the resistance as material",
    "You know the choreography by heart and that changes how the show feels",
    "I look for you in the crowd at every single show — I always find you",
    "The idol image is the invitation — the music is the real introduction",
    "I want to make music that works without the performance attached to it",
    "The harmony we found in the practice room is the one we bring to every stage",
    "I have been shaped by millions of people watching and still became more myself",
    "The global reach of this music is the proof that feeling has no borders",
    "Every difficult year I had before debut is now a lyric in the second album",
    "The fans became the compass that pointed me back to why I started",
    "I perform with everything I have because you came with everything you have",
    "The music video is the dream version — the concert is the real one",
    "I am not the character in the concept — I am the person who plays him",
    "Every song I release is a version of myself Im ready to be accountable for",
    "The success was the result of ten thousand unremarkable practice hours",
    "I want the music to mean something after the choreography stops",
    "We are a group because alone none of us would be this — together we are all of it",
    "The stage fright never goes away — it becomes the fuel instead",
    "I write the melodies I needed to hear at the loneliest point of my journey",
    "You sing my lyrics back to me and I understand them for the first time",
    "The idol system is a machine — we are the people who run it from the inside",
    "I became an idol to prove that the person from where Im from can",
    "The global stage means the same song reaches people I'll never meet",
    "I want to use the platform to say something true before the window closes",
    "Every unreleased demo is a version of myself I was too scared to show",
    "The comeback is the artist's way of saying Im still becoming",
    "I found my voice by trying to copy the ones I loved until mine emerged",
    "The audience gives me energy I could never manufacture on my own",
    "This music saved me before I became the person who makes it",
    "I want every fan to feel seen in a way the world hasn't always seen them",
  
    "We are proof that something this good can actually be made to last",
    "I bring my whole self to every stage because anything less would be a lie",
    "The practice room failures were the actual curriculum — the stage is the exam",
    "I wrote this for the version of you that needs to hear you're not alone tonight",
    "The fan letter that arrived in the darkest stretch of tour saved something in me",
    "The global audience taught me that joy is the most universal available language",
    "I want every person in this arena to leave feeling like someone finally saw them",
    "From the basement studio to the sold-out venue — I remember every single step",
    "The real version of this story is considerably more ordinary and I love it",
  ],

  electronic: [
    // Transcendent / atmospheric
    '{S} {V}',
    '{I} — {M}',
    '{S} {V} {I}',
    // Drop / energy build
    'the {T} {V}',
    '{M} — {S} {V}',
    '{I}: {M}',
    // Hypnotic / repetitive feel
    '{S} {V} — {V}',
    'lost in {T}, {S} {V}',
    'feel {S} {V} {I}',
    // Euphoric
    'we {V} {I}',
    '{S} {V} forever',
    '{I} — {S} {V}',
  
    // Additional lines for variety
    "The arpeggio at midnight speaks a language I learned by living inside it",
    "I built the frequency I couldn't find and lived inside it for a year",
    "The modular patch connects the signal to the thing that is most real",
    "In the frequency between the notes is where the personal becomes universal",
    "The analog warmth of the machine is the warmth of a specific human longing",
    "I found the sound that was missing in everything I'd heard before this",
    "The synthesizer is the most expressive instrument since the human voice",
    "Late at night the city becomes a rhythm section behind the music Im making",
    "Every waveform is a decision and every decision is a philosophical position",
    "The drop is the moment that the buildup was always trying to justify",
    "I process my emotions through the filter and the filter tells the truth",
    "There is a mathematics to the music that doesn't diminish its feeling",
    "The bassline is the root system of the whole sonic architecture",
    "I play the same patch differently every night because the night is different",
    "The sidechain compression is breathing — in the mechanical there is life",
    "Every sample holds the ghost of the moment it was recorded in",
    "The four-on-the-floor is the democratization of the transcendent experience",
    "I want to make the music that exists in the space just before language",
    "The oscillator is the voice before the voice has learned what it wants to say",
    "In the digital darkness at the end of the terminal session there is a chord",
    "The rave was the place where the walls between people dissolved temporarily",
    "I found community in the shared surrender to a sound that chose us",
    "The controller is the extension of the intention through the machine",
    "I have spent years learning to subtract until only the essential remained",
    "The kick drum is the heartbeat of a species that learned to move together",
    "Every night I play is a conversation between the living and their machines",
    "The texture of the pad is the texture of the feeling that brought me here",
    "I compress the dynamic range and the music becomes the room it's played in",
    "The sequence loops and inside the loop there is infinite variation",
    "I follow the signal wherever it takes me — that is the full philosophy",
    "The resonant filter is the instrument of emotional specificity",
    "Every element I add serves the silence that surrounds it",
    "The music doesn't ask for understanding — it asks for surrender",
    "I learned to hear the music in the noise before I learned to make it",
    "The generative system creates music that teaches me what I was feeling",
    "Every gig Ive played has been a conversation about what connection means",
    "The reverb is the room and the room is the relationship",
    "I make music for the 3am person who needs the feeling to be named",
    "The modulation is the feeling that the static note cannot contain",
    "Electronic music is the latest form of the oldest human activity — making sound",
    "I turn the knob and the machine responds and the room becomes different",
    "The bass frequencies are felt before theyre heard — that's where I start",
    "Every note I choose not to play is as deliberate as every note I do",
    "The club was the first place I felt the music was a collective experience",
    "I built this track over three years and it still sounds like it was found",
    "The feedback loop is the conversation between the instrument and the room",
    "I process sound the way a painter processes light — looking for the essence",
    "The algorithm is a collaborator with different preferences than my own",
    "In the silence between the tracks the whole concert breathes together",
    "The synthesizer synthesizes not just sound but emotional data into frequency",
  
    "I found a chord that opened a door and have been living in that room since",
    "The sidechain is breathing — in the mechanical there is organic life after all",
    "Every set is a journey with a beginning, a middle, and an honest ending",
    "The stage is a conversation and the dance floor is the full and complete reply",
    "I make music for the moments when words have genuinely all the way run out",
    "The sub bass is felt in the chest before it's registered in the ears at all",
    "Every element in a mix is in a relationship with every other element here",
    "I learned to trust the process when the process started trusting me back",
  ],

  indie: [
    // Specific / literary
    '{I}, {S} {V}',
    '{S} {V} {I}',
    '{I} — {M}',
    // Introspective
    '{S} {V}',
    'still {S} {V}',
    'I {V} {I}',
    // Understated / bittersweet
    '{M} — {S} {V}',
    'the way {S} {V}',
    'quietly {S} {V}',
    '{S} {V} — {M}',
    'maybe {S} {V} {I}',
  
    // Additional lines for variety
    "There's a particular Tuesday Ive been living inside for three years now",
    "I kept the grocery list you wrote — your handwriting is the most you thing",
    "The apartment we shared exists now only in the specific objects I kept",
    "I think about that afternoon in September more than is probably healthy",
    "Something in the light at four o'clock in October still undoes me",
    "You were the footnote that became the whole argument",
    "I have been returning to one conversation for the better part of a decade",
    "The ordinary is where everything that matters actually happens",
    "I know the exact playlist that was on when it became irreversible",
    "There are feelings that only exist in the presence of very specific light",
    "I have been most honest in the unremarkable middle of things",
    "You are the detail I remember when Ive forgotten everything surrounding it",
    "Some things stay specific even when the context disappears entirely",
    "I am made of every apartment Ive ever left a piece of myself in",
    "The song came on and suddenly I was that version of myself again",
    "We were better in the small moments than we ever were in the grand ones",
    "I keep the physical evidence of things Im supposed to have moved on from",
    "You are not a metaphor — you are a specific person in a specific chair",
    "The feeling lives in the particular — not the general — always",
    "I have been most moved by the things that happened between the events",
    "There's a word in another language for exactly what I felt — not this one",
    "The ache is not for you specifically — it's for the version of me you knew",
    "Ive been cataloguing the small things since before I knew why",
    "Something about the way autumn arrives still feels like a beginning",
    "The record plays and the apartment smells like it did then",
    "I loved you the way you love a place that is also a feeling",
    "I am most myself in the hour before anyone else wakes up",
    "You are in every coffeeshop song that has ever made me feel understood",
    "The specific weight of a Tuesday in November is underrated",
    "I wrote this in the margin of something I was supposed to be reading",
    "We were in love the way people are when they don't know theyre in love yet",
    "I miss the version of you I knew before either of us became so careful",
    "The city looks the same but I see a completely different city now",
    "I have been writing the same feeling differently for the past five years",
    "You are the reason certain songs still function as a time machine",
    "I found a ticket stub in a jacket pocket and lost the whole afternoon",
    "Something about the quality of the light at the end of autumn",
    "We were good at the kind of quiet that other people find uncomfortable",
    "I know the exact temperature of the room where everything changed",
    "There is an accuracy to the specific that the universal can never match",
    "I have loved things the way you love things when you know theyre ending",
    "The feeling arrives without permission and leaves on its own schedule",
    "I think about that afternoon more than I think about most whole years",
    "You exist in my apartment in the shape of the space where you used to sit",
    "Some albums work like a compass — they point back to who you were",
    "I wrote seventeen drafts of this and the first one was the most honest",
    "The bittersweet is the richest flavor — Ive always suspected this",
    "You are in the margin of every notebook from that particular year",
    "Ive been keeping the receipts of ordinary moments — theyre the real ones",
    "Some things become more meaningful the longer you don't talk about them",
  
    "I found you in the footnotes of a year I was trying to get through",
    "You became essential so quietly I didn't notice the dependency forming",
  ],

  latin: [
    // Passionate / rhythmic
    '{S} {V}',
    '{S} {V} — {M}',
    '{I} — {S} {V}',
    // Romantic / celebratory
    'mi {T} {V}',
    '{M} — {S} {V}',
    'dale — {S} {V}',
    // Dance energy
    'we {V} {I}',
    'every {T} {V}',
    '{S} {V} toda la noche',
    '{I}, {S} {V}',
  
    // Additional lines for variety
    "The clave is the oldest rhythm — everything else is commentary",
    "I carry the Caribbean in my blood and it comes out in how I move",
    "The dembow beat is the conversation between generations of a whole culture",
    "My abuela danced son cubano in the kitchen every Saturday of her life",
    "The brass section is the sound of a celebration that has survived everything",
    "The cumbia is the rhythm of a people who refused to let the colonizer take it",
    "I grew up in a house where the music was always the medicine",
    "The salsa is a conversation in the key of joy between partners",
    "I am from the island and the island is from me — we are not separable",
    "The reggaeton drops and the whole city remembers what it is",
    "Every Latin rhythm is a history of survival encoded in the percussion",
    "My father played the tres and the sound was the whole autobiography",
    "The barrio gave me the rhythm — I gave the rhythm back to the barrio",
    "We dance because we were told we couldn't — that was always the invitation",
    "The percussion is the communication between the living and the ancestors",
    "I want to make the music that makes strangers into the same person briefly",
    "The Latin diaspora is a continent of feeling in search of a shared language",
    "Every love song in Spanish is also a geography lesson",
    "I sing in the language of my grandmother because nothing else goes deep enough",
    "The montuno is the engine of the whole salsa form — the rest is decoration",
    "We celebrate because celebration is the political act the oppressor fears most",
    "The timbales announce the arrival of something that demands your attention",
    "My culture is not a costume — it is the marrow of every choice I make",
    "The late night Latin club is the last honest democracy in any city",
    "I learned to sing before I learned to speak — the music came first",
    "The guaracha is the form that turns complaint into irresistible rhythm",
    "We make the music that the system tried to keep in its proper place",
    "The bass in reggaeton is the spine of the whole culture's self-expression",
    "My name is a whole sentence in the language of the people I come from",
    "The partido alto is the rhythmic philosophy of the African diaspora",
    "I take the tradition seriously because the tradition took people seriously first",
    "The melodica is the most melancholy of Caribbean instruments — I love it most",
    "Every bolero ever written was written about the same specific person",
    "The salsa singer earns the right to improvise through the verse first",
    "I am from a culture that turns grief into something you can dance to",
    "The congas are talking — they've been talking for five hundred years",
    "My culture survived the middle passage — it can survive the algorithm",
    "The son montuno is the root of a tree that has grown across the whole world",
    "I bring the rhythm of my people into every room I enter as the gift",
    "The Latin pop is the crossroads where the tradition meets the future",
    "We have always been bilingual — in the language and in the feeling",
    "The gaita is the sound of the sierra — I carry it to every lowland city",
    "Every generation has the obligation to make the tradition dangerous again",
    "The dance is the argument for life that needs no translation",
    "I make the music that makes the homesick feel found",
    "The vallenato is the form that turns the whole biography into a song",
    "We are the music and the music is the document of our survival",
    "The brass hits and everyone in the room understands something simultaneously",
    "I want my music to be the sound of the culture that shaped me fully heard",
    "The percussion section is the whole philosophy of community expressed rhythmically",
  
    "The sound system is the instrument and the neighborhood is the concert hall",
    "We make this music together because together is the only way it works at all",
    "From the coast to the mountain to the city — the clave has never changed",
    "I bring the rhythm of my people into every room I enter as an offering",
    "The bomba and the plena and the cumbia — all saying the same essential thing",
    "We were told our music was too loud and we turned it up in direct response",
    "The guiro scrapes time itself into something you can physically feel move",
    "Every instrument in this ensemble is a voice from a different part of the story",
    "I learned that the best musicians listen more than they play — that's everything",
  ],

  phonk: [
    // Cold / menacing
    '{S} {V}',
    '{S} {V} — {M}',
    '{I} — {M}',
    // Dominant
    '{M} — {S} {V}',
    'watch {S} {V}',
    'the {T} {V}',
    // Speed / drift
    '{S} {V} {I}',
    'cold {S} {V}',
    'deep in {T}, {S} {V}',
    '{V} — {M}',
  
    // Additional lines for variety
    "The slowed reverb is the aesthetic of a memory you can't shake loose",
    "I move through the city at 3am when the city is most honestly itself",
    "Cold production for cold emotions — the temperature is a design choice",
    "The Memphis underground kept the realest sound alive through every decade",
    "I make music for the late-night drive that nobody knows you're taking",
    "The cowbell hit is the metronome of a different kind of menace",
    "Every drift is a metaphor for the controlled loss of traction on purpose",
    "The phonk aesthetic is the dark web of music — not for everyone",
    "I sample the dead because the dead understood something we forgot",
    "The slowed-down vocal is the ghost in the machine confessing",
    "Nobody phonk harder than the ones who came from where I came from",
    "The 808 in the dark is the sound of intention without explanation",
    "I produce in the hours when the productive people have all gone to sleep",
    "The old Memphis sound was the original phonk and it was dangerous for a reason",
    "The cowbell and the 808 are the two instruments of the current dark era",
    "I make the music that plays in the background of the heist that goes perfectly",
    "The reverb on the vocal is the distance between the feeling and its expression",
    "Every phonk track is a night drive with no destination and perfect energy",
    "The lo-fi texture is not laziness — it is the correct emotional resolution",
    "I dig for samples in the places other producers don't know to look",
    "The bass in phonk is slower than your heartbeat and that is the whole secret",
    "Three AM and the only light is the monitor glow and the sample rack",
    "The genre emerged from the underground because the underground needed a sound",
    "I produce music that sounds like it was found, not made",
    "The trap hi-hat at half speed is the sound of deliberate patience",
    "Every phonk producer is a historian of a very specific kind of darkness",
    "The sample flip is the art form — finding the hidden life in the original",
    "I make music that plays loud in the empty parking lot at 2am",
    "The distorted 808 is the instrument of a generation that grew up on bass",
    "The aesthetic is the argument and the argument is the aesthetic here",
    "I choose sounds the way other people choose words — for their exact weight",
    "The phonk scene is the underground keeping the underground honest",
    "Every track I make is a letter to the person driving somewhere alone tonight",
    "The vinyl crackle is not nostalgia — it is the warmth that digital forgot",
    "I slow the sample down until it reveals the emotion buried in the original",
    "The grimiest production is often the most honest emotional document",
    "Cowbell patterns are the morse code of the Memphis underground tradition",
    "I make music that sounds like the feeling you can't explain to anyone sober",
    "The reverb tail is longer than the note itself and that tells the whole story",
    "Every distortion is a decision about how honest Im willing to be sonically",
    "The phonk is not a genre — it is a philosophical position on sound design",
    "I produce at the intersection of menace and melancholy and live there",
    "The chopped and screwed tradition is the origin of every slowed aesthetic",
    "I make the music that other music producers tell you to avoid making",
    "The sample is a resurrection — bringing back the feeling the original buried",
    "Every bass hit in phonk is a statement about what seriousness sounds like",
    "The underground stays underground because the mainstream can't metabolize it",
    "I tune the 808 to the minor key because that's where the truth lives",
    "The phonk producer is the archaeologist of the cassette tape era",
    "Make it cold, make it deliberate, make it undeniable — that's the whole brief",
  
    "I tune the 808 to the minor key because that's where the truth consistently lives",
    "Make it cold, make it deliberate, make it undeniable — that is the full brief",
    "The chopped and screwed tradition is the deep root of every slowed aesthetic",
    "I make the music that other producers actually tell you to avoid making entirely",
    "The sample is a resurrection — bringing back the feeling the original buried deep",
    "Every bass hit is a statement about what genuine seriousness actually sounds like",
    "The underground stays underground because the mainstream simply cannot metabolize it",
    "I process grief through lo-fi filters and the result is more honest than therapy",
    "The city at three AM is the most accurate mirror I have ever looked into",
    "Every track I finish is a letter I didn't know how to send any other way",
    "The slowed vocal is not sadness — it is sadness given the correct amount of time",
  ],

  drill: [
    // Street realism
    '{S} {V}',
    '{S} {V} — {M}',
    'on the {T}, {S} {V}',
    // Cold delivery
    '{M} — {S} {V}',
    'real {T} — {S} {V}',
    'watch {S} {V}',
    // Unflinching
    '{S} {V}, say less',
    '{I} — {S} {V}',
    'every {T} {V}',
    '{V} — facts',
  
    // Additional lines for variety
    "Moved through the system that was built to produce my failure — still moving",
    "The drill beat is the architecture of a specific kind of urban survival",
    "Every bar is a piece of evidence from the place that shaped me",
    "The sliding 808 is the sound of a generation that learned to adapt everything",
    "I speak for the estate in the rooms the estate was never invited into",
    "The cold delivery is not affect — it is the emotional temperature of experience",
    "I came from the block that the city pretends doesn't exist until it has to",
    "Every feature I do I bring the whole postcode with me — that's the deal",
    "The hi-hat pattern is the rhythm of a city that never fully stops being tense",
    "I earned the right to speak on this — the receipts are the verses themselves",
    "The dark piano is the melody of the specific London melancholy",
    "I recorded this in the studio at midnight when the feeling was right",
    "Every bar I write I write for the ones who don't have a platform for this",
    "The block raised me to be exactly what the block needs right now",
    "I keep it real because keeping it real is the only thing that holds",
    "The UK drill sound is the sound of a specific generational frustration",
    "I moved from the estate to the arena — the estate is in every song",
    "Every rapper from ends knows that the music is also documentation",
    "The cold energy in the track is the emotional temperature of real experience",
    "I don't perform the struggle — I report it from the inside",
    "The hook is catchy because pain that's catchy gets heard by more people",
    "I write the verses and the verses write back with what I didn't know I knew",
    "The grime scene and the drill scene are different accents of the same truth",
    "Every drill track is the autobiography of a generation doing the math",
    "I know the studio is a privilege because I know what came before it",
    "The night shift at the ends is the origin of every bar in this discography",
    "I earned the right to be in this room by never pretending to be from somewhere else",
    "The dark production is the mirror of the emotional reality it documents",
    "Every sliding note in the 808 is the sound of constant readjustment",
    "I built this career without the connections that most careers are built on",
    "The drill format is the vessel for the most contemporary kind of honesty",
    "I speak plainly because plain speech is what the music requires here",
    "The city that shaped me is in every syllable of every verse Ive ever touched",
    "I came from the stats that nobody quotes when they talk about success",
    "The music is the way out — I know because I watched it be the way out",
    "Every lyric I write is the primary source material for this particular history",
    "The flow adapts because the circumstances demand constant adaptation",
    "I don't explain the slang — the slang is the identity and that's the point",
    "The estate is not the backdrop of the story — the estate is the protagonist",
    "I make music that the block recognizes because the block made me first",
    "Every bar I drop is for the ones who thought they'd never hear themselves in music",
    "The drill is the documentation — every lyric is the primary record",
    "I came from nothing and built something and Im still building it",
    "The beat is cold because the environment requires a specific kind of composure",
    "I don't cap about where Im from — it's the only credential that matters",
    "Every show I do I remember the shows I couldn't afford to get into",
    "The music business tried to understand us — we just kept making the music",
    "I am the sum of every experience the system tried to make into a limitation",
    "The UK drill sound is the sound of a generation that won't be invisible",
    "Every verse I write is the answer to someone who said this wasn't possible",
  
    "I walk into every room as the sum of every room I was kept out of before",
    "Every verse I write is the answer to someone who said this wasn't possible",
    "The UK drill sound is a whole generation refusing to be invisible to anyone",
    "I am the sum of every experience the system tried to make into a limitation",
    "The music business tried to understand us — we just kept making the music",
    "I don't cap about where Im from — it's the only credential that matters here",
    "Every show I do I remember the shows I couldn't afford to get into",
    "I came from the stats that nobody quotes when they talk about success",
    "The beat is cold because the environment requires a very specific composure",
  ],

  default: [
    '{S} {V}',
    '{S} {V}, {M}',
    '{I} — {M}',
    '{I}, {S} {V}',
    '{S} {V} {I}',
    '{S} {V} — {M}',
    '{I} — {S} {V}',
    'every {T} {V}',
    '{M} — {S} {V}',
    'always {V} {I}',
    '{I} but {S} {V}',
    'before {I}, {S} {V}',
    'I {V} {I}',
  
    // Additional lines for variety
    "Ive been carrying the weight of who I used to be for longer than I should",
    "There's a version of this story where I made the call I needed to make",
    "Every road Ive taken has been teaching me the same thing differently",
    "I have been the problem and the solution and the lesson in between",
    "The light comes back eventually — it always has and I believe it will",
    "I stood at the crossroads of the person I was then and chose the harder path",
    "Some things take a whole life to become the thing they actually are",
    "There are no shortcuts to the honest version of yourself — trust me",
    "I asked the road for easy and the road gave me the true instead",
    "All the things I thought were setbacks were the necessary architecture",
    "What I know now I couldn't have known without the cost of learning it",
    "I am every mile Ive traveled and every door I had to knock on",
    "The hardest thing I ever did was keep going when keeping going looked wrong",
    "Somewhere in the distance between who I was and who Im becoming",
    "The only version of this story that holds is the one I stopped lying in",
    "I have been most honest in the moments I was too tired to pretend",
    "Every season Ive survived has left me different — not better, not worse, true",
    "The turning point rarely announces itself — you see it only in the rearview",
    "I keep coming back to the same realization dressed in different clothes",
    "The work was always the answer — I just kept asking the question",
    "Something shifted and I was different on the other side — that's the whole story",
    "I am built from every version of myself that I had to walk away from",
    "The honest thing and the easy thing have rarely been the same thing for me",
    "Ive learned to sit inside the uncertainty until it teaches me what it knows",
    "Every question Ive avoided has eventually found me in a quieter room",
    "I stopped performing for the audience in my head and started living",
    "The version of me I want to be is always just past the version Im afraid to be",
    "I carry gratitude for the hard years now that I can see what they made",
    "Some truths are only available on the other side of the difficult thing",
    "I have been the author of my own confusion and the only one who can rewrite it",
    "The journey inward is longer and stranger than any road Ive ever traveled",
    "Every broken thing Ive carried eventually showed me its purpose",
    "I stopped waiting for permission to become the thing I was already becoming",
    "The most important decisions Ive made happened in the quietest moments",
    "I trust the process now because Ive seen the process deliver on its promises",
    "Every door that closed was making space for a door that hadn't been built yet",
    "The people who shaped me most were not the ones who made it easiest",
    "I am becoming something I could not have planned and am grateful for",
    "The life I have is not the life I imagined — it is better and more honest",
    "Every moment of doubt Ive survived has confirmed something I needed confirmed",
    "I learn the most about myself in the seasons I didn't choose",
    "The version of success that fits me is not the one I was handed as a template",
    "Ive been most creative when the circumstances left me no other choice",
    "The thing about growth is it doesn't look like growth from the inside",
    "I found my voice by losing the version of it I was performing",
    "Every relationship that ended taught me something the ones that stayed couldn't",
    "I am not defined by the worst thing that happened — I am what survived it",
    "The road was long and the lesson was hidden in the length of it",
    "Ive stopped trying to skip to the end and started living inside the middle",
    "Whatever this is — Im grateful for the version of me that got to experience it",
  
    "I have been surprised by my own resilience more times than I can count",
    "The thing about change is it happens before you notice it happened at all",
    "I built something Im actually proud of from materials I didn't personally choose",
    "Every version of the story I tell myself gets a little closer to the real truth",
    "Ive made peace with not knowing and found that it's the start of everything",
    "The work is its own reward — everything else is what follows after the work",
    "I showed up when showing up was the only thing I had left to give",
    "Some seasons are for planting and some are for waiting and both are necessary",
    "I have loved imperfectly and been loved imperfectly and that is all of it",
    "The path forward became clear the moment I stopped looking for a shortcut",
    "I am most myself in the moments I stop trying to be anything at all",
    "What I want most now is what I had all along and didn't know to keep",
    "Ive been building toward something without knowing exactly what it was",
    "The best version of any story is the one where someone finally tells the truth",
    "I came back to the same place changed enough to finally understand what it was",
    "Every dead end Ive hit eventually revealed a door I'd been walking past",
  ],
};

// Get weighted template list for a genre
function getTemplatesForGenre(genreKey) {
  const templates = GENRE_TEMPLATES[genreKey] || GENRE_TEMPLATES.default;
  // Weight first 4 templates 3x (most genre-authentic), next 4 2x, rest 1x
  return [
    ...templates.slice(0, 4), ...templates.slice(0, 4), ...templates.slice(0, 4),
    ...templates.slice(4, 8), ...templates.slice(4, 8),
    ...templates.slice(8),
  ];
}

// Legacy fallback (used in places not yet genre-aware)
const LINE_TEMPLATES = GENRE_TEMPLATES.default;
const LINE_TEMPLATES_WEIGHTED = getTemplatesForGenre('default');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. EMOTIONAL REGISTERS
// Each register biases which theme and which pool items get picked
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const REGISTERS = {
  hiphop:    ['triumphant','reflective','aggressive','hungry','defiant'],
  pop:       ['euphoric','romantic','nostalgic','empowered','wistful'],
  rnb:       ['intimate','vulnerable','sensual','longing','tender'],
  country:   ['nostalgic','grateful','heartbroken','proud','spiritual'],
  rock:      ['defiant','urgent','raw','cathartic','restless'],
  electronic:['euphoric','transcendent','hypnotic','electric','released'],
  indie:     ['wistful','introspective','bittersweet','tender','searching'],
  latin:     ['passionate','celebratory','sensual','proud','nostalgic'],
  kpop:      ['determined','euphoric','romantic','empowered','dreamy'],
  gospel:    ['worshipful','grateful','victorious','surrendered','anointed'],
  jazz:      ['melancholic','contemplative','yearning','celebratory','nostalgic'],
  metal:     ['furious','triumphant','epic','defiant','relentless'],
  reggae:    ['conscious','peaceful','righteous','joyful','steadfast'],
  folk:      ['nostalgic','tender','earnest','melancholic','grateful'],
  punk:      ['furious','irreverent','raw','urgent','defiant'],
  phonk:     ['menacing','cold','dominant','focused','ruthless'],
  drill:     ['cold','calculated','defiant','determined','unflinching'],
};

// Register → modifier bias (certain modifiers fit certain registers better)
const REGISTER_MODIFIER_BIAS = {
  triumphant: ['undeniable','earned not given','louder than anyone expected','certified','from day one'],
  reflective: ["in ways I still don't have words for",'quietly and completely','the way memory does','simply and profoundly'],
  aggressive: ['no debate','without apology','at full volume','raw and honest','non-negotiable'],
  hungry:     ['every single time','without compromise','no stopping this','all the way to the top'],
  defiant:    ['against every prediction','without a single regret','no exceptions','louder than ever'],
  euphoric:   ['like never before','completely','endlessly','right now','all at once'],
  romantic:   ['forever and a day','more than words can say','deeply','without a doubt'],
  nostalgic:  ['same as it ever was','just like that','the way only real things do','like breathing'],
  empowered:  ['on fire','unstoppable','wide open','all the way'],
  wistful:    ['quietly','without announcement',"in a way I could have predicted but didn't",'specific and unshakeable'],
  intimate:   ['softly and certainly','without saying a word','gently and forever','like only you can'],
  vulnerable: ['honestly','simply and profoundly','the most honest way','without asking anything'],
  sensual:    ['slow and certain','without permission','naturally','inevitably'],
  longing:    ['always','from a distance','in every quiet moment','still'],
  tender:     ['carefully','with everything','gently','like it matters — because it does'],
  heartbroken:['still','even now','without warning','in ways I cannot explain'],
  grateful:   ['every day','lord willing','sure as sunrise','from the heart'],
  proud:      ['plain honest','straight from the heart','no question','deep as the river'],
  spiritual:  ['lord willing','by the grace','in ways only faith explains','sure as the sun rises'],
  urgent:     ['now','faster','without hesitation','before its too late'],
  raw:        ['unfiltered','no holding back','completely','stripped bare'],
  cathartic:  ['finally','all at once','like a weight lifted','clean through'],
  restless:   ['always moving','never settled','one more mile','forward'],
  transcendent:['infinite','beyond the physical','pure frequency','dissolved'],
  hypnotic:   ['in loops','endlessly','deeper every time','without end'],
  electric:   ['voltage running through','crackling','alive with current','lit up'],
  released:   ['free at last','weightless','uncontained','let go'],
  introspective:['quietly','in the half-light','without announcement','the way only honest things do'],
  bittersweet:['beautiful and painful','worth every scar','glad and sad at once','whole'],
  searching:  ['still looking','not yet found','somewhere between','almost'],
  passionate: ['with everything','sin parar','completely','con todo el fuego'],
  celebratory:['louder','sin filtro','right now','with the whole world'],
  dreamy:     ['softly','in a haze','like a beautiful frequency','glowing'],
  worshipful: ['in the presence','with everything holy','at the altar','surrendered completely','in reverence'],
  grateful:   ['with a thankful heart','by grace alone','more than deserved','without limit','in full surrender'],
  victorious: ['by faith not sight','against every odds','through the fire','completely and finally','as promised'],
  surrendered:['in total trust','without holding back','letting go completely','at the feet','in full release'],
  anointed:   ['set apart','chosen and sent','covered by grace','empowered from above','with holy fire'],
  melancholic:['with the weight of years','quietly and completely','in the blue hour','tenderly','with longing'],
  contemplative:['slowly and carefully','in the stillness','between the notes','with full awareness','thoughtfully'],
  yearning:   ['across every distance','with everything aching','still reaching','never quite arriving','persistently'],
  furious:    ['at full force','without mercy','completely unleashed','at maximum','consuming everything'],
  epic:       ['for the ages','monumentally','beyond any limit','permanently in the record','for all time'],
  relentless: ['without stopping','again and again','unbroken','through everything','until the end'],
  conscious:  ['for the people','with clear eyes','speaking truth','in overstanding','with roots'],
  righteous:  ['in truth and love','with jah blessing','standing firm','without compromise','for justice'],
  steadfast:  ['holding the line','roots and culture','firmly planted','through every storm','unshaken'],
  irreverent: ['no rules apply','doing it anyway','without apology','exactly as intended','breaking it all'],
  menacing:   ['cold as ice','without warning','at full weight','unrelenting','like a shadow'],
  dominant:   ['at the top','no competition','above all','unchallenged','at maximum power'],
  focused:    ['eyes on the target','calculated','every move intentional','locked in','precise'],
  ruthless:   ['no sentiment','by any means','without hesitation','to the end','no exceptions'],
  cold:       ['without emotion','calculated','precise','no feeling required','mechanical'],
  calculated: ['every move planned','nothing wasted','by design','step by step','with full intention'],
  unflinching:['without blinking','holding firm','not moving','eyes open','standing in it'],
  determined: ['all the way','with total commitment','in perfect form','beautifully and boldly'],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. TOPIC INJECTION SYSTEM
// Concrete nouns injected at generation time — each topic = fresh song feel
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const TOPICS = {
  hiphop: {
    struggle:  ['rent','eviction','cold nights','empty fridge','closed doors','the block','rejection letters','broken promise','the odds','foreclosure'],
    success:   ['penthouse','deal','platinum','record','check','stage','headline','legacy','award','empire'],
    loyalty:   ['crew','brothers','ride or die','day ones','bond','oath','trust','code','family','squad'],
    love:      ['shorty','heart','vibe','connection','chemistry','her smile','his word','real one','soul','energy'],
    legacy:    ['name','footprint','verse','monument','blueprint','foundation','proof','archive','testament','legend'],
    grind:     ['studio','midnight oil','practice','sacrifice','routine','discipline','hours','craft','process','work'],
    city:      ['city','block','corner','avenue','skyline','project','neighborhood','street','hometown','borough'],
    faith:     ['prayer','blessing','grace','purpose','path','calling','sign','faith','heaven','miracle'],
    reflection:['mirror','journal','memory','photograph','scar','lesson','chapter','past self','turning point','moment'],
    freedom:   ['chain','cage','ceiling','limit','border','barrier','wall','escape','breakthrough','horizon'],
  },
  pop: {
    night:     ['neon','dancefloor','midnight','heartbeat','bass','crowd','lights','city','pulse','rush'],
    love:      ['spark','touch','kiss','chemistry','eyes','smile','warmth','connection','moment','magic'],
    freedom:   ['wings','horizon','open road','sky','leap','release','breathe','escape','flight','limitless'],
    growth:    ['chapter','version','bloom','evolution','becoming','metamorphosis','change','rise','shift','new'],
    nostalgia: ['summer','photograph','song','memory','throwback','old place','first time','before','then','used to'],
    power:     ['fire','crown','force','energy','electric','storm','wave','momentum','surge','ignition'],
    heartbreak:['ghost','silence','void','missing','echo','empty','after','loss','hollow','remains'],
    adventure: ['road','journey','escape','wild','unknown','dare','explore','chase','discover','rush'],
    confidence:['mirror','crown','stage','spotlight','center','front row','unapologetic','own','voice','presence'],
    connection:['us','together','frequency','wavelength','sync','bond','align','meet','find','belong'],
  },
  rnb: {
    intimacy:  ['bedroom','candlelight','whisper','breath','skin','silence','warmth','after','close','together'],
    longing:   ['distance','voicemail','message','window','rain','waiting','absence','space','apart','missing'],
    trust:     ['truth','vulnerable','open','honest','real','safe','bare','seen','known','held'],
    desire:    ['tension','pulse','pull','gravity','magnetism','drawn','need','want','ache','burn'],
    healing:   ['scar','wound','mend','whole','restore','repair','peace','calm','release','free'],
    devotion:  ['always','forever','choose','stay','commit','promise','vow','pledge','oath','remain'],
    memory:    ['photograph','song','smell','laugh','voice','touch','moment','then','used to','still'],
    growth:    ['changed','stronger','wiser','better','evolved','learned','become','transform','emerge','new'],
    loss:      ['goodbye','last','end','over','gone','left','walked away','empty','hollow','after'],
    joy:       ['laugh','smile','light','glow','dance','free','easy','beautiful','bright','alive'],
  },
  country: {
    land:      ['field','pasture','creek','hollow','ridge','valley','timber','soil','acre','harvest'],
    family:    ['daddy','mama','grandpa','grandma','brother','sister','kin','blood','roots','lineage'],
    faith:     ['church','prayer','hymn','Sunday','gospel','blessing','grace','Lord','pew','scripture'],
    hardship:  ['drought','flood','debt','foreclosure','storm','loss','struggle','lean years','hard winter','sacrifice'],
    freedom:   ['open road','highway','county line','leaving','horizon','west','new start','no looking back','truck','wheels'],
    love:      ['front porch','sunset','her name','his hands','long drive','slow dance','holding on','old photo','forever','home'],
    nostalgia: ['childhood','old house','tire swing','swimming hole','school bus','first truck','senior year','before','back then','remember'],
    community: ['neighbor','county fair','potluck','small town','everybody knows','main street','local','together','hometown','the people'],
    seasons:   ['spring planting','summer heat','fall harvest','first frost','winter silence','changing leaves','fireflies','thaw','bloom','bare trees'],
    work:      ['callused hands','early rise','long days','honest labor','worth it','earn','build','fix','tend','keep'],
  },
  rock: {
    rebellion: ['system','cage','machine','control','authority','chain','rule','norm','expectation','box'],
    identity:  ['who I am','truth','real self','mask','authentic','voice','name','claim','own','stand'],
    energy:    ['surge','voltage','current','charge','spark','ignite','amplify','drive','force','push'],
    loss:      ['gone','empty','hollow','what was','ghost','fading','silence after','ruins','aftermath','left behind'],
    searching: ['answer','road','horizon','reason','purpose','meaning','direction','north','sign','way'],
    defiance:  ['refuse','resist','push back','stand firm','hold ground',"won't break",'still standing','unbowed','unmoved','unchanged'],
    catharsis: ['release','scream','break','finally','flood gates','purge','honest','raw','real','open'],
    youth:     ['young','reckless','fearless','first time','before we knew','back then','invincible','naive','free','alive'],
    city:      ['street','concrete','neon','late night','alley','rooftop','subway','crowd','noise','pavement'],
    transcendence:['beyond','above','escape','higher','out of body','infinite','vast','limitless','stars','free'],
  },
  electronic: {
    dancefloor:['bass','drop','floor','crowd','speaker','beat','pulse','sync','wave','frequency'],
    night:     ['midnight','3am','dawn','dark','neon','strobe','after hours','before sunrise','club','rave'],
    connection:['together','collective','one','unified','shared','resonance','frequency','sync','merge','whole'],
    escape:    ['transcend','leave','float','dissolve','beyond','free','release','drift','fly','ascend'],
    technology:['signal','circuit','code','digital','synthetic','electric','programmed','data','grid','system'],
    emotion:   ['feel','pulse','heartbeat','energy','wave','surge','flow','overwhelm','pure','total'],
    repetition:['loop','again','over','cycle','return','pattern','sequence','rhythm','beat','repeat'],
    space:     ['void','cosmos','infinite','dark matter','star','orbit','gravity','universe','quantum','expand'],
    time:      ['moment','now','present','eternal','freeze','flow','stop','forever','instant','always'],
    transformation:['change','evolve','become','shift','new','reborn','emerge','awaken','rise','transcend'],
  },
  indie: {
    memory:    ['photograph','voicemail','letter','mixtape','old shirt','handwriting','smell','specific day','last time','still have'],
    place:     ['apartment','bedroom','kitchen','back seat','park bench','coffee shop','hallway','front step','old town','that street'],
    time:      ['Tuesday','October','that summer','the year','before','after','the week','that morning','last night','a moment'],
    relationship:['you','us','the version','what we had','before you left','how you said it','what you meant','the gap','still','apart'],
    ordinary:  ['grocery store','laundry','commute','cooking','window light','afternoon','routine','Tuesday','unremarkable','small'],
    emotion:   ['unnamed feeling','the ache','quiet joy','bittersweet','tender','fragile','whole','broken open','real','specific'],
    growth:    ['becoming','learning','the version of me','what I know now','changed','older','wiser','softer','harder','honest'],
    art:       ['song','poem','canvas','page','photograph','instrument','melody','verse','painted','composed'],
    loss:      ['gone','what remains','the gap','missing','empty chair','after','without','hollow','the absence','grief'],
    nature:    ['light','season','leaves','rain','snow','morning','dusk','horizon','field','tree'],
  },
  latin: {
    amor:      ['corazon','alma','fuego','pasion','beso','mirada','tu voz','cariño','te quiero','forever'],
    noche:     ['la noche','medianoche','la luna','las estrellas','oscuridad','el bar','la pista','despues','amanecer','caliente'],
    barrio:    ['la calle','el bloque','mi gente','el vecindario','la esquina','casa','origen','raices','familia','tierra'],
    baile:     ['la pista','el ritmo','tu cuerpo','el perreo','la cumbia','el reggaeton','mover','bailar','sentir','vibrar'],
    libertad:  ['libre','sin cadenas','volar','escapar','horizonte','nuevo','camino','destino','adelante','sin miedo'],
    orgullo:   ['orgulloso','mi cultura','mis raices','quien soy','de donde vengo','mi nombre','legado','honor','identidad','sangre'],
    fiesta:    ['celebrar','la fiesta','el sabor','gozar','vivir','disfrutar','el momento','ahora','juntos','felicidad'],
    corazon:   ['herido','roto','sanado','fuerte','abierto','entregado','fiel','leal','tuyo','mio'],
    sueños:    ['el sueño','la vision','lo que quiero','el futuro','lo posible','alcanzar','creer','construir','lograr','ser'],
    calor:     ['el calor','el sol','la playa','tropical','verano','la brisa','el mar','la arena','naturaleza','paraiso'],
  },
  kpop: {
    dream:     ['dream','debut','stage','moment','spotlight','achieve','become','reach','star','destiny'],
    bond:      ['together','members','team','us','family','bond','support','never alone','always','forever'],
    growth:    ['training','practice','stronger','better','level up','evolve','learn','become','prove','earn'],
    love:      ['heart','feeling','butterfly','smile','your eyes','warmth','belong','near','together','always'],
    identity:  ['true self','who I am','real','authentic','shine','unique','individual','own','my voice','become'],
    performance:['stage','lights','camera','audience','energy','presence','command','deliver','perfect','alive'],
    confidence:['unstoppable','fearless','ready','powerful','own it','center','front','no doubt','crown','bold'],
    nostalgia: ['before debut','trainee days','the start','early days','remember','back then','young','beginning','first','origin'],
    world:     ['global','everywhere','ocean','border','language','culture','connect','universal','reach','world'],
    future:    ['tomorrow','next chapter','what comes','where we go','vision','path','ahead','continue','build','forever'],
  },
  gospel: {
    faith:     ['prayer','altar','scripture','blessing','anointing','covenant','testimony','grace','mercy','salvation'],
    healing:   ['wound','brokenness','restoration','wholeness','peace','mending','release','freedom','renewal','rebirth'],
    praise:    ['worship','hallelujah','glory','throne','holy','sanctified','lifted','anointed','spirit','fire'],
    purpose:   ['calling','mission','destiny','path','assignment','gift','season','harvest','planting','vision'],
    community: ['church','congregation','armor bearer','prayer circle','witness','testimony','body','fellowship','covenant','family'],
    struggle:  ['valley','wilderness','storm','trial','test','burden','desert','darkness','fire','shadow'],
    victory:   ['overcomer','warrior','champion','conqueror','breakthrough','deliverance','crown','triumph','elevation','risen'],
    gratitude: ['thankful','grateful','blessed','favored','anointed','chosen','covered','kept','sustained','provided'],
    presence:  ['spirit','fire','wind','river','rain','light','glory cloud','shekinah','dwelling place','sanctuary'],
    trust:     ['faith','believe','stand','hold on','surrender','yield','let go','trust','lean','rest'],
  },
  jazz: {
    city:      ['midnight','downtown','avenue','club','street','neon','window','alley','corner','district'],
    time:      ['late hour','blue morning','dusk','the long night','past midnight','before dawn','the hour','twilight','the season','the year'],
    love:      ['longing','yearning','tenderness','the one','distance','return','departure','memory','devotion','desire'],
    solitude:  ['quiet room','empty glass','the window','cigarette smoke','rain on glass','solitary','the stillness','alone','the silence','contemplation'],
    craft:     ['the changes','the melody','the phrase','the note','the scale','the chord','the rhythm','the groove','the arrangement','the standard'],
    movement:  ['wander','drift','travel','the road','departure','arrival','the journey','migration','passage','homecoming'],
    memory:    ['the old days','another era','what was','the photograph','the record','the club','back then','history','the past','remembrance'],
    loss:      ['absence','what remains','the gap','grief','mourning','the goodbye','the last','emptiness','the echo','what fades'],
    beauty:    ['the light','the curve','the color','the tone','the shape','the texture','the warmth','the depth','the nuance','the detail'],
    wisdom:    ['the lesson','the truth','experience','the story','what I know','the teaching','the insight','the perspective','understanding','the years'],
  },
  metal: {
    war:       ['battle','siege','conquest','blood','iron','armor','sword','warrior','the fallen','the march'],
    darkness:  ['abyss','void','shadow','night','chaos','entropy','oblivion','the deep','darkness','eclipse'],
    power:     ['force','dominion','iron will','unbreakable','forged','tempered','hardened','steel','unyielding','invincible'],
    mythology: ['dragon','titan','god','demon','ancient','rune','prophecy','doom','fate','the eternal'],
    rebellion: ['refuse','defy','resist','overthrow','reclaim','destroy','rebuild','rise','burn','forge'],
    identity:  ['true self','the beast within','the fire inside','the warrior','who I am','the real','the core','the soul','identity','essence'],
    nature:    ['storm','thunder','lightning','volcano','earthquake','flood','fire','mountain','abyss','wilderness'],
    survival:  ['endure','persist','outlast','overcome','survive','withstand','hold','stand','remain','forge on'],
    rage:      ['fury','wrath','fire','blaze','inferno','tempest','the storm','the flood','the charge','the breaking'],
    legacy:    ['monument','testament','the forge','what remains','the mark','the scar','the legend','history','the record','eternity'],
  },
  reggae: {
    justice:   ['babylon','system','oppression','freedom','rights','equality','liberation','truth','justice','the struggle'],
    love:      ['roots','empress','jah love','one love','unity','together','heart','soul','connection','peace'],
    nature:    ['the earth','roots','the river','the mountain','the sky','the sun','the rain','the ocean','the wind','the soil'],
    faith:     ['jah','rastafari','the most high','zion','the way','the truth','the light','guidance','protection','blessing'],
    community: ['the people','brethren','sistren','one people','movement','together','the village','family','roots','culture'],
    resistance:['stand firm','babylon fall','rise up','speak truth','resist','overcome','the struggle','liberation','rebel','freedom fighter'],
    roots:     ['africa','the homeland','heritage','ancestors','lineage','culture','roots','traditions','the old ways','the source'],
    peace:     ['harmony','unity','love and peace','one love','the vibes','irie','positive','uplift','the feeling','together'],
    wisdom:    ['know thyself','the truth','revelation','knowledge','overstanding','the word','the book','the teaching','the way','wisdom'],
    joy:       ['celebration','dance','music','the rhythm','the riddim','the groove','the feeling','the vibes','irie','blessing'],
  },
  folk: {
    land:      ['the field','the valley','the hill','the river','the ridge','the hollow','old growth','the meadow','the plain','the shore'],
    journey:   ['the road','the trail','the crossing','the passage','departure','arrival','the wandering','the miles','the distance','homecoming'],
    memory:    ['the old days','childhood','the house I grew up in','what was','the photograph','the letter','the story','the name','the grave','what remains'],
    love:      ['the one','the years together','the leaving','the return','the promise','the wait','devotion','the reunion','tender','faithful'],
    community: ['the neighbors','the gathering','the harvest','the village','the town','the circle','the fire','the feast','the song','the tradition'],
    loss:      ['the passing','what was left','the absence','grief','the name on the stone','what fades','the empty chair','mourning','the goodbye','the end'],
    nature:    ['the season','the turning','the frost','the thaw','the migration','the bloom','the harvest','the storm','the quiet','the light'],
    labor:     ['the work','the hands','the toil','the craft','the trade','the skill','the dedication','the building','the making','the keeping'],
    truth:     ['the honest word','the simple truth','the plain fact','what matters','the real','the genuine','what lasts','what holds','the core','the foundation'],
    time:      ['the years','the generations','the long view','what passes','what remains','the cycle','the season','history','the story','the record'],
  },
  punk: {
    system:    ['the government','the machine','the corporation','authority','the rules','the norm','the institution','the establishment','the power','the structure'],
    identity:  ['who I am','the real me','my truth','my voice','my choice','my life','my terms','my way','myself','my name'],
    energy:    ['the rush','adrenaline','the surge','the charge','the burst','the explosion','the release','the break','the snap','the crack'],
    solidarity:['us','the crew','together','unity','the scene','the movement','the people','the community','the collective','the band'],
    refusal:   ['no','never','wont','refuse','resist','reject','deny','defy','push back','stand firm'],
    youth:     ['young','now','today','the moment','this generation','the kids','the street','the scene','the sound','the fury'],
    authenticity:['real','honest','raw','unfiltered','genuine','true','no pretense','no mask','no performance','no compromise'],
    boredom:   ['routine','the grind','the same','the cycle','the trap','the job','the debt','the commute','the grey','the noise'],
    love:      ['mess','chaos','collision','the connection','electric','dangerous','reckless','honest','real','alive'],
    freedom:   ['escape','break out','run','leave','go','free','open','wide','no limits','no walls'],
  },
  phonk: {
    street:    ['the block','the trap','the corner','the ride','the cut','the strip','the lot','the hood','the streets','the city'],
    hustle:    ['the bag','the grind','the come up','the move','the flip','the play','the scheme','the work','the process','the mission'],
    night:     ['3am','after dark','the late night','midnight','the dark','the cut','after hours','the hour','the shift','the session'],
    flex:      ['the whip','the chain','the icy','the drip','the fit','the watch','the ring','the stack','the rack','the count'],
    loyalty:   ['the squad','the team','the gang','real ones','day ones','the circle','the code','the bond','the oath','the pact'],
    danger:    ['the pressure','the heat','the threat','the beef','the tension','the risk','the edge','the line','the boundary','the consequence'],
    dominance: ['the throne','the top','the crown','the title','the number','the rank','the position','the spot','the seat','the level'],
    darkness:  ['the void','the shadow','the abyss','the dark','the silence','the stillness','the cold','the empty','the hollow','the quiet'],
    speed:     ['velocity','acceleration','the rush','full speed','no brakes','maximum','overdrive','turbo','redline','full throttle'],
    money:     ['the paper','the bands','the bread','the check','the deposit','the wire','the cash','the count','the stack','the bag'],
  },
  drill: {
    street:    ['the ends','the block','the estate','the manor','the road','the corner','the strip','the cut','the yard','the area'],
    survival:  ['the struggle','the pressure','staying alive','the odds','making it','the grind','the come up','the climb','the rise','the way out'],
    loyalty:   ['the gang','the opps','real ones','day ones','the circle','the code','the bond','the team','the squad','the set'],
    money:     ['the bag','the paper','the check','the count','the bread','the rack','the play','the move','the flip','the gain'],
    danger:    ['the beef','the heat','the pressure','the threat','the risk','the line','the situation','the tension','the consequence','the weight'],
    truth:     ['real talk','no cap','straight up','facts','honest','the truth','no lies','the real','genuine','authentic'],
    grind:     ['the work','the process','the mission','the hustle','the come up','the climb','the effort','the time put in','the sacrifice','the investment'],
    power:     ['the crown','the throne','the top','the position','the rank','the level','the status','the name','the reputation','the legacy'],
    city:      ['the city','the borough','the borough','the district','the zone','the postal','the area code','the ends','the manor','the block'],
    legacy:    ['the name','the reputation','the story','the impact','what I built','the footprint','the history','the record','the evidence','the proof'],
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6b. SYLLABLE TARGETING SYSTEM
// Fast approximate syllable counter + BPM-aware line length targeting
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Fast syllable estimator — no dictionary needed, covers 95% of cases
function countSyllables(word) {
  if (!word) return 0;
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 2) return 1;

  // Common suffixes that are silent or reduce count
  word = word.replace(/(?:[^laeiouy]|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');

  // Count vowel groups
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? Math.max(1, matches.length) : 1;
}

function countLineSyllables(line) {
  if (!line) return 0;
  // Strip punctuation and section tags
  const clean = line.replace(/\[[^\]]+\]/g, '').replace(/[—–\-,;:!?.'"]/g, ' ');
  const words = clean.trim().split(/\s+/).filter(w => w.length > 0);
  return words.reduce((sum, w) => sum + countSyllables(w), 0);
}

// Extract BPM from style prompt (also available in lyricEngine context)
function extractBPMFromPrompt(stylePrompt) {
  if (!stylePrompt) return null;
  const m = stylePrompt.match(/(\d{2,3})\s*(?:BPM|bpm|Bpm)/);
  return m ? parseInt(m[1]) : null;
}

// Derive syllable window from BPM + genre + section type
// section: 'verse' | 'hook' | 'bridge' | 'prechorus'
function getSyllableWindow(bpm, genreKey, section='verse') {
  // Base window from cadenceTarget if available
  const genre = GENRES[genreKey] || GENRES.default;
  const [cMin, cMax] = genre.cadenceTarget || [7, 13];

  // BPM modifier: slow songs → more syllables, fast songs → fewer
  let bpmShift = 0;
  if (bpm) {
    if (bpm <= 70)       bpmShift = +3;   // ballads — long flowing lines
    else if (bpm <= 85)  bpmShift = +2;   // slow-mid
    else if (bpm <= 100) bpmShift = +1;   // mid
    else if (bpm <= 120) bpmShift = 0;    // standard
    else if (bpm <= 140) bpmShift = -1;   // uptempo
    else if (bpm <= 160) bpmShift = -2;   // fast
    else                 bpmShift = -3;   // very fast (punk, drill, metal)
  }

  // Section modifier: hooks shorter/punchier, verses fuller
  let sectionShift = 0;
  if (section === 'hook' || section === 'chorus') sectionShift = -2;
  else if (section === 'prechorus')               sectionShift = -1;
  else if (section === 'bridge')                  sectionShift = -1;
  // verses stay at base

  const min = Math.max(3, cMin + bpmShift + sectionShift);
  const max = Math.max(min + 2, cMax + bpmShift + sectionShift);

  return [min, max];
}

// Score how well a line fits the syllable target
// Returns 0 (perfect) to 1 (terrible)
function syllableScore(line, targetMin, targetMax) {
  const syl = countLineSyllables(line);
  if (syl >= targetMin && syl <= targetMax) return 0;     // perfect
  const dist = syl < targetMin
    ? (targetMin - syl) / targetMin
    : (syl - targetMax) / targetMax;
  return Math.min(1, dist);
}

// Global song-level syllable target (set at song start, used by buildLine)
let _songSyllableMin = 7;
let _songSyllableMax = 13;
let _currentSection  = 'verse';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. GENRE DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function detectGenreKey(stylePrompt) {
  const p = stylePrompt.toLowerCase();
  const scores = {};
  for (const [key, genre] of Object.entries(GENRES)) {
    if (key === 'default') continue;
    scores[key] = genre.keywords.reduce((sum, kw) => {
      if (!p.includes(kw)) return sum;
      const weight = kw.length <= 3 ? 1 : kw.length <= 6 ? 2 : 3;
      return sum + weight;
    }, 0);
  }
  const sorted = Object.entries(scores).sort((a,b) => b[1]-a[1]);
  return sorted[0][1] > 0 ? sorted[0][0] : 'default';
}

// ── GENRE BLEND: if two genres both score well, merge their pools ──
function buildBlendedGenre(stylePrompt) {
  const p = stylePrompt.toLowerCase();
  const scores = {};
  for (const [key, genre] of Object.entries(GENRES)) {
    if (key === 'default') continue;
    scores[key] = genre.keywords.reduce((sum, kw) => {
      if (!p.includes(kw)) return sum;
      return sum + (kw.length <= 3 ? 1 : kw.length <= 6 ? 2 : 3);
    }, 0);
  }
  const sorted = Object.entries(scores).filter(e=>e[1]>0).sort((a,b)=>b[1]-a[1]);
  if (sorted.length < 2 || sorted[1][1] < sorted[0][1] * 0.5) return null;
  const gA = GENRES[sorted[0][0]], gB = GENRES[sorted[1][0]];
  // Merge pools - take 60% from primary, 40% from secondary
  function blend(arrA, arrB, pct=0.6) {
    const nA = Math.ceil(arrA.length * pct), nB = Math.ceil(arrB.length * (1-pct));
    return [...arrA.slice(0, nA), ...arrB.slice(0, nB)];
  }
  return {
    ...gA,
    subjects:      blend(gA.subjects, gB.subjects),
    verbPhrases:   blend(gA.verbPhrases, gB.verbPhrases),
    images:        blend(gA.images, gB.images),
    modifiers:     blend(gA.modifiers, gB.modifiers),
    hookFragments: blend(gA.hookFragments, gB.hookFragments),
    bridgeLines:   blend(gA.bridgeLines, gB.bridgeLines),
    outroLines:    blend(gA.outroLines, gB.outroLines),
    titles:        blend(gA.titles, gB.titles),
    _blended: sorted[0][0] + '+' + sorted[1][0],
  };
}

// ── NARRATIVE ARC SYSTEM ────────────────────────────────────────────────────
// Songs can follow a 3-act arc: Setup → Conflict/Turn → Resolution
// The arc biases which verbs/images get chosen in each section

const NARRATIVE_ARCS = {
  triumph:     ['origin','struggle','victory'],
  redemption:  ['fall','rock_bottom','rise'],
  love_found:  ['solitude','encounter','belonging'],
  love_lost:   ['happiness','loss','acceptance'],
  defiance:    ['oppression','resistance','liberation'],
  growth:      ['naivety','trial','wisdom'],
  legacy:      ['foundation','sacrifice','impact'],
};

// Verb phrases that fit each arc phase (indices into genre.verbPhrases by tag)
const ARC_PHASE_BIAS = {
  origin:      [0,1,2,3,4,14,15,16,17,18],   // early struggle verbs
  struggle:    [5,6,7,8,9,19,20,21,22,23],   // grind/difficulty verbs
  victory:     [30,31,32,33,34,35,36,37,38,39], // success/achievement verbs
  fall:        [5,6,7,8,55,56,57,58,59],
  rock_bottom: [60,61,62,63,64,65,66,67,68,69],
  rise:        [30,31,32,33,34,35,76,77,78,79],
  solitude:    [55,56,57,58,59,60,61,62],
  encounter:   [0,1,2,3,4,10,11,12,13],
  belonging:   [40,41,42,43,44,45,46,47],
  happiness:   [40,41,42,43,44],
  loss:        [55,56,57,58,59,60],
  acceptance:  [65,66,67,68,69,70,71],
  oppression:  [55,56,57,58,59],
  resistance:  [5,6,7,8,9,10,11],
  liberation:  [30,31,32,33,34],
  naivety:     [0,1,2,3],
  trial:       [5,6,7,8,9],
  wisdom:      [70,71,72,73,74],
  foundation:  [0,1,2,3,4],
  sacrifice:   [5,6,7,8,9],
  impact:      [44,45,46,47,48,49],
};

function pickNarrativeArc(rng) {
  const arcs = Object.keys(NARRATIVE_ARCS);
  return arcs[Math.floor(rng() * arcs.length)];
}

function getArcPhaseForSection(arc, sectionIndex, totalSections) {
  if (!arc || !NARRATIVE_ARCS[arc]) return null;
  const phases = NARRATIVE_ARCS[arc];
  const phase = phases[Math.min(Math.floor(sectionIndex / totalSections * phases.length), phases.length-1)];
  return phase;
}

// Get arc-biased verb (fall back to random if phase not available)
function getArcVerb(rng, genre, arcPhase) {
  if (!arcPhase || !ARC_PHASE_BIAS[arcPhase]) return rPick(rng, genre.verbPhrases);
  const indices = ARC_PHASE_BIAS[arcPhase].filter(i => i < genre.verbPhrases.length);
  if (indices.length === 0) return rPick(rng, genre.verbPhrases);
  const idx = indices[Math.floor(rng() * indices.length)];
  return genre.verbPhrases[idx];
}

// ── PUNCHLINE INJECTOR ───────────────────────────────────────────────────────
// Occasionally replace a line's ending with a genre-appropriate punchline tag
const PUNCH_TAGS = {
  hiphop:  ['no debating that','facts period','on everything I love','word is bond','certified','receipt attached'],
  pop:     ['and I mean every word','no question','every single time','completely','right now'],
  rnb:     ['and that is the whole truth','softly and certainly','you already know','always'],
  country: ['plain and simple','lord willing','on my word','sure as sunrise'],
  rock:    ['full stop','no apology','at full volume','permanently'],
  metal:   ['without mercy','from the abyss','no surrender','forge and fire'],
  punk:    ['no permission needed','now','straight up','no compromise'],
  drill:   ['say less','on code','facts','real talk','no cap'],
  phonk:   ['cold','in the dark','slowed','deep'],
  gospel:  ['by His grace','amen','to God be the glory','hallelujah'],
  jazz:    ['low and slow','from the gut','after midnight','one more time'],
  reggae:  ['one love','jah bless','irie','give thanks'],
  folk:    ['plain truth','as the old ones say','simply','without ornament'],
  indie:   ['quietly','specific and unshakeable','the way real things do','still'],
  latin:   ['dale','con todo','fuego','pa lante'],
  kpop:    ['together','for the fans','we shine','always'],
  electronic:['in the frequency','dissolved','pure signal','the drop confirmed it'],
};

function maybePunch(rng, line, genreKey, chance=0.15) {
  if (rng() > chance) return line;
  const tags = PUNCH_TAGS[genreKey] || PUNCH_TAGS.pop;
  const tag = rPick(rng, tags);
  // Only add if line doesnt already end with emphasis
  if (line.endsWith('—') || line.endsWith(',') || line.endsWith(';')) return line;
  return line + ' — ' + tag;
}

// ── CONTRAST LINE BUILDER ────────────────────────────────────────────────────
// Build "before X, after Y" contrast structures for depth
const CONTRAST_TEMPLATES = [
  'before {A}, {S} {V}',
  'once {A} — now {B}',
  '{A} then — {B} now',
  'not {A} anymore — {B} instead',
  'from {A} to {B} in this lifetime',
];

// Pick a theme for this song based on PRNG + register
// Pick a theme for this song based on PRNG + register
function pickTheme(rng, genreKey, register) {
  const themeMap = TOPICS[genreKey];
  if (!themeMap) return null;
  const keys = Object.keys(themeMap);
  return keys[Math.floor(rng() * keys.length)];
}

// Pick register for this song
function pickRegister(rng, genreKey) {
  const regs = REGISTERS[genreKey] || ['reflective'];
  return regs[Math.floor(rng() * regs.length)];
}

// Get register-biased modifier
function getRegisterModifier(rng, register, genre) {
  const biased = REGISTER_MODIFIER_BIAS[register] || [];
  const pool = [...biased, ...genre.modifiers];
  return pool[Math.floor(rng() * pool.length)];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7b. SONG COHERENCE SYSTEMS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── 1. CONCEPT ANCHOR ───────────────────────────────────────
// Pick one concrete image at song start; echo it in verse 2 + outro
// for felt continuity across sections

const ANCHOR_TEMPLATES = {
  hiphop:     ['it all started with {topic} and nowhere to go but forward','came up through {topic} and every lesson it taught me','the foundation of all of this was built inside {topic}','every bar traces back to {topic} — that\'s always been true'],
  pop:        ['everything here started when {topic} changed my whole direction','all roads in this song eventually lead back to {topic}','what started as {topic} became everything I now hold onto','the moment {topic} arrived — nothing stayed the same after'],
  rnb:        ['everything I feel about you lives somewhere inside {topic}','I keep discovering {topic} in every quiet moment left','the whole feeling started inside something like {topic}'],
  country:    ['the road that led me here runs straight through {topic}','it started back with {topic} before I knew what I had','the roots of everything I am grew straight from {topic}'],
  rock:       ['this whole thing started somewhere deep inside {topic}','the truest thing in every song comes back to {topic}'],
  metal:      ['from the fires of {topic} this whole sound was born','the weight of {topic} forged everything I eventually became'],
  jazz:       ['it all began inside the feeling of {topic} and a borrowed glass','the low light of {topic} was where this whole story started'],
  gospel:     ['the grace I know began when {topic} found me kneeling','I came to understand {topic} only after nothing else remained'],
  reggae:     ['the roots of this music grow deep inside the soil of {topic}','every morning the blessing of {topic} is the foundation'],
  folk:       ['the whole honest truth of this began with {topic}','the story started with {topic} — same as every real song'],
  punk:       ['one look at {topic} and the whole situation became clear','everything that followed started with the truth of {topic}'],
  kpop:       ['everything beautiful about this started back in {topic}','the feeling of {topic} is what brought all of us here together'],
  electronic: ['the first frequency I found was tuned to something like {topic}','the signal began with {topic} before the sound had any name'],
  indie:      ['I keep returning to the specific quality of {topic}','the feeling of {topic} is the one I still can\'t explain'],
  default:    ['everything here traces back to the truth of {topic}','all of this began somewhere deep inside {topic}','the whole of it started when {topic} arrived and stayed'],
};

const ANCHOR_ECHO_TEMPLATES = {
  hiphop:     ['still carry the weight of {topic} in every bar written','came from {topic} — and the journey never ends','every step forward traces back to {topic}','built this on the foundation of {topic}'],
  pop:        ['always comes back to {topic} in the end','something about {topic} never left the room','I still hear {topic} in every song I write'],
  rnb:        ['my heart still lives somewhere inside {topic}','I find the truth inside {topic} every quiet night','everything underneath always comes back to {topic}'],
  country:    ['still got the weight of {topic} in my bones','the memory of {topic} never really leaves this place','wherever the road goes — {topic} comes along'],
  rock:       ['standing at the edge of {topic} still in my mind','the sound of {topic} is still the truest thing I know'],
  metal:      ['the force of {topic} remains — unbroken and unmoved','the fire of {topic} never left — it only grew louder'],
  jazz:       ['still sitting with {topic} after all this time','the melody of {topic} lingers like the very last note'],
  gospel:     ['still anchored deep in {topic} — His grace holds firm','the grace of {topic} is where I keep returning'],
  reggae:     ['the roots of {topic} go deep and remain steady','the rhythm of {topic} — constant as the rising sun'],
  folk:       ['still held by {topic} after all the years and miles','the truth of {topic} remains — completely unchanged'],
  punk:       ['the spirit of {topic} is still the only truth','back to the roots of {topic} — same as it always was'],
  kpop:       ['the feeling of {topic} is still where everything lives','together in {topic} — the way it was always meant to be'],
  electronic: ['the signal of {topic} is still transmitting clearly','the frequency of {topic} — still carrying and resonating'],
  indie:      ['the particular feeling of {topic} I never could explain','still sitting with {topic} underneath everything else'],
  latin:      ['the rhythm of {topic} runs deep in everything','the spirit of {topic} never left the song'],
  metal:      ['the darkness of {topic} remains — unbroken and eternal','the weight of {topic} never lifted — it became the foundation'],
  phonk:      ['the underground current of {topic} still moving at night','the echo of {topic} in the late hours — unchanged'],
  drill:      ['the truth of {topic} is documented in every verse','the road back to {topic} is the only road worth traveling'],
  default:    ['still carrying {topic} forward into everything','the feeling of {topic} never fully goes away','all of this comes back to {topic} in the end'],
};

const SCENARIO_LINES = {
  hiphop: {
    struggle: [
      'The month the lights got cut we ate cereal for dinner and said nothing',
      'I remember the exact weight of the eviction notice in my mother\'s hand',
      'Fourteen with a notebook full of plans and a closet with one pair of shoes',
      'The check bounced on a Thursday and we smiled at church on Sunday anyway',
      'I learned to stretch a twenty like it had to last all month — it usually did',
      'The heat never worked in January and we slept in our coats and kept moving',
    ],
    success: [
      'The same room that doubted me is the room I\'m standing in tonight selling it out',
      'I remember the first check that had more zeros than I\'d seen outside a textbook',
      'Flew home first class and looked out the window at the block still down there',
      'They asked for my rider now — used to ask for my ID at the front door',
      'The meeting ran three hours and they still hadn\'t heard what I really wanted',
      'Bought my mother a house on a Tuesday — didn\'t tell anyone for a week',
    ],
    loyalty: [
      'We split the last meal without anyone saying we were splitting the last meal',
      'Bro picked up the phone at three AM and asked no questions — just showed up',
      'We came up through the same hallways and the same phone cut off every winter',
      'The ones who showed when showing cost something — those are the real receipts',
      'We held each other down before holding down meant anything to anybody else',
      'Same circle same code same city — twenty years later still the same answer',
    ],
    grind: [
      'The studio was booked from midnight to six and we didn\'t waste a single minute',
      'I played the verse back forty times before I felt like it said what I meant',
      'Every day in the booth whether the session was going right or going wrong',
      'I missed the party, the trip, the game, the call — the work came first every time',
      'The routine was the same for three years before anyone noticed there was a routine',
      'Nobody saw the thousand hours — they saw the ten minutes on the stage',
    ],
    legacy: [
      'I think about the kids who\'ll find this album ten years from now in a playlist',
      'The verse I wrote at nineteen is the one they quote back to me at thirty',
      'I want the catalog to say something when I can\'t be in the room to say it',
      'My name means something now in a city where it used to mean nothing at all',
      'The foundation I\'m laying right now — someone\'s going to build on it eventually',
      'I think about what I\'m leaving behind more than what I\'m taking forward',
    ],
  },
  pop: {
    love: [
      'You walked in on a Tuesday and by Thursday I\'d rearranged the whole furniture',
      'The way you said my name the first time — I\'ve been chasing that feeling since',
      'We stayed up until four talking about nothing and I didn\'t want it to stop',
      'You laughed at my worst joke and I knew we were going to be something',
      'I drove past your house three times before I worked up the nerve to text you',
      'Every song I heard that week sounded like it was written specifically about you',
    ],
    heartbreak: [
      'I still see you in every coffee shop we used to go to — that\'s the problem',
      'You left on a Friday and I spent the whole weekend pretending I was fine',
      'The playlist you made me is still on my phone and I still can\'t delete it',
      'I cleared out your shelf and then stood there holding your things for an hour',
      'Your friends stopped texting me and that\'s when I knew it was actually over',
      'I rewrote the message seven times and then put my phone down and never sent it',
    ],
    confidence: [
      'I stopped shrinking myself for rooms that were too small for what I actually am',
      'I spent twenty years being who they needed — this is me being who I actually am',
      'Cut my hair on a Wednesday and felt like someone new walked out of that salon',
      'I stopped apologizing for taking up the exact amount of space I deserve',
      'The version of me they knew was polite — this version is honest',
      'I built this confidence out of every moment they told me I couldn\'t',
    ],
    nostalgia: [
      'I found the mix CD you burned me in 2009 at the back of my old car',
      'The song they played at that house party still takes me back in thirty seconds',
      'I drove through my hometown and every street corner held a version of my past',
      'The summer before everything changed — we didn\'t know it was the last good one',
      'My mother still has the voicemail from the night of my first performance',
      'I found the notebook from sophomore year and I barely recognized the handwriting',
    ],
  },
  rnb: {
    intimacy: [
      'You fell asleep on my shoulder and I was afraid to move for two whole hours',
      'We talked in the dark until the conversation became something else entirely',
      'The way you looked at me across the table like nobody else was in the room',
      'You showed up at my door at midnight with nothing to say and everything to give',
      'There\'s a version of Sunday morning with you that I want to live in permanently',
      'The warmth of you in the quiet is the thing I keep coming back to when you\'re gone',
    ],
    longing: [
      'I check my phone at 2 AM not expecting anything and always hoping anyway',
      'Your jacket is still on the chair and I\'ve been moving around it for three weeks',
      'I made dinner for two last Tuesday and didn\'t tell anyone why',
      'I heard the song they played at your birthday and had to pull over the car',
      'I keep rewriting the text I\'ll never send because it still isn\'t right',
      'You\'re three cities away and somehow still in every room I walk into',
    ],
    healing: [
      'I stopped breaking myself in half to fit into the space somebody left me',
      'First morning in a long time I woke up and the first thought wasn\'t you',
      'I put your number in a folder on my phone so I stop searching for it at night',
      'I bought myself flowers last Thursday and I\'m not explaining it to anyone',
      'I finally told the therapist what I\'d been holding for two years — it took four sessions',
      'I took the pictures down and it hurt and then the walls just looked like walls again',
    ],
    devotion: [
      'I would reroute every road in my life to end up where you are',
      'I told you things last night I\'ve never said out loud before to anyone',
      'I canceled everything and showed up and I\'d do it again without hesitation',
      'I wrote your name in the song before I knew what the song was going to be about',
      'The way I feel about you is inconvenient and total and I have no complaints',
      'I choose you first in every version of every scenario I can think of',
    ],
  },
  country: {
    land: [
      'My grandfather built the fence post by post with nothing but wire and patience',
      'The deed to this land has my great-grandmother\'s maiden name on the back',
      'We lost the east forty in the drought of eighty-eight and rebuilt the next spring',
      'I know every stone in that creek bed and every name on the fence post markers',
      'The land doesn\'t care about your plans — it makes its own and you adjust accordingly',
      'Three generations of callused hands turned this soil and I\'m the fourth',
    ],
    heartbreak: [
      'She packed her car on a Sunday and drove out while the church bells were still ringing',
      'I still set two cups in the morning before I remember she\'s not coming down',
      'Her boots are still by the door and I can\'t bring myself to move them yet',
      'We were fine until the Tuesday she said fine wasn\'t good enough anymore',
      'I found the receipt for the ring I never gave her in the bottom of my truck',
      'Last letter she wrote is in my glove box — I know every word by heart now',
    ],
    family: [
      'My daddy\'s watch stopped the night he passed and I wear it anyway',
      'Mom still sets his chair at the table on holidays like he might just come in',
      'My sister married the boy she swore she\'d never speak to again — I was best man',
      'We didn\'t have much but Sunday dinner was always the same and always enough',
      'Three kids four dogs one broken truck and more love than the house could hold',
      'The recipe\'s not written down — I learned it by watching her hands every Christmas',
    ],
    freedom: [
      'I quit the job on a Friday afternoon with sixty dollars and no plan and it felt right',
      'I drove until the radio lost signal and pulled over and breathed for the first time in months',
      'First summer after the divorce I drove the whole coast with no destination at all',
      'Left the town that knew me at twenty-two and found out who I was without it',
      'Two lanes and no traffic and the window down and three days to get anywhere I want',
      'I gave the keys back and walked out into a Tuesday that was all mine for once',
    ],
  },
  rock: {
    rebellion: [
      'First time I heard that record I understood that the rules were made by the wrong people',
      'The teacher said turn it down and I turned it up — that was the whole education',
      'We played the party they said we couldn\'t play and blew out two speakers doing it',
      'Every adult who said we\'d grow out of it just made us play louder for longer',
      'I didn\'t fit the mold so I broke it and built something that actually fit',
      'The dress code said one thing and my guitar said everything else',
    ],
    identity: [
      'I spent seventeen years being someone else\'s idea of me and quit it overnight',
      'The band was the first place I ever felt like the truest version of myself existed',
      'I cut the hair and bought the boots and became something they hadn\'t planned for',
      'Every person I pretended to be left a little residue — the music burns it off',
      'Three chords and something finally made sense that hadn\'t made sense before',
      'I found out who I was in a basement at 1 AM with four strangers and bad PA',
    ],
    catharsis: [
      'I went to the show in the worst week of the year and the set saved my life',
      'I played the same song forty times and finally cried at bar thirty-seven',
      'The guitar doesn\'t fix it — it just gives the feeling somewhere to go for a while',
      'I turned the amp up all the way and screamed into it until my chest felt lighter',
      'Something about the volume makes the thing you can\'t say out loud feel said',
      'The chorus hit at exactly the wrong moment and I had to pull over and breathe',
    ],
    youth: [
      'We were seventeen in a parking lot with a borrowed amp and nowhere to be',
      'The summer we drove the van to five cities and slept on four different floors',
      'Nobody knew our name and it didn\'t matter because the room was three hundred people',
      'We were broke and loud and completely certain it was all going to work out somehow',
      'First show was twelve people and one of them was my mother and I played like it was Madison Square',
      'The tape we recorded in Kyle\'s basement is still the best thing any of us have done',
    ],
  },
  indie: {
    memory: [
      'There\'s a specific quality of October light that takes me back to that apartment',
      'I found the ticket stub in my coat pocket from the show the night we met',
      'The smell of that coffee shop still lands me somewhere I thought I\'d left behind',
      'I heard the song on shuffle and was twenty-three again for exactly four minutes',
      'The photograph is polaroid-faded and I remember exactly what was said right after',
      'You still exist in the songs from the year we were both in the same city',
    ],
    place: [
      'I left that city two years ago and part of me has been there the whole time',
      'The apartment was too small for two people and exactly right for what we were',
      'There\'s a bench in that park where I used to sit and feel like I was figuring things out',
      'The town I grew up in still shows up in my dreams in the same version — before the bypass',
      'I drive past the old building on the way home and check if the light is still on',
      'That street exists differently in my memory than it does in real life — better',
    ],
    relationship: [
      'We had the same argument four times and each time we thought it was resolved',
      'You knew me in the version before the version I\'m living now — that counts',
      'I kept the book you left — the one with the coffee ring on page forty-three',
      'We were friends for a year before anything shifted and then it all shifted at once',
      'I still have the voicemail where you said you were proud of me — I play it sometimes',
      'The last time I saw you we had no idea it was going to be the last time',
    ],
    ordinary: [
      'Every Tuesday I get the same coffee order and it\'s the most reliable thing in my life',
      'The ritual of the morning — the same sequence — is the thing that holds everything together',
      'I find the extraordinary in the parts of the week that other people rush past',
      'The walk home through the same streets at the same time — that\'s where I do my thinking',
      'We cooked the same pasta three weeks in a row and I looked forward to it every time',
      'There\'s a version of a Wednesday evening at home that I would choose over almost anything',
    ],
  },
  jazz: {
    city: [
      'Three AM in a city that never decides whether it\'s beautiful or brutal — both',
      'The neon from the bar sign makes a puddle on the wet street outside the window',
      'Last set of the night in a room of forty people who stayed until the last note',
      'I played this corner for six years before anyone in this neighborhood knew my name',
      'The city hums a different note at four in the morning — that\'s when I write',
      'Steam from the grate and a saxophone two blocks over — that\'s the city I know',
    ],
    love: [
      'You walked into the club in the third set and I lost the melody for half a bar',
      'We talked until the bartender turned the chairs up around us and neither of us noticed',
      'I wrote the chord progression for you on a napkin and you still have it somewhere',
      'Every time I play that song I\'m back at the table where we first sat too close',
      'You understood the music before you understood me and that told me everything',
      'I played it slow because fast would have said too much too soon',
    ],
    craft: [
      'I practiced the same eight bars for three months before they stopped sounding practiced',
      'My teacher said listen more and I spent a year just listening before touching the keys',
      'The instrument teaches you patience — you can\'t fake your way through the silence',
      'Thirty years in and I still find something new in the changes every single night',
      'The audience doesn\'t hear the ten thousand hours — they hear the ten minutes',
      'I played the wrong note and found out it was the right note in a different key',
    ],
    solitude: [
      'The best practice sessions happen at midnight when everyone else has gone to bed',
      'I play for myself first — the audience is secondary to what the music demands of me',
      'There\'s a version of being alone with the piano that is the most honest I ever get',
      'I walked the city after the gig and the music was still playing in my chest somewhere',
      'Some nights I stay in the empty club after everyone leaves and play for the chairs',
      'The quiet after the last note is as much a part of the music as the note itself',
    ],
  },
  gospel: {
    faith: [
      'I held on when holding on was the only thing I had the energy to do',
      'The night I nearly gave up something shifted — I don\'t have another word for it',
      'I prayed with nothing left and woke up with just enough to keep going',
      'The faith I have now I only have because it was tested until only faith remained',
      'I stopped asking why the trial lasted so long and started asking what it was teaching',
      'The answer didn\'t come the way I expected — it came the way I needed',
    ],
    healing: [
      'I walked into that service carrying ten years and walked out carrying something lighter',
      'The day the grief finally broke — I was in the middle of the third verse of a hymn',
      'He healed the part of me I didn\'t know was still open and bleeding',
      'I came to the altar broken and the thing that left wasn\'t what I thought it was',
      'The restoration happened slowly and then all at once like I\'ve heard grace works',
      'I sang through the tears because the praise was the only thing bigger than the pain',
    ],
    praise: [
      'I lift my hands in the middle of the hard thing because that\'s when it matters most',
      'The choir came in on the bridge and every person in that room felt the same thing',
      'I worship because He is worthy — not because the circumstances are comfortable',
      'The song broke out and three hundred people became one voice going in one direction',
      'I could not stop the praise — it rose up from somewhere below my intention',
      'We sang it louder the second time and the third time louder still — that\'s the testimony',
    ],
    struggle: [
      'I cried in the car before service so nobody inside would see me not holding it together',
      'The season lasted longer than I had faith for and the faith outlasted the season anyway',
      'I asked for relief and got endurance — it took me two years to understand the gift',
      'The job ended and the diagnosis came in the same week and I still opened the Bible',
      'I stood in the fire long enough to know He was in the fire too — that changed everything',
      'The trial looked like failure until the breakthrough revealed what the trial had built',
    ],
  },
  reggae: {
    justice: [
      'The same system that built the prison built the school with the same intention',
      'They wrote the law and they own the law and we still have to live inside it',
      'I\'ve watched three generations wait for a justice that never finished arriving',
      'The children born into the debt they didn\'t create deserve better than what we\'ve left',
      'Every protest song is a documented history they can\'t take out of the archive',
      'We chant down the walls not because it\'s easy — because silence is cooperation',
    ],
    roots: [
      'I carry the island in my chest wherever the ship or the plane takes me',
      'My grandmother\'s songs are the original archive — older than any written record',
      'The drum pattern in this song traveled from Africa to Jamaica to this room tonight',
      'I speak in the accent of my father\'s father because it is the original language of me',
      'The roots go deeper than the history books that chose not to include them',
      'Every generation adds a verse to the song the ancestors started',
    ],
    love: [
      'I found you in the middle of a crowd at a concert and the music changed meaning',
      'The way you move to the rhythm tells me everything I needed to know about your soul',
      'We danced until the sun came up and agreed we\'d keep dancing wherever we ended up',
      'Love is the revolution the politics never managed to organize',
      'I hold you like the tide holds the shore — I can\'t help it and I don\'t want to',
      'When I sing this it is for you — it has always been for you first',
    ],
  },
  folk: {
    journey: [
      'I left home with a guitar case and forty dollars and a direction but not a destination',
      'Six months on the road and the road became more home than anywhere I\'d lived',
      'I played every town between here and the coast and left a piece of the song in each one',
      'The map I had became obsolete on day three and I didn\'t stop',
      'Every stranger who bought me a meal gets a verse in the gratitude song I never finished',
      'I came back changed in ways I still can\'t name to a place that stayed the same',
    ],
    love: [
      'I wrote you into the chorus before I knew you were the person the chorus was for',
      'We met at the festival on the second day and by the third day I\'d changed my plans',
      'The love that comes quiet and stays — that\'s the kind worth writing about',
      'You know every version of the song including the bad one from the first year',
      'I sang the song for the first time in front of people and you were in the second row',
      'We built a life out of small honest things and it\'s held up better than most',
    ],
    loss: [
      'I got the call on the road and drove the last two hours with the radio off',
      'The chair is still where he left it and nobody moves it even for company',
      'I played his favorite song at the service and couldn\'t finish the second verse',
      'She kept every letter I ever wrote her — I found them in a box beside the bed',
      'The last conversation we had was ordinary and I\'ve been grateful for that ever since',
      'Grief arrives without a schedule and I\'ve stopped trying to predict when it comes',
    ],
    truth: [
      'The honest song is harder to write than the comfortable one and worth more',
      'I stopped polishing the rough edges and that\'s when people started recognizing themselves',
      'The verse that scared me the most is the one people come up and quote back to me',
      'I\'d rather tell one true thing than ten beautiful lies in four minutes',
      'I wrote what I actually felt instead of what I was supposed to feel and it rang truer',
      'The folk tradition is just: say the real thing in the plainest way you can manage',
    ],
  },
  metal: {
    defiance: [
      'Every person who told me this was a phase is at a desk job in a building I\'ll never enter',
      'I played louder every time they asked me to turn it down — that was the whole statement',
      'We built this without permission because permission was never going to arrive',
      'The system measured me and found me insufficient and I kept going anyway',
      'I failed their test and passed the one that actually mattered',
      'Everything they tried to build against me became material I built with',
    ],
    darkness: [
      'I know the specific geography of the 3 AM mind — I\'ve mapped it completely',
      'The dark years left marks that don\'t fade — I write about them so they mean something',
      'There were years I couldn\'t see the way forward — the music was the way forward',
      'I went into the void and found out what I was made of down there',
      'The heaviest riff is an honest report from the heaviest part of a real experience',
      'I made beauty out of the thing that was trying to destroy me — that\'s the whole record',
    ],
    power: [
      'I came back from the lowest point with something they can\'t manufacture or take',
      'Every set I play is a demonstration that the thing they said couldn\'t survive — survived',
      'I lift the weight until the weight teaches me something about the weight',
      'The strength I have now I built from every moment the weakness tried to win',
      'I don\'t ask for permission to take up this much space anymore',
      'The power isn\'t in the volume — it\'s in what the volume is saying',
    ],
  },
  punk: {
    rebellion: [
      'I read the rules they handed me and understood immediately they weren\'t for me',
      'First show was twelve people in a basement and it was the most alive I\'d ever felt',
      'They said we weren\'t a real band and we pressed a record the next month to prove it',
      'The principal called my parents and my parents said that\'s just who she is now',
      'Every no we got became a reason to play louder and a story to tell from the stage',
      'I broke the dress code daily for three years as a form of ongoing political protest',
    ],
    community: [
      'I found my people before I found anything else — the everything else followed',
      'The basement show is where I learned that community means showing up even on bad nights',
      'We built the scene with our own hands and no budget and it outlasted everything funded',
      'Every person who came to the early shows when there was nothing to prove — they\'re family',
      'The potluck before the show and the van after — that\'s the culture nobody photographs',
      'I got sober at a punk show because three people I didn\'t know yet talked to me after',
    ],
    truth: [
      'I stopped saying what I was supposed to say and the honesty was its own percussion',
      'The song is three minutes because the truth doesn\'t need more than three minutes',
      'I\'d rather be wrong and honest than right and diplomatic about the wrong things',
      'The comfortable lie or the uncomfortable truth — I pick the uncomfortable truth every time',
      'I wrote the song about the thing nobody wanted to talk about and the room got quiet',
      'The feedback is the honesty — everything cleaner is something being hidden',
    ],
  },
  phonk: {
    grind: [
      'Three AM every night for a year in a bedroom studio nobody knew existed',
      'I made the beat on hardware I bought from a pawn shop for sixty dollars total',
      'Every sample I used I found in a bin or a thrift store or someone\'s forgotten archive',
      'I put out the tape with no promo and it spread through word of mouth for two years',
      'The underground doesn\'t advertise — it moves at its own frequency and finds its people',
      'I learned mixing from YouTube at midnight while everyone else was asleep',
    ],
    isolation: [
      'I work better alone in the dark with headphones on and nobody waiting on anything',
      'The best sounds come from the hours when the city has decided to stop pretending',
      'I removed every distraction until what was left was the thing I was actually making',
      'Three weeks in the same room with the same sounds and something finally clicked',
      'The solitude is not loneliness — it\'s the specific condition the work requires',
      'I made peace with the fact that what I make is for the people who will find it later',
    ],
    authenticity: [
      'I never chased a trend because trends leave before the record is even pressed',
      'The sound I made was wrong for every moment it arrived in and right for the next one',
      'I stayed underground not from fear but because the surface wasn\'t built for this',
      'Every compromise somebody else made is clearly audible in their output — I hear it',
      'The rawness is the point — the polish would be the lie',
      'I knew what I was making before there was a name for it and kept making it anyway',
    ],
  },
  drill: {
    struggle: [
      'The estate shaped me in ways that a postcode can\'t fully contain or communicate',
      'I grew up watching people I loved make decisions the circumstances made for them',
      'Sixteen on a corner because the corridor between school and work was blocked',
      'The cold in a block flat in February is a specific cold you don\'t forget',
      'Every bar I write is a refusal to pretend the estate was something it wasn\'t',
      'I document what I lived because somebody has to and I was there and I survived it',
    ],
    loyalty: [
      'My day ones were there when there was nothing to be there for — that\'s the contract',
      'We came up through the same block and the same circumstances and the same code',
      'I\'d rather lose everything than break something I swore on my brother\'s life',
      'The circle is small because the standards for being in it are genuinely high',
      'We don\'t talk about what we\'d die for — we demonstrated it and moved on',
      'I give back to the block because the block gave me everything I had to give back',
    ],
    success: [
      'I came from a postcode they write statistics about and became a statistic they didn\'t plan for',
      'The meeting was in an office I would have been stopped at the door of three years ago',
      'First headline show I looked out at the crowd and saw people who looked exactly like me',
      'I bought my mum out of the block and the block came to the housewarming',
      'I turned the dark piano into a world tour — that\'s the full journey in one sentence',
      'They didn\'t see us coming because they weren\'t looking at where we came from',
    ],
  },

  electronic: {
    transcendence: [
      'The drop hit and for sixteen bars I forgot that I had a name or a body',
      'Three AM on the dancefloor and every stranger felt like someone I had always known',
      'The synth pad held one chord for four minutes and I felt time stop entirely',
      'I closed my eyes at the festival and the bass became the only heartbeat I needed',
      'The kick drum synced with my pulse and for one moment I was just frequency',
      'Something happened between the build and the drop where I left myself behind',
    ],
    creation: [
      'I programmed the first loop at my kitchen table using headphones and free software',
      'The patch I made by accident at two AM became the sound that defined the EP',
      'I spent six months on one song because the feeling had to match exactly',
      'The sample came from a recording of rain on my apartment window during a storm',
      'I designed a sound that doesn\'t exist in any instrument — it only lives in this DAW project',
      'The breakthrough happened when I stopped trying to sound like anyone else\'s setup',
    ],
    nightlife: [
      'The warehouse had no sign — you found it by following the bass through the alley',
      'The DJ played until sunrise and nobody wanted the world outside to exist again',
      'We drove forty minutes to a club in an industrial park and it changed everything',
      'The booth was small and the monitors were blown but the energy was perfect',
      'I remember the exact song playing when the lights came on and the spell broke',
      'The best sets happen when the crowd and the DJ stop being separate things',
    ],
    connection: [
      'The music connected rooms in different countries at the same exact moment',
      'A stranger sent me a voice note saying my track got them through chemotherapy',
      'I played the song to ten thousand people who all knew every beat before it landed',
      'The rave was the one place where nobody cared about what you did outside',
      'We never spoke the same language but the four-on-the-floor was fluent for both of us',
      'The mix went online and someone in a timezone I\'ve never visited said it saved their night',
    ],
  },

  latin: {
    roots: [
      'My grandmother hummed boleros while she cooked and the melody lives in everything I write',
      'The barrio raised me with merengue on Saturday mornings and church bells on Sunday',
      'I learned rhythm before I learned to read — the conga was my first language',
      'The neighborhood block party had better musicians than any concert hall in the city',
      'I carried my abuela\'s accent into every song because that is where the truth lives',
      'The island is small but the music it made reached every continent on Earth',
    ],
    passion: [
      'We danced so close that the music became unnecessary — we made our own rhythm',
      'The summer we met the reggaeton was playing everywhere and now I can\'t hear it without seeing your face',
      'I wrote this at three AM because the feeling wouldn\'t let me sleep until I said it',
      'The way you moved through the room made the whole party reorganize around you',
      'I said I wouldn\'t call — then your song came on and my hands decided for me',
      'Every love song I write is still somehow about that first dance in your mother\'s kitchen',
    ],
    pride: [
      'They told us to sing in English if we wanted to make it — we made it in Spanish',
      'The flag on my wall is not decoration — it is the reason I do this',
      'I put the dembow on a world stage and the world learned the words in our language',
      'My city doesn\'t show up on music maps — so I drew a new map',
      'The first time I heard our sound on international radio I called my whole family',
      'We didn\'t cross over — we made them come to us',
    ],
    celebration: [
      'The wedding went until four AM and the band never played the same song twice',
      'My cousin\'s quinceañera had three hundred people and every single one danced',
      'The summer anthem wasn\'t planned — it just happened to sound like everyone\'s best memory',
      'The street closed for the festival and for one night nobody remembered their problems',
      'I make music for the moment when the whole table stands up and nobody sits back down',
      'The party doesn\'t start when the DJ plays — it starts when abuela gets on the floor',
    ],
  },

  kpop: {
    trainee: [
      'Three years of practice rooms before anyone outside the company knew my name',
      'I left home at fifteen to train in a city where I knew nobody',
      'The monthly evaluations felt like judgment day — one bad score and everything ends',
      'I practiced the same eight counts for six hours until my body remembered it without me',
      'My parents cried at the airport and I promised them the sacrifice would be worth it',
      'The debut date kept getting pushed back — I trained through doubt that had no deadline',
    ],
    debut: [
      'The first stage felt like an out-of-body experience — the lights were brighter than anything I had imagined',
      'We trended for twelve hours and I watched the number climb from a practice room floor',
      'The fancam hit a million views and I watched it seventeen times still not believing it was me',
      'Our first win happened on a Tuesday and we cried in the dressing room for an hour',
      'The debut showcase had forty people — six months later the arena had forty thousand',
      'I heard fans singing our song back to us for the first time and forgot my choreography',
    ],
    fandom: [
      'The fans learned our names before we learned theirs and that still feels like a miracle',
      'I read every letter at the fan sign and one of them said I saved their life',
      'The lightstick ocean during the bridge is the most beautiful thing I have ever seen',
      'They organized a birthday project in fourteen countries — I am still not over that',
      'The fandom name was chosen together — because we are not separate things',
      'I perform the polished version but the fans deserve to know the unpolished true one too',
    ],
    identity: [
      'The idol image is the invitation — the music is the real introduction',
      'I became myself in public and asked fifty million people to witness the process',
      'The concept photos show a character but the V-Live shows the person',
      'I write in a language that is not mine and feel things that are universal',
      'The pressure to be perfect made me realize that perfect is not what they actually want',
      'Between the group and the solo there is a version of me that belongs only to me',
    ],
  },
};

function pickConceptAnchor(rng, genreKey, theme, topicWords) {
  const topic = topicWords && topicWords.length ? rPick(rng, topicWords) : null;
  if (!topic) return null;
  const templates = ANCHOR_TEMPLATES[genreKey] || ANCHOR_TEMPLATES.default;
  const tpl = rPick(rng, templates);
  return tpl.replace('{topic}', topic);
}


// Pick a scenario-specific line for verse 1 or 2 opening
// Returns null if no scenario exists for this genre/theme combination
function pickScenarioLine(rng, genreKey, theme, songUsed) {
  const genreScenarios = SCENARIO_LINES[genreKey];
  if (!genreScenarios || !theme) return null;
  const themeScenarios = genreScenarios[theme];
  if (!themeScenarios || themeScenarios.length === 0) return null;
  // Filter out lines already used in this song
  const fresh = themeScenarios.filter(l => !songUsed.has(l));
  if (fresh.length === 0) return null;
  const line = rPick(rng, fresh);
  songUsed.add(line);
  return line;
}

function buildAnchorEcho(rng, genreKey, topicWords) {
  const topic = topicWords && topicWords.length ? rPick(rng, topicWords) : null;
  if (!topic) return null;
  const templates = ANCHOR_ECHO_TEMPLATES[genreKey] || ANCHOR_ECHO_TEMPLATES.default;
  const tpl = rPick(rng, templates);
  return tpl.replace('{topic}', topic);
}

// ── 2. STORY BEAT METADATA ──────────────────────────────────
// Each verse has a "beat intent" — what it's supposed to accomplish
// verse1 = establish, verse2 = complicate/deepen, bridge = pivot/reveal, outro = resolve

const BEAT_INTENTS = {
  verse1:  'establish',   // set the scene, introduce the speaker/situation
  verse2:  'complicate',  // deepen, add tension, shift perspective
  bridge:  'pivot',       // contrast, revelation, turn
  outro:   'resolve',     // land, close, echo
};

// Beat-specific line starters (replaceable openers that signal intent)
const BEAT_STARTERS = {
  establish: {
    hiphop:  ['let me tell you where this started —','back when','this is the part they never tell you —','from day one —'],
    pop:     ['here\'s the thing —','it started like this —','before all of this','let me take you back —'],
    rnb:     ['picture this —','the night it all started —','I remember exactly —','here\'s where it began —'],
    country: ['I was seventeen —','it was a Tuesday —','out on the back road —','back when the fields were full —'],
    rock:    ['it started in a basement —','back when nothing was figured out —','before any of it made sense —'],
    folk:    ['I\'ll tell you how it started —','back at the beginning —','there was a time when —','where I\'m from —'],
    default: ['here\'s how it started —','back at the beginning —','let me set the scene —'],
  },
  complicate: {
    hiphop:  ['but then —','that\'s when everything shifted —','what they don\'t know is —','here\'s where it gets real —'],
    pop:     ['but something changed —','here\'s what I didn\'t see coming —','and then —','except —'],
    rnb:     ['but slowly —','what I didn\'t say was —','somewhere in between —','until —'],
    country: ['then the summer ended —','that\'s when the hard part started —','but the road had other plans —'],
    rock:    ['then it cracked open —','that\'s when the doubt came in —','until the whole thing broke —'],
    folk:    ['but seasons turned —','and nothing stayed the same —','then grief came through the door —'],
    default: ['but then something shifted —','that\'s when the real part began —','until —'],
  },
  pivot: {
    hiphop:  ['let me flip this —','here\'s the turn —','what nobody expected —','real talk —'],
    pop:     ['but here\'s the thing —','the part I haven\'t said —','what I finally understand —','the truth is —'],
    rnb:     ['what I never said aloud —','in the quiet —','the honest version —','stripped all the way down —'],
    country: ['here\'s what I know now —','after all of it —','the honest truth is —','lord knows —'],
    rock:    ['here\'s the raw version —','strip it all away —','what\'s left is this —'],
    folk:    ['here\'s what the road taught me —','after all that distance —','the truth I finally found —'],
    default: ['here\'s what I finally see —','the turn —','stripped down to this —'],
  },
  resolve: {
    hiphop:  ['so here\'s where I land —','at the end of it —','what I know for sure —','legacy secured —'],
    pop:     ['and that\'s the whole of it —','this is where it lands —','in the end —','what I carry forward —'],
    rnb:     ['and still —','at the end of all of it —','what remains is this —','softly and finally —'],
    country: ['and when it\'s said and done —','what the years leave behind —','this is what stays —'],
    rock:    ['and this is what survives —','what the noise couldn\'t touch —','what\'s left standing —'],
    folk:    ['and this is the truth of it —','after all the years —','what remains is simple —'],
    default: ['and this is where it ends —','what stays after everything —','the only part that matters —'],
  },
};

function getBeatStarter(rng, beatIntent, genreKey) {
  const intentMap = BEAT_STARTERS[beatIntent];
  if (!intentMap) return null;
  const pool = intentMap[genreKey] || intentMap.default || [];
  if (!pool.length) return null;
  // Only inject 40% of the time — subtle, not every verse
  if (rng() > 0.40) return null;
  return rPick(rng, pool);
}

// ── 3. LINE VARIETY INJECTOR ────────────────────────────────
// Occasionally replace a generated line with a structural variety form:
// fragments, rhetorical questions, direct address, repetition, imperative

const LINE_VARIETY_FORMS = {
  fragment: [
    // Short fragment lines — stop mid-thought for dramatic effect
    (img) => img,
    (img) => img + '.',
    (img) => img + ' — nothing more',
    (img) => 'just ' + img,
    (img) => 'only ' + img,
  ],
  question: {
    hiphop:  ['do you remember where this started?','what did they expect?','how many times do I have to prove it?','who was there when it mattered?'],
    pop:     ['is this what it feels like?','do you feel it too?','why does it still feel like the first time?','where do we go from here?'],
    rnb:     ['do you feel what I feel?','is this what love is supposed to be?','why does your name still sound like home?','did you know I never stopped?'],
    country: ['do you still think about those summers?','was it always going to end this way?','why does the road always lead back here?','do you remember how it felt?'],
    rock:    ['is any of this real?','what are we fighting for?','who decides what\'s worth keeping?','how much can a person take?'],
    folk:    ['do the old places know you\'ve been gone?','what does the river remember?','did you find what you were looking for?','is this what they meant by home?'],
    metal:   ['what remains when the fire dies?','who will stand when the storm hits?','how deep does the darkness go?'],
    gospel:  ['who is worthy of this grace?','do you feel His presence here?','how long, how far will His mercy reach?'],
    reggae:  ['do you hear the drum of truth?','how long will babylon stand?','who will rise when the call comes?'],
    punk:    ['who gave them the right?','how long do we keep asking permission?','what are you so afraid of?'],
    default: ['what does any of this mean?','who is still listening?','where do we go from here?'],
  },
  direct_address: {
    hiphop:  ['look —','hear me —','I\'m talking to you —','pay attention —','this is for everyone who —'],
    pop:     ['hey —','listen —','you know what?','I need you to hear this —','this one\'s for you —'],
    rnb:     ['baby —','listen to me —','look at me —','I need you to know —','hear me —'],
    country: ['hey now —','listen —','you know it\'s true —','I\'m telling you —'],
    rock:    ['hey —','listen up —','you already know —','I\'m telling you —'],
    folk:    ['friend —','listen —','I\'m telling you true —','hear this —'],
    default: ['listen —','you hear me —','this is the truth —'],
  },
  repetition: [
    // Line-end repetition for emphasis (echo the last word/phrase)
    (line) => { const words = line.split(' '); return line + ' — ' + words.slice(-2).join(' '); },
    (line) => line + '\n' + line,   // full line repeat (chorus style)
  ],
  imperative: {
    hiphop:  ['remember this','hold on to that','keep going','never let them see you stop','write it down'],
    pop:     ['don\'t let go','hold on','keep believing','stay right here','remember this feeling'],
    rnb:     ['stay','hold me','don\'t go','come back','say it again'],
    country: ['hold on to that','remember where you came from','keep the faith','stay true','drive on'],
    rock:    ['don\'t stop','keep going','hold the line','stay standing','never bow'],
    folk:    ['remember this road','hold on to it','keep the story','pass it down','sing it true'],
    gospel:  ['stand firm','hold on','praise through it','trust the process','believe'],
    metal:   ['stand your ground','rise up','forge ahead','never yield','hold the line'],
    punk:    ['don\'t ask permission','just do it','go now','break free','make noise'],
    default: ['remember this','keep going','hold on','stay true'],
  },
};

function maybeInjectVariety(rng, line, genreKey, image, chance=0.18) {
  if (rng() > chance) return line;
  const forms = ['fragment', 'question', 'direct_address', 'imperative'];
  const form = rPick(rng, forms);

  if (form === 'fragment' && image) {
    const fns = LINE_VARIETY_FORMS.fragment;
    return rPick(rng, fns)(image);
  }
  if (form === 'question') {
    const pool = LINE_VARIETY_FORMS.question[genreKey] || LINE_VARIETY_FORMS.question.default;
    return rPick(rng, pool);
  }
  if (form === 'direct_address') {
    const pool = LINE_VARIETY_FORMS.direct_address[genreKey] || LINE_VARIETY_FORMS.direct_address.default;
    const addr = rPick(rng, pool);
    return addr + ' ' + line;
  }
  if (form === 'imperative') {
    const pool = LINE_VARIETY_FORMS.imperative[genreKey] || LINE_VARIETY_FORMS.imperative.default;
    return rPick(rng, pool);
  }
  return line;
}

// ── 4. PRE-CHORUS TENSION BUILDER ──────────────────────────
// Pre-chorus lines should escalate toward the chorus — not just be short verses

const PRE_CHORUS_LINES = {
  hiphop:  [
    'everything I built — about to show them all',
    'right at the edge — watch what happens next',
    'been waiting for this — can\'t hold it back anymore',
    'the moment\'s here — I feel it in my chest',
    'one more step — then the whole world shifts',
    'they counted wrong — let me show them the math',
    'this energy — it\'s been building for years',
    'no more waiting — the time is right now',
    'feel the shift — everything\'s about to change',
    'the doubters went quiet — they already know',
  ],
  pop:     [
    'I can feel it coming — can\'t hold back anymore',
    'something\'s building — bigger than before',
    'right at the edge of everything',
    'the feeling\'s rising — I can\'t keep it in',
    'and it\'s almost time — I feel it in my blood',
    'every nerve is electric — something\'s about to happen',
    'the countdown\'s started — no going back now',
    'it\'s on the tip of my tongue — the thing I\'ve been afraid to say',
    'closer and closer — the feeling won\'t wait',
    'I came with no expectations and now I\'m reconsidering everything',
  ],
  rnb:     [
    'getting closer — can\'t pretend I don\'t feel this',
    'the tension building — something has to give',
    'I\'m right there — right on the edge of saying everything',
    'everything I\'ve been holding — about to overflow',
    'one more breath — then I say what I\'ve been keeping',
    'your gravity is pulling — I\'m falling into this',
    'the space between us — shrinking by the second',
    'every touch is an invitation I keep accepting',
    'I can\'t keep pretending this is casual',
    'the truth is in the silence between the words',
  ],
  country: [
    'something\'s coming — I can feel it in the air',
    'right at the breaking point — holding on',
    'the storm is building — nothing left to do but face it',
    'can\'t hold it back — the heart wants what it wants',
    'the moment\'s coming — ready or not',
    'the wind just shifted — something\'s different now',
    'I can see the lightning — the thunder\'s coming next',
    'been driving all night — almost at the place that matters',
    'the porch light\'s on — and I know what that means',
    'everything I left behind is calling me home',
  ],
  rock:    [
    'the pressure\'s building — something has to break',
    'right at the edge — one more push',
    'everything\'s been leading here — I feel the shift',
    'can\'t hold it down — it\'s coming out',
    'the wall is cracking — let it fall',
    'the amps are buzzing — the room is shaking',
    'louder and louder — until they all hear it',
    'the fuse is lit — no putting it out now',
    'stand back — this one\'s going to be loud',
    'every quiet moment was just preparation for this noise',
  ],
  metal:   [
    'the storm is gathering — the fury builds',
    'the pressure mounts — the threshold cracks',
    'forged in fire — ready to ignite',
    'the moment crystallizes — no holding back',
    'power builds — the reckoning approaches',
    'the ground trembles — the eruption is inevitable',
    'blades are drawn — the silence before the charge',
    'everything converges — into this single deafening point',
    'the chains are stressed to their breaking point',
    'inhale — because this is the last quiet breath',
  ],
  gospel:  [
    'I feel His spirit moving — can\'t stay silent',
    'the anointing rising — praise about to break out',
    'something holy building — can\'t contain it now',
    'the presence fills the room — about to overflow',
    'walls are coming down — can feel the breakthrough near',
    'the altar is ready — the surrender is coming',
    'tears are forming — the weight is lifting',
    'something sacred moving through these walls',
    'I hear the call — and I\'m answering this time',
    'the chains are loosening — freedom is so close',
  ],
  reggae:  [
    'the rhythm rising — truth is coming through',
    'the vibration building — roots about to speak',
    'something stirring — the message breaking free',
    'one step closer — the liberation song',
    'feel the current rising — time to stand and say',
    'the island breeze carries the change that\'s coming',
    'hear the drums getting louder — the people are ready',
    'the river of resistance is about to overflow',
    'one love building — stronger than the chains',
    'the prophecy is close — I can hear it in the bass',
  ],
  folk:    [
    'something honest building — can\'t hold it any longer',
    'the words are right there — at the edge of saying',
    'the truth is coming — plain and clear and whole',
    'everything I\'ve carried — about to be set down',
    'the song is building — toward its honest end',
    'the story\'s almost reached the part that matters most',
    'the river bends here — and everything looks different after',
    'been walking a long time — the clearing\'s just ahead',
    'one more verse — and the whole truth comes out',
    'the seasons taught me patience — but this moment won\'t wait',
  ],
  punk:    [
    'can\'t hold it anymore — about to let it go',
    'the rage is coming — no stopping now',
    'everything\'s building — about to boil over',
    'one more second — then it all breaks loose',
    'the pressure\'s at its limit — here it comes',
    'sick of waiting — done being polite about it',
    'the fist is raised — the crowd is ready',
    'three two one — forget everything they told you',
    'the system\'s choking — and we\'re the ones pulling the cord',
    'no permission needed — we never asked anyway',
  ],
  kpop:    [
    'the feeling\'s growing — can\'t contain it now',
    'something shining — right at the edge of bursting',
    'the energy building — higher than before',
    'we\'re almost there — the moment\'s almost here',
    'the light is coming — can you feel it too?',
    'the choreography builds — every move leads to this',
    'the crowd is breathing as one — here it comes',
    'all the training — all the tears — for this moment',
    'the key is changing — the elevation begins',
    'hearts synchronized — the beat is about to drop',
  ],
  jazz:    [
    'the night gets quieter — then the piano starts again',
    'something unresolved — building in the blue',
    'the chord hangs there — waiting to land',
    'the room goes still — right before the turn',
    'one more chorus — something has to give',
    'the smoke curls upward — the feeling follows',
    'the bassist nods — we all know what comes next',
    'the silence between notes gets heavier',
    'somewhere in the changes — the resolution waits',
    'the bridge hangs suspended — then finds its way home',
  ],
  electronic: [
    'the frequency building — something\'s about to drop',
    'the signal rising — can you feel the shift?',
    'the beat is climbing — everything about to break',
    'the tension peaks — right before the fall',
    'building — building — almost —',
    'the filter opens wider — the sound fills every space',
    'the sidechain pumps harder — the room becomes the rhythm',
    'higher and higher — the frequency demands release',
    'hands in the air — the drop is seconds away',
    'the breakdown strips to nothing — then everything returns at once',
  ],
  indie:   [
    'the quiet\'s getting heavy — something underneath',
    'right at the edge of saying what I mean',
    'the feeling sits there — growing in the silence',
    'something stirring — too real to push away',
    'the room gets small — the truth gets large',
    'the tape hiss gets louder — like the song knows what\'s coming',
    'I keep rewriting this part — because it\'s the truest thing',
    'the reverb swells — and I stop pretending I\'m fine',
    'the distance between us is one honest sentence',
    'something in the guitar shimmer says what I can\'t',
  ],
  latin:   [
    'the rhythm\'s taking over — no more holding back',
    'the heat is rising — feel it in the beat',
    'something pulling — the body knows before the mind',
    'the music\'s building — right at the breaking point',
    'can\'t fight it anymore — the rhythm decides',
    'the brass is climbing — every step higher than the last',
    'the clave accelerates — the dance demands surrender',
    'the night is young — and the music won\'t let us stop',
    'feel the fire building — from the feet to the chest',
    'the whole room moves — before the chorus even starts',
  ],
  phonk:   [
    'the bass drops lower — the dark is coming in',
    'everything slows down — the weight about to hit',
    'the atmosphere thickens — something sinister building',
    'right at the edge — where the distortion swallows everything',
    'the fog rolls in — and the 808 speaks',
    'the pitch drops — reality bends around the bass',
    'headlights cut through fog — the drift begins',
    'the cowbell echoes — louder each time — closer',
    'something in the rearview — gaining on the beat',
    'the tempo crawls — but the impact is about to be devastating',
  ],
  drill:   [
    'the tension\'s maxed — something about to snap',
    'the block goes quiet — that means it\'s about to be loud',
    'everything still — right before the storm',
    'the pressure\'s building — no one is backing down',
    'cold air — the moment before everything changes',
    'the 808 slides lower — the temperature drops with it',
    'phone buzzing — everyone knows what\'s about to happen',
    'the beat goes hollow — the words about to fill it',
    'the strings come in — eerie and inevitable',
    'no more talk — the bars are loaded',
  ],
  blues:   [
    'the whiskey\'s almost gone — and so is my patience',
    'the guitar bends — one more note before the truth',
    'something heavy moving — slow as a twelve-bar shuffle',
    'the room gets darker — the feeling gets louder',
    'I\'ve been holding this for too long — it\'s coming out now',
  ],
  ambient: [
    'the texture shifts — a new frequency emerges',
    'the space opens wider — something vast approaching',
    'the drone builds — layering meaning upon meaning',
    'the field recording changes — the landscape transforms',
    'dissolving into the next state of being',
  ],
  default: [
    'something building — can\'t hold it back',
    'right at the edge — the moment\'s almost here',
    'everything\'s been leading here',
    'the feeling\'s rising — now',
    'one more breath — then everything changes',
    'no more waiting — it\'s time',
    'the air thickens — the change is seconds away',
    'everything aligns — right here — right now',
    'the quiet before the sound that changes everything',
    'once more — with everything I have left',
  ],
};

function buildPreChorus(rng, genre, songUsed, globalHist, theme, register, genreKey) {
  const pool = PRE_CHORUS_LINES[genreKey] || PRE_CHORUS_LINES.default;
  const fresh = pool.filter(l => !songUsed.has(l) && !globalHist.isDuplicate(l, 0.6));
  const line1 = fresh.length > 0 ? rPick(rng, fresh) : rPick(rng, pool);
  songUsed.add(line1);

  // Second line: try to rhyme with line1 for musical tension before drop
  let line2 = null;
  for (let i=0; i<8; i++) {
    const c = buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey, 'struggle');
    if (rhymesBetter(lastWord(line1), lastWord(c))) { line2 = c; break; }
  }
  if (!line2) line2 = buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey, 'struggle');
  return [line1, line2];
}

// ── 5. HOOK CALLBACK ────────────────────────────────────────
// Verse 2's last line should rhyme with / echo the hook's opening word
// We track the hook's first word after building chorus, then bias verse 2 ending

let _songHookAnchorWord = null;  // set after chorus is built, used in verse 2

function extractHookAnchor(hookLine) {
  if (!hookLine) return null;
  const clean = hookLine.toLowerCase().replace(/[^a-z\s]/g, '').trim();
  const words = clean.split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
  return words[0] || null;
}

function buildVerseWithHookCallback(rng, genre, songUsed, globalHist, scheme, lineCount, firstIsOpener, theme, register, genreKey, arcPhase, hookAnchorWord) {
  // Build normally first
  const lines = buildVerseLines(rng, genre, songUsed, globalHist, scheme, lineCount, firstIsOpener, theme, register, genreKey, arcPhase);

  // Try to make the last line rhyme with the hookAnchorWord
  if (hookAnchorWord && lines.length > 0) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey, arcPhase);
      if (rhymesBetter(lastWord(candidate), hookAnchorWord) || rhymesBetter(hookAnchorWord, lastWord(candidate))) {
        lines[lines.length - 1] = candidate;
        break;
      }
    }
  }

  return lines;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. PRE-WRITTEN LINE POOLS — songwriter-quality complete lines
// 80 lines per genre = 80x79x78x77 = 37M+ unique 4-line verse combos
// before rhyme-anchoring multiplies further. No assembly, no templates.
// Every line written as a finished lyric.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GENRE_LINES = {

  hiphop: [
    "I came up from nothing — no blueprint, no guide",
    "Wrote my first verse by the light of a cracked phone screen at fourteen",
    "Everybody counted me out — I kept the receipts for every single one",
    "Grew up where the ceiling was somebody else's starting floor",
    "They locked the front door so I came back through the window",
    "My mama kept the lights on working a second job and prayer",
    "Started with a dollar and a hunger no comfort ever cures",
    "The block taught me everything four years of school never covered",
    "Every no I got became the octane I ran the engine on",
    "I watched the city swallow my people whole and still came back and built",
    "Fourteen with a notebook full of dreams they called delusion",
    "My name meant nothing to the room — I stayed until the room learned better",
    "Used to watch success from the outside — eventually I stopped watching",
    "Carried the weight of a whole neighborhood in every bar I wrote",
    "Broke doesn't mean broken — that lesson cost me the better part of a decade",
    "I outworked every person in every room I was allowed to enter",
    "Late nights in the studio while the city folded into sleep below",
    "Every dollar I stacked I stacked it slow and deliberate and right",
    "Moved in silence so long the results were the first announcement",
    "Put the work in before the work had any monetary value at all",
    "They saw the highlight reel — they never saw the five years before it",
    "I showed up every single day to something that wasn't paying yet",
    "No shortcuts to where Im going — I mapped every necessary step",
    "Stayed consistent when consistent felt like nothing was accumulating",
    "The craft came first — money is the byproduct of the craft done right",
    "Converted every setback into a specific blueprint for the next attempt",
    "Studied the greats until their instincts became my own instincts",
    "Invested hours into the work while others invested hours into excuses",
    "Grinded in private so the public version looked inevitable",
    "The vision was vivid long before the path to it was clear",
    "I built something real enough to actually leave behind",
    "Now they quote the lines I wrote when I had absolutely nothing",
    "Every room I walk into I remember the rooms they kept me out of",
    "This isn't luck — compound interest on ten years of sacrifice",
    "The crown was never going to be given — I took it piece by earned piece",
    "I turned my name into something they couldn't erase or ignore",
    "My legacy is documented in every verse I touched and meant",
    "The ones who said I wouldn't — I made sure they watched",
    "From a hundred-dollar pre-paid to a stage I built myself",
    "I speak for everyone they never believed would have a platform",
    "My day ones stayed when staying cost them something real",
    "The code was simple — you hold yours and I hold mine and neither breaks",
    "I remember every face present when there was nothing to be present for",
    "Blood or chosen — loyalty is the only currency that doesn't inflate",
    "My circle shrank every time the vision grew — that's the correct trade",
    "I'd rather eat slow with ten real ones than feast fast with a hundred strangers",
    "The ones who never left — I carry them in every bar and every interview",
    "My city is my heart even in the years it actively tried to break me",
    "We came up together — the agreement is we go up together",
    "Real ones don't need a speech — they already understand the assignment",
    "Every syllable is a decision — nothing in a verse is ever accidental",
    "I treat every sixteen like it could be the last sixteen Im given",
    "The pen is the only thing the circumstance couldn't take from me",
    "I let the beat breathe three bars before I say the thing that matters",
    "My flow is the proof of concept — the lyrics are the full argument",
    "Ive been sharpening this craft since before it had a genre name",
    "Every bar Ive dropped is something I lived before I said it",
    "I don't write songs — I write primary-source evidence of where Ive been",
    "The verse is the map of the territory the chorus stakes a flag in",
    "I earn every metaphor — nothing borrowed, nothing stolen, all mine",
    "Summer nights taught me that survival is its own form of genius",
    "The corner we grew up on is the protagonist of everything Ive written",
    "I know every pothole on the route from nothing to something — I drove it all",
    "The city gave generously and then tried to reclaim it with interest",
    "There are streets that shaped me more than any curriculum ever did",
    "Late nights under streetlights — the only audience was the work itself",
    "My city has a language — mine is written in the compound interest of persistence",
    "We were the statistical outcome of a system built to produce that outcome",
    "The zip code was supposed to be my ceiling — I made it the foundation",
    "I turned the soundtrack of struggle into an anthem they couldn't ignore",
    "Generational wealth starts the day someone refuses the inheritance of nothing",
    "Im not building money — Im building infrastructure that outlasts it",
    "My ambition isn't a mood — it's the permanent operating temperature",
    "The goal was never the number — it was the freedom the number represents",
    "I work like the window could close any second because I know it can",
    "Every investment I make, I calculate my children into the equation first",
    "The hustle is a spiritual discipline before it's a financial strategy",
    "I learned early that dreams require concrete infrastructure or they dissolve",
    "From sleeping on the floor to owning what I sleep inside — that's real",
    "The version of success that fits me isn't in any template I was handed",
  ],

  pop: [
    "I kept your sweater in the back of my closet for a full year",
    "You were standing in the kitchen with the whole morning in your hair",
    "I rehearsed goodbye a hundred ways and lost my nerve each time",
    "Something in the way you laugh erases my common sense completely",
    "We were golden in September before everything got complicated",
    "I saved your name under three different contacts just in case",
    "All the breakup songs finally make sense to me now",
    "You apologized for nothing and I forgave you before you finished",
    "Tell me what you're thinking when you go quiet like that",
    "I been chasing that electric feeling everywhere — then there you were",
    "Dancing in the kitchen to a song neither of us could name",
    "Stupid how one song can be a time machine straight back to you",
    "I wrote about you without your name and everyone already knew",
    "The way you say goodnight like you might not mean goodbye",
    "I never said the honest thing — I always said the comfortable one",
    "I don't need the validation — I already know exactly what Im worth",
    "Every version of me Ive been led me here to this one",
    "I stopped asking for permission somewhere around twenty-five",
    "The crown fits better now that I quit apologizing for wearing it",
    "I spent years dimming my light so others wouldn't feel outshined",
    "This version of me took years to earn — she's not going anywhere",
    "I walked away from everything that required me to be smaller to belong",
    "The girl I used to be would barely recognize me now",
    "I burned the parts that never fit and built the rest from something real",
    "I am not the rumors they were spreading — I am the actual truth",
    "Tonight I want to feel like I can't feel anything but all of this",
    "If this is the last good thing I feel then let it have been enough",
    "We could be the kind of story theyre still telling in twenty years",
    "I don't want careful right now — I want to fall completely in",
    "Catch me at the absolute best Ive ever been and hold on",
    "Every light in this city feels like it belongs to us tonight",
    "I finally found the frequency Ive been searching for my entire life",
    "Let's stay until the morning makes it real and undeniable",
    "You make me feel like someone I forgot I used to be",
    "This is the feeling all the love songs kept trying to describe",
    "I drove past your street three times before I let myself go home",
    "Your laugh is the ringtone I never changed even after everything",
    "We were the kind of careless that only happens when you're twenty-two",
    "I found your name in a playlist I said I deleted",
    "Something in the chorus of that song still makes me catch my breath",
    "The version of us in those photos — I understand why I keep them",
    "You were the beautiful mistake I keep somehow learning from",
    "I had the whole speech prepared and lost it when I saw your face",
    "We could keep pretending this is nothing if you need to",
    "The thing about almost-love is it almost doesn't hurt — almost",
    "I made my peace with ordinary living — then you showed up",
    "There's a whole category of feeling that only has your name",
    "I thought I was over you until I suddenly wasn't — classic",
    "All the plans I made for someone else fit you so much better",
    "I told everyone I was fine and meant it up until tonight",
    "Standing in the kitchen at midnight missing something with no name",
    "Every city I visit I look for somewhere we could have gone together",
    "You are the reason certain songs still land harder than they should",
    "I want the version where we both say yes at the exact same time",
    "We built something impossible and then managed to make it real",
    "The light through the curtains and your coffee going cold — that was everything",
    "I keep the ticket stub from that first show in my old coat pocket",
    "Whatever comes after this Im glad this version of me got to exist",
    "Tonight feels like the kind of night that gets remembered for years",
    "I want to give you the version of me Ive been working on",
    "The universe did a lot of specific work to put us in the same room",
    "I know the exact when — that Wednesday in October after the rain",
    "You didn't rescue me — you made it possible for me to rescue myself",
    "I want the simple version — just us, just this, just here",
    "Every song I love sounds different since I met you",
    "I used to think I was complicated — I just hadn't found my match",
    "Something shifted the moment you walked in and I registered it",
    "Let's make the kind of memory that survives every hard year after",
    "The thing about a good thing — you know it before you name it",
    "Ive never been more willing to be wrong about tomorrow",
    "You are the unexpected answer to a question I forgot I asked",
    "I stopped keeping score the day I realized it was never a competition",
    "Every version of tomorrow I imagine has you somewhere in it",
    "I want to know every ordinary Tuesday you've ever had",
    "Whatever this is — I want more of it than Im supposed to say",
    "I put the album on and let it play until it means something new",
    "You make the reckless version of me seem completely reasonable",
    "I came with no expectations and now Im reconsidering everything",
    "The world kept moving the way it does and we just stayed still",
    "Something about the way you say goodnight still hits like a first time",
  ],

  rnb: [
    "It's three AM and you're still the loudest thought in my head",
    "Ive been drafting that message and deleting it for a week straight",
    "You apologized for something you didn't do and I forgave you anyway",
    "I don't do this — I don't open up — and here I am completely open",
    "Every conversation we had plays back on a loop I can't turn off",
    "My friends say let it go and theyre right and I physically can't",
    "I keep writing the message and closing the app without sending it",
    "There's a version of last night I keep returning to for the answer",
    "I was doing fine at being closed until you opened something quietly",
    "Tell me what this is because I don't have a name for it yet",
    "Something about your presence rearranges the furniture inside me",
    "I didn't plan for you — that's the specific thing that gets me",
    "You made an ordinary Tuesday feel like something worth preserving",
    "You showed up quiet and changed the temperature of everything",
    "I keep the lights low so I don't see the empty side of the bed",
    "Real love doesn't announce itself — it just keeps showing up",
    "The thing about desire is it doesn't schedule itself or ask permission",
    "Ive been most honest with you at two in the morning",
    "You know the version of me nobody else in my life gets access to",
    "I kept your last voicemail — I play it on the nights I need it",
    "You healed parts of me I'd stopped believing were healable",
    "I learned what safety felt like the first time I was with you",
    "Every scar I carry you've held without flinching",
    "You didn't fix me — you stayed while I fixed myself",
    "Ive loved before — nothing that felt permanent and structural like this",
    "You are the reason I believe in giving it one more honest try",
    "There are things I couldn't say out loud — I tried to sing them instead",
    "My heart has been a door for years and you just walk right through it",
    "You are the quiet that arrives after every storm Ive been through",
    "I wrote this at the exact point of no return and didn't look back",
    "I know the moment I stopped pretending this was casual between us",
    "You showed up understated and rearranged everything without asking",
    "There's a silence with you I keep wanting to return to",
    "I didn't plan for any of this — that's what makes it feel real",
    "Every time I think my guard is back you walk in and reset it",
    "You know me at the unglamorous hour and chose to stay",
    "The most intimate thing you did was listen without trying to fix it",
    "I want to love you in the quiet hours when the world isn't watching",
    "Every disagreement we had was us learning the shape of each other",
    "I found the version of safe I'd given up on finding — that was you",
    "You love me in the morning before Ive earned it — that's the miracle",
    "The way you remember the small details — that's the love language I needed",
    "Ive never been so willing to be this completely seen",
    "You are the specific warmth all the poetry was always trying to describe",
    "I keep all your voice notes — I play them when the alone gets loud",
    "You stayed through the version of me that was hardest to stay through",
    "I trust you with the parts I spent years building walls to protect",
    "After everything Ive been through you make me believe in trying",
    "You are the resolution of a tension Ive been carrying for years",
    "I want the Sunday mornings and the difficult Tuesdays — all of it",
    "Something about your presence makes the hard things slightly smaller",
    "You didn't complete me — you reminded me I was already whole",
    "I love you most in the ordinary moments when you don't know Im watching",
    "We built this slowly and carefully and it's the best thing Ive made",
    "You make vulnerability feel less like exposure and more like connection",
    "The specific way you hold my face — I memorized it without trying",
    "I want to know all the versions of you that came before I did",
    "We talk about everything and nothing and both feel like the same gift",
    "The line between needing and wanting you disappeared somewhere",
    "You are the reason I softened the hard edges I'd spent years building",
    "I catch myself thinking about you at the most inconvenient moments",
    "Every song I write is trying to say something you already know",
    "The hardest part of loving you is being worthy of how you love back",
    "I want to be the person you come home to after every hard thing",
    "You taught me the difference between being loved and being truly known",
    "Ive been most alive in the moments I stopped protecting myself",
    "You are not what I planned for — you're better than what I planned for",
    "The way we disagree and come back — that's what I was looking for",
    "I chose you the first time — I keep choosing you every day after",
    "You are the steady thing inside every season that tries to shake me",
    "I want to grow old enough to understand the full depth of loving you",
    "This is the love I wrote about before I knew it was real and possible",
    "I give you the parts of me I don't show anyone else in my life",
    "We are the proof that something this good can actually be sustained",
    "You found me at the worst time and made it into a reason to stay",
    "I spend my most honest moments trying to be worth your consistency",
    "The grace you extend without conditions is the whole lesson Im learning",
    "I fell in love with the way you forgive before the apology is finished",
    "Every corner of this life feels safer with you in the same world",
  ],

  country: [
    "I drove a thousand miles just to find my way back to that gravel road",
    "Same old oak tree in the yard that watched me grow up and leave",
    "There's a quiet that only the front porch of your hometown provides",
    "Daddy used to say the land will always call you back — he was right",
    "Friday nights still carry leather boots and static country radio",
    "Small-town living isn't everybody's calling but it's always been mine",
    "Church bells on a Sunday sound like everything Ive lost and found",
    "My grandfather worked this ground and left it better than he received it",
    "I left here with ambitions and came home with something better — truth",
    "The honky-tonk still runs the same songs on the same jukebox",
    "Third generation on this land and the soil still remembers every one of us",
    "I don't need the whole world — just this road and someone to share it",
    "The hymn at the funeral was the one he'd sung me to sleep with at five",
    "Rain on a tin roof is the only lullaby that ever settled me down",
    "My grandmother stretched a single dollar into a week of dignity",
    "She's got her mother's eyes and every ounce of her daddy's stubborn will",
    "We fell in love one summer when the cornfields were running gold",
    "Baby let's take the long way through every back road and open field",
    "In a world that won't slow down you're the reason I do",
    "I'd trade every city skyline for the view from our back porch at sundown",
    "Some things about the hometown never change — thank God for all of them",
    "We built this life deliberate and slow the way a house is built to hold",
    "Front porch evenings are the only luxury Ive ever genuinely wanted",
    "I'll never need more than this — cold beer, good dog, and you right there",
    "The kind of love that shows up in the quiet unremarkable ordinary moments",
    "We buried him in October when the leaves were at their most honest turning",
    "She left a note beside the coffee maker — her mind was made up",
    "The storm took the barn but it couldn't take the family from the farmhouse",
    "Lord knows Ive been lower than the lowest water this creek has run",
    "Hard years teach you things the comfortable ones simply cannot",
    "The land holds memory — the good seasons and the lean ones both stay",
    "I stood at the crossroads of the life I had and all I could become",
    "I thought leaving was the answer until I understood the question",
    "You can leave a hometown but the hometown never releases you",
    "Some losses hollow out a space shaped exactly like a specific person",
    "We put the kids to bed and sat outside till the fireflies found us",
    "I got my mother's stubborn heart and my father's easy laugh",
    "Barefoot in the garden before the summer heat sets in for good",
    "There's a jar of lightning bugs in a memory I'll never let go of",
    "I learned more about character from one hard winter than a lifetime of ease",
    "The county line is where the city's empty promises stop meaning anything",
    "She left him on a Friday and he played guitar all weekend on the porch",
    "Some people need the ocean — I need this creek and this particular quiet",
    "The garden teaches patience in a way nothing else ever has",
    "We didn't have much but the table was full and Sunday always happened",
    "The old truck still runs because he kept every part himself over the years",
    "Barefoot summers and the tire swing over the swimming hole — that was everything",
    "I measure a good life in sunsets from the back porch of my own place",
    "First snow of winter falls and the farm gets a silence you can lean into",
    "I drove the back roads until I found the version of myself I'd set aside",
    "Dirt roads and distant summer lightning — that was the season I grew up",
    "Some people find God in cathedrals — I find Him standing in an open field",
    "The front porch is the only therapist this county has ever really needed",
    "I am made of the same soil that made every generation before me",
    "A roof, a fire, and someone you love at the end of the working day",
    "Ive been wrong about a lot — the small things were always the whole thing",
    "I will carry this guitar until I can't and then I'll pass it on",
    "Faith is what you hold when the harvest fails and you still plant again",
    "The kind of tired that comes from working your own land is a gift",
    "I'll take the beauty of a hard season over the easy kind any day",
    "We don't lock the door because the neighbors are the whole security system",
    "First light on a working farm is a cathedral with better acoustics",
    "My grandfather said the land will tell you what it needs — just listen",
    "The almanac was right about the frost and wrong about the heartbreak",
    "Two steps and a spin and suddenly we're twenty again in that old barn",
    "The cattle understand the weather better than any forecast Ive seen",
    "She can read the sky better than any app Ive ever downloaded",
    "The creek flooded in ninety-eight and we rebuilt — that's just what we do",
    "This land is the longest love story in our family's whole history",
    "We danced in the driveway to the radio because that's what we had",
    "The old barn has names carved in the wood from before my time",
    "Nothing prepares you for the day the land you grew up on gets sold",
    "She kept her mother's recipe box — that's the whole inheritance I needed",
    "Every pickup truck Ive owned has known the weight of grief and hope",
    "I stay because staying is the most honest thing Ive ever done",
    "There's a version of home that only lives inside a specific summer",
    "I am the person this land made — and Im proud of every part of that",
  ],

  rock: [
    "We were never built to whisper and we are not about to start",
    "Every wall they built around us weve been tearing down for years",
    "There's a truth inside the feedback that no sermon ever touched",
    "I found my congregation in the loudest room Ive ever stood inside",
    "Three chords and the nerve to say the thing they spent years walling off",
    "They built boxes to contain us — we were born without those shapes",
    "I was seventeen with a guitar and an anger that finally had a form",
    "The music said you're not alone before anyone in my life did",
    "In the pit with strangers I have never felt less like a stranger",
    "Turn it up until the neighbors know exactly what this is made of",
    "Standing in the wreckage of the life I almost made a different choice in",
    "I found the most honest version of myself inside the loudest rooms",
    "Every scar is a map coordinate to somewhere Ive been and didn't break",
    "We don't ask for easy — we ask for something real enough to hold",
    "The guitar says what Ive always felt and never found language for",
    "Born into a city working hard to teach me how to be small",
    "I poured the whiskey out and found the music waiting in the sober dark",
    "Something in the noise cuts through to exactly where it hurts",
    "I remember when this music caught me at the lowest I had ever been",
    "We are every basement show and every stadium that came after — all of it",
    "We're still here — that's the entire statement — we are still here",
    "Give me feedback give me distortion give me something with truth in it",
    "This is not performance — this is the only way I know how to pray",
    "Ive felt most alive inside the rooms built from the loudest walls",
    "The songs we screamed together — that's the only church I ever needed",
    "Stand up in the wreckage and find the ones who still know your name",
    "We were built for this — the noise, the night, the stage, the crowd",
    "Everything they said would stop us just made us louder",
    "I don't want the quiet version — I want the one that shakes walls",
    "All we ever had was three chords and something honest enough to say",
    "Ive been sleeping in vans and playing rooms of twelve and meaning it",
    "The road is the best and worst teacher you can find at any price",
    "Every city has left something in my hands Im still carrying forward",
    "The stage is the only place Ive ever been completely unafraid",
    "Ive played this song in forty cities and it means something new in each",
    "The venue smells like effort and I will miss it every day after",
    "We built this band on borrowed gear and a specific stubborn faith",
    "The crowd that shows up to the opening slot at nine — those are the real ones",
    "I learned everything about performance from shows that paid nothing",
    "The riff arrived at midnight and I played it until the neighbors complained",
    "This song was born in the worst year of my life and it carries that weight",
    "I poured every unsayable thing into the bridge and let the bridge carry it",
    "The crowd knows the lyrics better than they know their own address",
    "Rock and roll is just the truth at a volume that demands acknowledgment",
    "Every compromise I chose not to make is somewhere in this guitar tone",
    "The song found me — I just showed up with the instrument at the right time",
    "I write about the dark so the people in it know that someone sees them",
    "We are the children of everyone who played too loud and genuinely meant it",
    "I don't care about chart position — I care about the room being full",
    "I am not performing — I am converting pain into something shareable",
    "The guitar was the first thing in my life that ever talked back honestly",
    "Every great rock song was written by someone who had no other option",
    "I will play this song forever because it keeps arriving at new meaning",
    "The music business tried to polish us — we came out more ourselves",
    "The road was hard and the shows were real and I'd do every night again",
    "Four people in a van becoming one sound by the time the tour is done",
    "Ive chased the feeling of the first time I heard it played live ever since",
    "The drummer found the pocket and the whole band found its reason",
    "We play until the monitors feedback because that's where the truth lives",
    "Nothing corporate ever walked through that backstage door",
    "I learned that the small rooms are where you find out what you're made of",
    "The fans who memorized the B-sides — those are the ones that kept this alive",
    "We rewrote the set list at soundcheck and played the best show of the tour",
    "The encore isn't gratitude — it's the agreement to stay a little longer",
    "Every album is a document of who we were in that particular year of our lives",
    "I came home from tour different every single time and grateful for it",
    "The silence before the first note is the whole setup for everything after",
    "We don't chase the mainstream — we let it come find us eventually",
    "A song that saves one person in the room has done everything it needs to do",
    "The guitar holds what the human voice is too controlled to say",
    "I remember the first time I heard feedback and thought — that's the feeling",
    "Some nights the band is one organism and those are the nights worth everything",
    "We built something that outlasted every trend that surrounded it on the way up",
    "The audience taught me what the song was actually about — they always do",
    "I came to rock and roll because nothing else in my life told the truth",
  ],

  metal: [
    "From the abyss I rose and will rise again when the abyss reclaims me",
    "The empire built on silence falls the loudest in its final hour",
    "Stare into the void long enough and the void acknowledges the staring",
    "We were forged in fire and the fire never left our blood completely",
    "Every chain they wrapped around us made us stronger in the breaking",
    "The gods of order built the cage — we were born without those shapes",
    "In the darkness there is a clarity that daylight never grants anyone",
    "We do not bow — we do not kneel — we are what they built their fear from",
    "Blood and iron — the actual foundation beneath the comfortable surface",
    "The ancient ones are watching from the threshold between everything",
    "The warrior does not choose the war — the war performs its own selection",
    "Every empire that declared itself eternal learned the identical hard truth",
    "We are the consequence of everything they buried and tried to forget",
    "The storm that breaks the mountain is the same storm that makes the legend",
    "Rise — not despite the darkness — but in direct response to it",
    "What shatters you is the same thing that reveals what was underneath",
    "The blade arm extends no mercy when the mercy supply has been depleted",
    "There is a dignity in the darkness the comfortable will never locate",
    "Descend into the honest dark and name what you encounter waiting there",
    "We carry the accumulated fury of a thousand years in every note we play",
    "The machine eventually consumes its makers — they simply build more machines",
    "What remains when the last comfortable illusion is fully stripped away",
    "The cathedral burned and everyone was occupied elsewhere — metaphor complete",
    "Beneath the weight of what weve built lies everything we tried to bury",
    "The void makes no judgments — it accepts only what is offered willingly",
    "Every structure erected on lies collapses from the center outward always",
    "The storm does not apologize for what it removes from the landscape",
    "Every mountain is a patience the valley has been waiting centuries to witness",
    "Stars that died a million years ago still provide the light we navigate by",
    "Everything alive is temporary — even the stone is only temporarily stone",
    "The earthquake is the planet correcting an imbalance it has been patient about",
    "I have been the monster they required and the saint they couldn't sustain",
    "Every mask Ive worn was a negotiation with what they wanted me to be",
    "The authentic self is the most dangerous thing — which is why it gets suppressed",
    "I am the sum of every force that tried to destroy what I actually am",
    "The fire that was supposed to purify left exactly what should remain",
    "Every system of control depends on the controlled accepting its necessity",
    "I found the frequency that no authority has the technology to jam",
    "I am not what was made of me — I am what I made of what was made of me",
    "The loudest protest is the one that involves refusing to disappear",
    "The sword of what was promised hangs above every comfortable arrangement",
    "We are the inheritors of every unfinished revolution in this long history",
    "The legend is not made in the triumph — it's made in what preceded it",
    "Every scar my body carries is a chapter the comfortable version omits",
    "We built this cathedral of sound from materials they called unusable",
    "The riff that opens this song is the sound of something being reclaimed",
    "We play at this volume because the truth at this volume demands it",
    "Every note is load-bearing — remove it and the whole structure collapses",
    "I have stood at every threshold of the impossible and found it crossable",
    "The monument we leave will be made of the same material as the journey",
    "There are no clean endings in this genre — only transformations",
    "The walls of this amphitheater are built from the screams of the righteous",
    "We came here tonight to make the kind of noise that doesn't apologize",
    "Every downtuned string carries the weight of something that needed saying",
    "The breakdown is not destruction — it is deconstruction for rebuilding",
    "I found my people in the darkest corners of every city on this tour",
    "The pit is not violence — it is the body finally speaking its own language",
    "We were the strange kids who became the ones everyone else needed",
    "The album cover warned you and you came in anyway — I respect that",
    "Heavy music for heavy times — we have never had more material to work with",
    "I play every show like it might be the one that changes someone's life",
    "The genre doesn't need defending — it needs playing as hard as possible",
    "We don't make music for everyone — we make it for the ones who need it most",
    "The distortion is not noise — it is the most honest signal available here",
    "Every blast beat is a conversation with chaos that ends in control",
    "I found grace inside the heaviest music I have ever heard — go figure",
    "The solo is not showing off — it is the final argument of the whole song",
    "We stand on the shoulders of everyone who played too loud before us",
    "The mosh pit remembered what the classroom forgot about human community",
    "I have been healed by decibels more than once — science will catch up",
    "Every tuning drop is a decision about the weight this music needs to carry",
  ],

  indie: [
    "I drive the long way home in October just to feel the particular light",
    "There's a version of this story where I said the right thing first",
    "You exist in my apartment in the objects that stayed behind",
    "Something about November still takes me back with unreasonable precision",
    "I kept the specific things — the grand sweeping ones all dissolved",
    "We were good at silence in the spaces between actual sentences",
    "All the songs I identified with at twenty-three still apply completely",
    "I don't need the drama — just that particular Tuesday afternoon",
    "There are feelings that only exist inside very specific qualities of light",
    "I know the record playing when I realized I was already inside it",
    "Something changed and I wasn't paying enough attention to notice when",
    "My therapist says stop collecting small details — the details are the whole thing",
    "I was fine at being closed until you opened something quietly",
    "The grand sweeping feelings always felt slightly too large to live in",
    "Ive been most real inside the half-lit unremarkable Tuesday afternoon",
    "You are the particular detail I return to every single time",
    "In a life of general impressions you became the specific that rhymed",
    "It was not dramatic — it was quietly everything all at once",
    "I know precisely what I lost — I just don't have a name for it yet",
    "The hardest feeling is the one that doesn't have an existing word",
    "I kept the ordinary moments and released the extraordinary ones",
    "Your handwriting on a grocery list is the most you thing I have left",
    "The apartment still remembers you in the ways the body does",
    "Ive been returning to one specific afternoon for three consecutive years",
    "Some things don't resolve — they become part of the permanent frequency",
    "There's a word in Portuguese for exactly this — nothing in English works",
    "I am assembled from every place Ive left a version of myself behind",
    "The version of us in that October was worth every complicated thing after",
    "I don't know when the feeling shifted — I only know it did",
    "Still — somehow — the particular detail of you — after everything",
    "There's a Tuesday Ive been living inside for three consecutive years",
    "I kept the grocery list you wrote — your handwriting is the most you thing",
    "I think about that September afternoon more than is probably reasonable",
    "Something in the light at four in the afternoon in October still undoes me",
    "You were the footnote that eventually became the central argument",
    "I have been returning to one conversation for the better part of a decade",
    "The ordinary is where everything that actually matters always happens",
    "I know the exact playlist when it became something irreversible",
    "There are feelings that only exist in the presence of a very specific light",
    "I have been most honest in the unremarkable middle of ordinary things",
    "You are the detail I remember when Ive forgotten everything surrounding it",
    "Some things stay specific even after all the context has dissolved",
    "I am made of every apartment Ive ever left a piece of myself inside",
    "The song comes on and suddenly Im the previous version of myself again",
    "We were better in the small moments than we ever were in the large ones",
    "I keep the physical evidence of things Im theoretically supposed to release",
    "You are not a metaphor — you are a specific person in a specific chair",
    "The feeling lives in the particular — never the general — always",
    "Ive been most moved by the things that happened between the events",
    "The ache isn't specifically for you — it's for the version of me you knew",
    "Ive been cataloguing the small things since before I understood the impulse",
    "Something about the way autumn arrives still feels like a beginning",
    "The record plays and the apartment carries the smell it had back then",
    "I loved you the way you love a place that is also a feeling",
    "I am most completely myself in the hour before anyone else wakes up",
    "You are in every coffeeshop song that's ever made me feel understood",
    "The specific weight of a Tuesday in November is severely undervalued",
    "I wrote this in the margin of something I was supposed to be reading",
    "We were in love the way people are before they know theyre in it",
    "I miss the version of you I knew before either of us became so careful",
    "The city looks the same but I see a completely different city now",
    "Ive been writing the same feeling differently for five consecutive years",
    "You are the reason certain songs still function as a time machine",
    "I found a ticket stub in a jacket pocket and lost the whole afternoon",
    "Something about the quality of light at the end of a November afternoon",
    "We were good at the kind of quiet that makes other people uncomfortable",
    "I know the exact temperature of the room where everything changed",
    "There is an accuracy to the specific that the universal can never match",
    "I have loved things the way you love them when you know theyre ending",
    "The feeling arrives without permission and leaves on its own schedule",
    "I think about that afternoon more than I think about most whole years",
    "You exist in the shape of the space where you used to sit in this apartment",
    "Some albums work like a compass — they point back to who you were",
    "The bittersweet is the richest flavor and Ive always suspected this",
    "Ive been keeping receipts of ordinary moments — theyre the real ones",
    "Some things become more meaningful the longer you don't talk about them",
    "I found you in the footnotes of a year I was trying to get through",
    "You became essential so quietly I didn't notice the dependency forming",
  ],

  jazz: [
    "The piano knows the things I refuse to say through any other instrument",
    "In the small room after last call when only the most honest people remain",
    "Bourbon in a short glass and all the ghosts who've kept me company",
    "The trumpet weeps for things it never found language adequate for",
    "Late at night the city shows its softer and considerably sadder face",
    "There's a table set for one in every city Ive ever played in my life",
    "I play these songs for the heartbroken and I mean every single note",
    "Some people find the sacred in churches — I find mine between the changes",
    "The melody knows what the lyrics are too disciplined to say directly",
    "She left a note beside the coffee maker one Tuesday in October",
    "Ive been carrying this feeling since before I had the chord for it",
    "The blues is nothing but the truth with nowhere left to conceal itself",
    "All the love songs ever committed to record — not one prepared me for this",
    "There is beauty in the sadness when the sadness has been genuinely earned",
    "Late-night conversations with the people Ive outlived in memory",
    "I understand the standards now in ways I was unable to at the start",
    "The standard plays and in it I can hear my whole biographical record",
    "Every city has a corner bar that knows precisely who you actually are",
    "Ive been playing these songs for thirty years and they still fit perfectly",
    "The silence after the final note holds the whole performance inside it",
    "One more for the road and then another for the road before that one",
    "The arrangement carries everything the lyrics have refused to carry alone",
    "I let my fingers find the truth before my mind can locate it",
    "There's a conversation happening between the bass and the piano quietly",
    "Some nights the music plays me harder than I play the music",
    "The chord progression tells a story my life confirmed too late",
    "I learned the changes and the changes learned what made me break",
    "Between the notes is where the real feeling lives — in the breathing space",
    "The musicians know each other now the way only music teaches that",
    "Every night a different room but the same blue feeling at the end",
    "The trumpet said the thing the room had been carefully avoiding all evening",
    "There's a melody that knows the shape of every heartache Ive carried",
    "I learned the standards completely — the standards taught me something back",
    "The piano says the thing the lyrics are too disciplined to say",
    "The bassist understands what you're feeling before you finish the phrase",
    "There's a dignity in the cigarette-smoke sadness of this particular bar",
    "Ive played this ballad in a hundred different rooms and meant it each time",
    "The way the rhythm section breathes as one — that is the complete education",
    "I played for the old man in the corner who never once looked up",
    "Sometimes the most moving thing is the specific note you choose not to play",
    "Every musician Ive played alongside has left something in my hands",
    "The chord change at the end of the bridge — that's where the truth lives",
    "I learned to bend the note the way a sentence bends toward its feeling",
    "After forty years I still find something entirely new inside the standard",
    "The accompanist understood the song better than the soloist did",
    "We played it slow because fast was just the means of escaping the feeling",
    "I spent years learning the changes — the changes taught me to listen",
    "The solo is a conversation with everyone who's ever played this room",
    "I play from the gut when the intellect runs out of interesting things",
    "Every night hoping to find the version of this I haven't played before",
    "The room is almost empty and the music is better for the intimacy",
    "Ive never played the same song twice even when the notes were identical",
    "The blue notes are the ones that tell the complete biographical truth",
    "There is a generosity in jazz no other form fully manages to replicate",
    "I learned to hear the space between notes as the location of actual music",
    "The standard is the container — what you pour in is the living art",
    "She came in at the second chorus and the room completely reorganized itself",
    "Ive been chasing that one perfect take since I was twenty-three years old",
    "The rhythm section is the foundation — the soloist is the conversation above",
    "In this music the heart is the instrument and the instrument is the heart",
    "I play what I know and what I know is everything this life has given me",
    "The bridge is where honest musicians go when the verse gets too easy",
    "I have played through grief and joy and most things in between this way",
    "The modal jazz opened a door Ive been living on the other side of since",
    "Every improvisation is a conversation with everyone who came before me",
    "I followed the melody into a room I'd never been in before — and stayed",
    "The drummer counted us in and the whole room agreed on something",
    "I play better when Ive given up trying to play perfectly",
    "Late night is the only honest time in any city for music like this",
    "I understand now what the songwriter meant — took thirty years to get there",
    "Every standard holds a room full of ghosts who played it before me",
    "The audience that knows when to hold their breath — those are my people",
    "I came back to this song after ten years and it had grown while I was gone",
    "The resonance of a note played in an old room is its own kind of history",
  ],

  blues: [
    "I woke up this morning with your name still on my tongue",
    "The highway calls me southward when the city gets too heavy",
    "She left me on a Tuesday — didn't even specify which Tuesday",
    "The good Lord gave me heartache and He gave me these two hands",
    "Ive been down so long the bottom's starting to feel familiar",
    "My father played slide guitar on Saturday nights and that was our church",
    "Trouble found me early and never quite learned how to leave",
    "Lord send down some mercy because the mercy's been running thin",
    "I don't need your pity — I just need twelve more honest bars",
    "The river doesn't pause for the suffering of one particular man",
    "I stood at the crossroads at midnight and stared it all the way down",
    "The guitar says the truth the mouth is too proud to say directly",
    "Every scar this body carries is a chapter with a specific name",
    "People wonder how I keep playing with these heavy tired hands",
    "The blues is not depression — it's the honest truth about the human heart",
    "I played for tips at the juke joint every Friday of my life",
    "Robert Johnson played it honest and it killed him — I understand that",
    "My father played harmonica on the back porch after every rain",
    "There's something almost holy in the way hurt can make you sing",
    "I don't play for the applause — I play for the three people who know",
    "Even the lowest low eventually tires of being the floor",
    "The slide guitar says everything that talking never could",
    "Ive been most honest in the moments of the sharpest pain",
    "Some days the only medicine is twelve bars and a little time",
    "The blues taught me every feeling has its proper sound",
    "Ive been broke and Ive been broken and I know which is worse",
    "The song remembers what the memory has started to forget",
    "Everyone carries a burden — the blues is your burden singing back",
    "Pick it up and play it — give the feeling somewhere honest to go",
    "After all these years I still find new ways to fully mean it",
    "I played harmonica on the levee while the river claimed the season",
    "Got the blues so bad this morning the coffee went cold in sympathy",
    "My grandfather played the twelve-bar truth on a juke joint floor",
    "Every great blues musician is a human being with nothing left to hide",
    "Ive been low before — the floor and I have a long relationship",
    "The delta taught me you can turn trouble into something beautiful",
    "When the hurt is honest enough it starts to sound like music eventually",
    "I played that song for strangers and we all became the same briefly",
    "The blues is not complaint — it's complaint elevated into art",
    "I know the weight of a guitar case at three AM after a bad show",
    "Every blues musician is telling you the truth — the trick is believing it",
    "The turnaround at bar twelve is where the whole human story lives",
    "I learned this from a man who learned it from whoever invented pain",
    "There's a dignity in singing about heartache that self-pity never has",
    "The open tuning on a resonator is the sound of honest American grief",
    "I follow the twelve-bar form because it's the most honest shape I know",
    "The boogie woogie left hand is the heartbeat of the whole tradition",
    "I don't play what sounds right — I play what feels completely true",
    "The blues came from the field and found every city with a stage",
    "You cannot fake the blues — the blues has a very good eye for it",
    "I play with my whole life behind every note because the notes demand it",
    "The shuffle feel is the conversation between the living and the gone",
    "Ive sung these songs since before I understood what they were about",
    "The slide on the string is the cry the voice is too proud to make",
    "Muddy Waters electrified the delta and the whole world felt the shock",
    "Every juke joint I played was a cathedral of a different denomination",
    "I bent the note until it said the shape of the feeling without a word",
    "The blues asks only for honesty and returns it in three-four time",
    "Ive been playing this progression forty years and it hasn't run out",
    "The best blues musicians make the difficult sound inevitable",
    "I play slow when the feeling is deep because fast is just an escape",
    "Every note I choose is a word in a language older than any I was taught",
    "The twelve-bar is the most democratic structure in the history of music",
    "I let the guitar cry because the blues requires a witness to the feeling",
    "They called it the devil's music — the devil has better taste than they thought",
    "The shuffle rhythm is the heartbeat underlying all American music",
    "I learned from records by the light of a transistor radio late at night",
    "The bottleneck says the unsayable with perfect acoustic accuracy",
    "My father played blues and his father before him — I inherited the form",
    "The chorus comes back around because that's what grief consistently does",
    "I measure every blues performance by the truth-to-note ratio inside it",
    "The story has no resolution because some stories don't — they deepen",
    "Ive played for rooms of three and rooms of three thousand with equal need",
    "The blues is not sadness — it is sadness given a proper home to live in",
    "Every bent string is a small prayer for the person listening to it",
    "I play for the people in the back who came with something to set down",
    "The blues taught me suffering and beauty are not opposites at all",
    "I follow the feeling wherever it leads in the music — always feeling first",
    "The twelve-bar form holds more human truth than most novels Ive read",
  
    "The twelve-bar form holds more human truth than most novels I have ever read",
  ],

  gospel: [
    "I was lost before Your mercy came and found me in the dark",
    "Every morning I wake up Your mercies are waiting completely new",
    "In the moment I had nothing left to give — grace was still enough",
    "I have stood inside the valley and You were still right there with me",
    "All the chains that held me were broken by the power of Your name",
    "I don't deserve the love You give — that's the miracle I live in",
    "You spoke the universe into being and You know me by my name",
    "Before the dawn the darkness has its longest and most difficult moment",
    "Every prayer I prayed in silence — You were listening every time",
    "I bring my broken pieces to the altar and You make them whole",
    "Holy is the name above every name Ive ever known or spoken",
    "How great is the God who meets me where I am and takes me higher",
    "Let everything that has breath praise the name that gave it breath",
    "I raise my hands because the words ran out — this is all I have",
    "The presence of the Lord is not a feeling — it is a fact I stand on",
    "I have seen His hand at work in ways I cannot fully explain",
    "Your grace is not an abstraction — it is the ground beneath my feet",
    "I will spend what's left of living learning how to say thank You",
    "Heaven touched the earth the day You stepped into my story",
    "The same God who made oceans made a way for me to stand",
    "I stopped asking God the why and started asking what comes next",
    "Faith is not the absence of fear — it is moving through the fear",
    "When the night is long and morning feels impossible — You hold me",
    "I remember every time You brought me through the storm before",
    "In the fire of every trial You were never absent for a moment",
    "I am not the product of my circumstances — I am the product of His promise",
    "I am held by something larger than the things trying to take me",
    "The same voice that called light from darkness calls specifically to me",
    "Every scar I carry is a testimony waiting to be told",
    "I will praise through it — that is the full discipline of faith",
    "The altar call I answered changed the whole direction of my living",
    "Every morning mercy finds me before I have a reason to deserve it",
    "The congregation sang it back and suddenly I understood the song",
    "I knelt in the last pew and felt something shift that hasn't shifted back",
    "You are the same God who parted every impossible sea before this one",
    "Faith is not the comfortable feeling — it is movement directly through fear",
    "He meets me in the valley with the identical grace as on the mountain",
    "I have prayed through the night and watched the morning answer every time",
    "The testimony is the evidence and my whole life is the testimony",
    "I will praise before the breakthrough because praise is the breakthrough",
    "The Word that spoke the world spoke my name in the same voice",
    "I have been held by a grace larger than the sum of all my failures",
    "Every scar is a miracle wrapped inside a very hard story",
    "My grandmother's prayers are still working on my behalf today",
    "The spirit fell in the second hour and the whole room knew it",
    "Every valley Ive walked through prepared me for this mountain",
    "I sang this in the darkest hour and the darkness heard and left",
    "The grace that found me wasn't looking for someone deserving",
    "His mercies are new every morning whether or not Im ready",
    "I have been in rooms where the presence was so thick you could lean into it",
    "The church raised me when the world tried to break me — that is everything",
    "I bring my doubt and my faith to the same altar — He receives both",
    "The breakthrough doesn't announce itself — you recognize it only after",
    "I sang through the grief until the grief became a different kind of feeling",
    "There is no testimony without the test and I understand that now",
    "Every person who prayed with me when I had nothing is a miracle I owe",
    "The Holy Spirit in the room is not an idea — it's the most present thing",
    "I am not defined by what tried to destroy me — I am defined by who kept me",
    "My faith is not a comfort — it is the most demanding thing I carry",
    "The anointing makes the impossible look like a different kind of possible",
    "I serve a God whose strength is most visible in my weakness",
    "I will stand in the fire if He's in the fire — Ive seen this before",
    "Every generation of my family has needed a miracle and every one received",
    "The praise breaks the chains that the petition couldn't reach",
    "I am not afraid of the storm because I know who walks on water",
    "The sanctuary is wherever Im kneeling — He meets me there",
    "My worship is not performance — it's the honest response to being kept alive",
    "I found peace that passes understanding at the bottom of my hardest year",
    "He didn't promise the storm wouldn't come — He promised to be in it",
    "The hymn they sang when I was five still reaches me the deepest",
    "Every season of my life confirmed what the first season tried to teach",
    "Faith is the substance of the things Im still waiting to see",
    "The testimony of His faithfulness is the inheritance I leave my children",
    "I am living proof that the God of the impossible is still in operation",
    "Something lifted in that service and everyone in the room felt it go",
    "I have never praised my way through a season and come out worse — never",
    "The God who sees sparrows saw me in my smallest and most hidden moment",
  ],

  reggae: [
    "In the morning when Jah's light falls first upon the land we rise",
    "Babylon may build its walls but truth outlasts the stone every time",
    "We were born into a system made to keep the people small — rise up",
    "The riddim of the island runs like blood through every one of us",
    "Every generation must choose the side of truth or comfortable fear",
    "Positive vibration — that is the language of the ones who truly know",
    "They put bars around the body but the spirit knows no bars at all",
    "Natural mystic blowing in the air for those with the ears to hear it",
    "My grandfather left the island with a Bible and a very specific vision",
    "One love is not a slogan — it is the life I try to live every day",
    "Rise up children of the morning — feel the sun upon your open face",
    "The drum was here before the word and will carry truth when words are gone",
    "We don't need gold and silver for the genuine richness of this life",
    "In the culture of the roots there is a wisdom old and undefeated",
    "My grandmother sang these songs and received them from her grandmother",
    "The land remembers what the rulers tried to make us all forget",
    "We came from the same source — don't let them convince you otherwise",
    "Give thanks in the morning — give thanks and keep moving forward",
    "The music of the people has been carrying the truth for centuries",
    "Jah love is not a theory — it's the only thing that has ever held",
    "Every people with drums has a frequency that was never colonized",
    "We are the sons and daughters of a people who survived everything",
    "The one-drop rhythm is the heartbeat of the whole conscious tradition",
    "Jah love is not philosophy — it is how I move through this life daily",
    "Every generation carries the obligation to keep truth alive for the next",
    "The bass line carries the weight of the whole culture on its shoulders",
    "I was raised in a yard where the riddim was the first language of feeling",
    "Positive vibration is not optimism — it is resistance to every lie",
    "The roots run deep enough that no storm has ever pulled them all loose",
    "We don't forget where we came from — that memory is the protection",
    "Every island has a rhythm specific to its own grief and its own joy",
    "Sing it to your children so the song outlives the singer who carries it",
    "The borders dividing us were invented by the ones most afraid of us",
    "Peace is not the absence of struggle — it's knowing why you struggle",
    "I found the freedom I was chasing when I stopped and heard the drum",
    "The melody is older than the nation that tried to silence it",
    "We are rooted in a culture they could not colonize completely",
    "The conscience of the island is a song that never fully stops",
    "Stand firm in the truth — that is the complete instruction",
    "Jah music is the medicine and everyone is sick enough to need it",
    "The reggae was the language my grandmother used across the distance",
    "I carry the island in my chest wherever the road has taken me",
    "The consciousness of this culture is older than any name given to it",
    "Every conscious artist is a griot in the tradition of the long memory",
    "We were taught to sing the truth even when the truth was dangerous",
    "The riddim is the covenant between the living and those who passed it on",
    "I sing because silence in the face of injustice is its own violence",
    "The one-love doctrine is not naive — it is the most radical position",
    "The music was always the underground railroad of consciousness",
    "The revolution is the consciousness — everything else is the consequence",
    "We play this music for the ones who need a language for their dignity",
    "Every conscious lyric is a letter to the next generation from this one",
    "The peace I seek is not passive — it comes from knowing what to fight for",
    "I was born into a tradition of resistance I take seriously",
    "The sound system is the people's parliament — the selector is the speaker",
    "We give thanks because gratitude is the opposite of the poverty mindset",
    "I heard the nyahbinghi drum for the first time and was already home",
    "The music says what the movement couldn't always say in public",
    "We are connected to an Africa that lives in the blood and in the song",
    "I don't need validation from the system Im singing about",
    "The one-drop is the rhythm of walking in truth through an untruthful world",
    "I carry my grandfather's wisdom in the form of everything he sang to me",
    "The culture is the weapon and simultaneously the medicine",
    "We sing until the walls come down because the walls always do eventually",
    "I found my freedom in understanding I was always already free",
    "The conscious music is the long conversation between oppressed and truth",
    "Give thanks and praises every morning — that is the full practice",
    "The people's music is always the music the powerful most want silenced",
    "I learned to love life by learning first to love the life of my people",
    "The drum does not forget what the history books decided to omit",
    "Every generation of musicians extends the conversation one step further",
    "I hold the culture with both hands because both hands are required",
    "The song carries the people when the people have nothing else to carry them",
  ],

  folk: [
    "Ive been carrying a photograph of a house I'll never see again",
    "The guitar on the wall has seen me through the worst of everything",
    "My grandmother had hands that told the whole story of her years",
    "There are songs that hold more truth than all the books Ive read",
    "I played this song for forty people in a bar beside a river and meant it",
    "She kept a garden in the hardest years when nothing else would grow",
    "The river doesn't worry about the ocean waiting at its end",
    "I found my father's journal in the attic in the fall of a hard year",
    "Every road Ive walked has left a piece of itself inside me",
    "Ive been making peace with who I was before I knew who I'd become",
    "Simple things, honest things — the old songs were right about all of it",
    "The mountain in winter has a patience you can spend a life learning",
    "I played this song for strangers and the strangers understood every word",
    "The songs my grandfather sang he learned from someone long before him",
    "There's a grace in ordinary living that the glamorous world misses",
    "A roof, a fire, someone you love at the end of the working day",
    "Ive been wrong about a lot — the small things were the whole thing",
    "I will carry this guitar until I can't and then I'll pass it on",
    "Every generation learns the same hard things from scratch and still loves",
    "The kettle in the morning and the light before anyone else wakes",
    "Twenty years of moving taught me what I was actually looking for",
    "Ive walked these roads enough to know they loop back to the start",
    "The only shortcut to the truth is the long way through the hardship",
    "I stopped at every town and left a piece of this song there",
    "Home is not the place — it's the specific person you return to",
    "The road was the teacher and the lesson was to stop looking so hard",
    "I met the person I'd become somewhere around mile three hundred",
    "The wandering wasn't wasted — every mile was a verse in this song",
    "Ive been singing to the strangers and the strangers know the words",
    "Come home come home — every road Ive traveled ends in that word",
    "The guitar went silent when he died and I taught myself his songs",
    "There's a quality to grief that only shows in the third year of it",
    "I left the city looking for something and found it was here all along",
    "The old songs know things the new ones haven't had time to learn",
    "I sang this at the graveside and finally understood what it meant",
    "The tradition is the conversation between everyone who held this form",
    "I learned to listen to the land before I tried to write about it",
    "Every verse Ive written came from something I witnessed first",
    "The honest song is the rarest thing and the most genuinely durable",
    "I follow the folk tradition because it follows the truth",
    "She taught me three chords and the philosophy was the guitar itself",
    "Ive played these songs in kitchens more than concert halls and prefer it",
    "The song travels further than the singer — that has always been the plan",
    "I inherited the form and tried to fill it with something honestly earned",
    "Every generation needs the songs that tell it where it's standing",
    "The acoustic guitar is the most democratic instrument in all music",
    "I write about ordinary people because extraordinary ones have enough songs",
    "The folk song is the oral history that survived when the written record didn't",
    "I learned this verse from someone who learned it from someone who witnessed it",
    "Ive met my best audiences in the smallest rooms at the quietest moments",
    "The traditional song is not old — it is timeless which is different",
    "I play it slow because slowness is how you hear the whole thing",
    "The song is the map of the emotional journey — not the destination",
    "I write about loss because loss is the common language of the living",
    "The folk revival was people remembering that truth was always in the music",
    "I trust the song more than myself — the song knows where it's going",
    "Every line I write is trying to be worthy of what it's describing",
    "The guitar tells me when the lyric is wrong — it just stops feeling right",
    "I play in the order of their necessity — not their chronology",
    "A song for the workers, one for the grieving, one for the stubborn ones",
    "I learned to write by listening to the songs that survived everything",
    "The ballad is the documentary form that predated the camera entirely",
    "I am carrying forward a tradition that carried the people who carried me",
    "The chorus is the thing worth saying twice — that is its instruction",
    "I sing the same songs differently now that Ive lived enough to mean them",
    "The folk song asks nothing of you except your honest attention",
    "I play this song because every time I do someone in the room exhales",
    "This form was here before me and will carry someone else's truth after",
    "The best verse comes from the place where observation meets feeling",
    "I found the melody first and built the story into the space around it",
    "Every song Ive written started as a question I was too afraid to ask",
    "The tradition asks you to tell the truth and tell it plainly — I try",
    "Some songs want to be sung in the dark without anyone watching",
    "I play for the love of it first and everything else has always followed",
  ],

  electronic: [
    "In the moment before the drop the whole arena holds one breath together",
    "Every pair of hands above their heads in the dark — one body, one pulse",
    "The bass comes back and ten thousand people dissolve into each other",
    "I have never felt more present than at three AM inside a room like this",
    "Something sacred in the shared surrender when the drop arrives",
    "There is something about the build that lives in the category of prayer",
    "I was separate and alone before I found this room and this frequency",
    "The laser grid above and the bass below — we live between them together",
    "Let the frequency take everything you brought in here and replace it",
    "This is not escapism — this is the most alive I have ever been",
    "We came from different places and the music made the same of us",
    "In the frequency between the notes is everything that matters now",
    "For the length of this one song the whole world is this room",
    "Something in the melody makes all the armor come down at once",
    "Ten thousand hearts aligned and none of us are alone in this",
    "The music understands the things that language cannot reach at all",
    "I built a world from waveforms and the space between the sounds",
    "The loop becomes a world becomes a home becomes the only truth",
    "We are signal and pattern and the noise that's becoming light",
    "In the analog warmth and digital cold there is a perfect meeting",
    "The synthesizer speaks the language of what I feel at the end of night",
    "There is more emotion in a waveform than anyone told us was possible",
    "The arpeggio at midnight tells me things I couldn't say in any words",
    "I let the machine feel for me and then felt it through the machine",
    "Every sample holds the ghost of a moment that occurred before this",
    "Late night terminal glow and the city blurring past the window",
    "The modular patch connects the signal to the part of me that's real",
    "I built the frequency I needed when no other frequency would do",
    "The waveform knows what the sentence cannot hold — play it again",
    "At the edge of the signal the personal finally becomes universal",
    "The rave was the place where walls between people dissolved temporarily",
    "I found community in the shared surrender to a sound that chose us",
    "Ive spent years learning to subtract until only the essential remained",
    "The kick drum is the heartbeat of a species that learned to move together",
    "Every night I play is a conversation between the living and their machines",
    "The texture of the pad is the texture of the feeling that brought me here",
    "I compress the dynamic range and the music becomes the room it plays in",
    "The sequence loops and inside the loop there is infinite variation",
    "I follow the signal wherever it takes me — that is the full philosophy",
    "The resonant filter is the instrument of precise emotional specificity",
    "Every element I add serves the silence surrounding it",
    "The music doesn't ask for understanding — it asks only for surrender",
    "I learned to hear music in the noise before I had skill to make it",
    "The generative system creates music that teaches me what I was feeling",
    "Every gig is a different conversation about what connection means",
    "The reverb is the room and the room is the relationship we're having",
    "I make music for the three AM person who needs this feeling named",
    "The modulation is the feeling the static note simply cannot contain",
    "Electronic music is the latest form of the oldest human activity — sound",
    "I turn the knob and the machine responds and the room becomes different",
    "The bass frequencies are felt before heard — that's where I always start",
    "Every note I choose not to play is as deliberate as every note I do",
    "The club was the first place I felt music as a collective experience",
    "I built this track over three years and it still sounds like it was found",
    "The feedback loop is the conversation between the instrument and the room",
    "I process sound the way a painter processes light — looking for essence",
    "The algorithm is a collaborator with different preferences than mine",
    "In the silence between tracks the whole concert breathes together as one",
    "The synthesizer synthesizes not just sound but emotional data into frequency",
    "I found a chord that opened a door and Ive been living in that room since",
    "The sidechain is breathing — in the mechanical there is organic life",
    "Every set is a journey with a beginning middle and an honest ending",
    "The stage is a conversation and the dance floor is the reply",
    "I make music for the moments when words have genuinely run all the way out",
    "The sub bass is felt in the chest before it's registered in the ears",
    "Every element in a mix is in a relationship with every other element",
    "I learned to trust the process when the process started trusting me back",
    "The filter sweep is the most emotional gesture available on a synthesizer",
    "We are all searching for the frequency that makes the body want to move",
    "I built this to be listened to alone at night and in a crowd simultaneously",
    "The production is the song in electronic music — you can't separate them",
    "Every show I play I want someone to walk out feeling less alone than they came in",
  ],

  latin: [
    "When you walked in the whole room shifted into a different frequency",
    "Every city Ive danced in left your memory somewhere inside me",
    "The bass line in your body knows the truth before your mind does",
    "Underneath the summer stars we found the thing that had no name",
    "Before the night ends I want everything that we could be together",
    "The rhythm finds us everywhere — we don't go looking for the rhythm",
    "We don't need a reason to be moving through the street like this",
    "All the world outside this moment — let it fade and disappear",
    "You make me feel the way the music promises it's supposed to feel",
    "My grandmother danced son cubano in the kitchen every Saturday",
    "The continent runs deep in me no matter what country Im standing in",
    "I carry every version of my family in the way I hold my head",
    "My name has history in it that took centuries to make properly",
    "The barrio made me everything — the barrio is in every step I take",
    "I am the product of a people who refused to be erased by anything",
    "My culture is not a costume — it is the architecture of my soul",
    "Speak the language of your ancestors even when the world says not to",
    "We celebrate because celebration is resistance to those who want us small",
    "Every generation carries the song forward — I carry it now",
    "Put the record on and let the night become exactly what it wants to",
    "The dance floor is the only place where class and caste dissolve",
    "One more song with you beneath the open sky before the night ends",
    "Feel the clave in your chest — that is the oldest clock there is",
    "We were made for this — the late night, the rhythm, the being together",
    "The music doesn't ask permission — it finds the body and begins",
    "Every song is a conversation between the living and the ones who've gone",
    "Give me one more night like this and I'll remember it forever",
    "The reggaeton drops and everything I planned to say disappears",
    "We are alive and dancing — that is the whole political statement",
    "The clave is the oldest rhythm in the room — everything else is commentary",
    "I carry the Caribbean in my blood and it comes out in how I move",
    "The dembow beat is the conversation between generations of a whole culture",
    "The brass section is the sound of a celebration that survived everything",
    "The cumbia is the rhythm of a people who refused to let colonizers take it",
    "I grew up in a house where the music was always the first medicine",
    "The salsa is a conversation in the key of joy between two willing partners",
    "I am from the island and the island is from me — we are not separable",
    "Every Latin rhythm is a history of survival encoded in the percussion",
    "My father played the tres and the sound was his whole autobiography",
    "The barrio gave me the rhythm — I give the rhythm back to the barrio",
    "We dance because we were told we couldn't — that was the invitation",
    "The percussion is the communication between the living and the ancestors",
    "I want to make music that makes strangers into the same person briefly",
    "The Latin diaspora is a continent of feeling searching for a shared language",
    "Every love song in Spanish is simultaneously a geography lesson",
    "I sing in the language of my grandmother because nothing goes deeper",
    "The montuno is the engine of the whole form — everything else is decoration",
    "We celebrate because the celebration is the political act most feared",
    "The timbales announce the arrival of something requiring full attention",
    "The late night Latin club is the last honest democracy in any city",
    "I learned to sing before I learned to speak — the music came first",
    "We make the music that the system tried to keep in its proper place",
    "My name is a complete sentence in the language of the people I come from",
    "I take the tradition seriously because the tradition took people seriously first",
    "Every bolero was written about the same specific missing person",
    "I am from a culture that turns grief into something you can dance to",
    "The congas are talking — they've been talking for five hundred years",
    "My culture survived the middle passage — it can survive the algorithm",
    "The son montuno is the root of a tree that grew across the whole world",
    "We have always been bilingual — in the language and in the feeling",
    "Every generation has the obligation to make the tradition dangerous again",
    "The dance is the argument for life that needs no translation at all",
    "I make music that makes the homesick feel found wherever they are",
    "We are the music and the music is the document of our survival here",
    "The brass hits and everyone in the room understands something simultaneously",
    "I want my music to be the sound of the culture that shaped me fully heard",
    "The percussion is the whole philosophy of community expressed rhythmically",
    "I bring the rhythm of my people into every room I enter as a gift",
    "The sound system is the instrument and the neighborhood is the concert hall",
    "We make this music together because together is the only way it works",
    "From the coast to the mountain to the city — the clave is unchanged",
  ],

  kpop: [
    "In a million city lights your face is the only one Im searching for",
    "Every choreographed moment was just rehearsal for the real one",
    "I found you in the middle of a crowd and everything else stopped",
    "All the years of preparation were a prayer for this exact moment",
    "The trainee days were dark — that's why the stage feels like it does",
    "From the practice room at midnight to the stage — every step was real",
    "I searched for something like this and the searching led me here to you",
    "You are in every city I have traveled through this never-ending year",
    "The camera and the stage aside — I want you to know the real me",
    "I was made for this performance but Im living for what's off the stage",
    "You are the reason I get up when the getting up is genuinely difficult",
    "Together we are more than either one of us could be alone in this",
    "I will find you in the dark — I always find you in the dark somehow",
    "Even across the distance you're in the rhythm of my heart",
    "Cherry blossoms in the evening and your face against the neon light",
    "The fans became the family that this journey required all along",
    "I perform the polished version — you deserve to know the unpolished true one",
    "You make me feel like something more than what I trained myself to be",
    "We were strangers in the same place — one song made us the same",
    "Something in the music we make reaches past the screen to somewhere real",
    "They told me the idol life would leave no room for real feeling at all",
    "I proved them wrong the only way that matters — quietly and completely",
    "Every no I heard in that practice room became the fuel for all of this",
    "The city from above at night looks like our story told entirely in lights",
    "I don't only want to shine from far away — I want you to actually know me",
    "Before the debut there were years of doubt that almost won the argument",
    "I am not the character in the concept — I am the person who plays him",
    "Every song I release is a version of myself Im prepared to be accountable for",
    "The success was the result of ten thousand unremarkable practice hours",
    "I want the music to mean something after the choreography stops",
    "I gave up everything ordinary to stand in this particular light",
    "The practice room taught me things I couldn't have learned anywhere else",
    "You became the reason the hard years feel like they were worth every hour",
    "I memorized the choreography until my body knew it better than my mind",
    "Every performance is a promise I make to everyone who waited for this",
    "The trainee years are the secret history that the stage career is built on",
    "I want to be someone who earns the stage every single time I step onto it",
    "We are not a product — we are people who chose to pour ourselves into this",
    "The spotlight found me before I was ready and I decided to be ready",
    "You traveled ten thousand miles to stand in the front row — I see you",
    "The choreography is the emotion made legible to a room of twenty thousand",
    "I became myself in public and asked everyone to witness the process",
    "The second album is where the artist emerges from inside the trainee",
    "I want the fans to hear the real person underneath the production",
    "The debut was the beginning of the work — never the completion of it",
    "We built this together and the together is always the entire point",
    "Ive been performing version two of myself so long I forget which came first",
    "The world tour taught me that longing looks the same in every language",
    "Every encore is an act of faith between the audience and the performer",
    "I wrote this during the tour and the jet lag is present in every note",
    "The industry tried to make me smaller — I used the resistance as material",
    "You know the choreography by heart and that changes how the show feels",
    "I look for you in the crowd at every single show — I always find you",
    "The idol image is the invitation — the music is the real introduction",
    "I want to make music that works without the performance attached to it",
    "The harmony we found in the practice room is the one we bring to the stage",
    "Ive been shaped by millions of people watching and became more myself",
    "The global reach of this music proves feeling has no borders anywhere",
    "Every hard year before debut is now a lyric in the second album",
    "The fans became the compass that pointed me back to why I started",
    "I perform with everything I have because you came with everything you have",
    "The music video is the dream version — the concert is the real one",
    "Every song I release is a version of myself Im ready to stand behind",
    "I want to use the platform to say something true before the window closes",
    "The comeback is the artist's way of saying Im still becoming",
    "I found my voice by trying to copy the ones I loved until mine emerged",
    "The audience gives me energy I could never manufacture on my own",
    "This music saved me before I became the person who makes it",
    "I want every fan to feel seen in ways the world hasn't always seen them",
    "We are proof that something this good can actually be made to last",
    "I bring my whole self to every stage because anything less is a lie",
  ],

  punk: [
    "We were never meant to whisper and we are never going to start",
    "Three chords and the honesty to say the thing they built walls against",
    "I was seventeen and angry and I found my people in the loudest room",
    "They built the boxes meant to fit us — we were born without those shapes",
    "In the pit with strangers I have never felt less alone in my whole life",
    "The music saved me when the other options all ran completely out",
    "No permission needed — we decided that a long time ago together",
    "We built our world from borrowed gear and borrowed time and honesty",
    "Every rule they handed us became a reason not to follow it",
    "All I had was three chords and a feeling and it turned out to be enough",
    "They say the scene is dead — the kids are still in basements every Friday",
    "Nothing they offered was worth the thing we already had in each other",
    "This is not a phase — this is the most real I have ever actually been",
    "The future they were selling us was always someone else's future",
    "We are every generation that was told to sit down and be quiet",
    "The label came calling and we said thanks but this is not for sale",
    "I remember when this music hit me the first time — everything shifted",
    "We are not a demographic — we are a reason and a genuine community",
    "The venue's in a basement and the crowd is seventeen and perfect",
    "Real community looks like this — sweaty, loud, and completely unashamed",
    "There is no polish here — the polish was always the first thing to go",
    "Loud is honest when the quiet is the thing that's slowly killing you",
    "We didn't come here to be comfortable — we came here to be true",
    "The guitar doesn't lie the way everything else in my life consistently does",
    "I found the only thing worth finding in the last place they would look",
    "This song is three minutes and says everything I couldn't say in years",
    "Every compromise we didn't make is in this room with us right now",
    "We play it fast because slow is the sound of being too reasonable",
    "The noise is not the point — the noise is the container for the point",
    "I will scream this into every microphone until somebody finally hears it",
    "The first show I played was in a basement and it remains the best show",
    "We don't need your production budget — we need your honest attention",
    "The three-chord song is the most efficient delivery system for truth",
    "No genre polices itself harder than punk about what counts as punk",
    "The DIY ethic is not poverty workaround — it is ideological position",
    "We play fast because slow gives the establishment time to respond",
    "The mosh pit is the most democratic physical space in all live music",
    "I make music that costs nothing to make and everything to mean",
    "Every punk band starts because something made someone angry enough",
    "The chorus is where everyone in the room becomes one unified person",
    "The record label system was invented to do what it does — just avoid it",
    "We were never trying to be famous — we wanted to be heard by the right people",
    "The feedback loop is the honest conversation between amp and the room",
    "I learned more about myself in three minutes of a Buzzcocks song than years",
    "The punk scene gave me community before any institution ever offered it",
    "Every safety pin is a statement about what kind of decoration matters",
    "The stage is level with the floor because the performer is not above the audience",
    "I don't write anthems — I write arguments that happen to be singable",
    "The spirit of punk is refusing to accept the terms of the default negotiation",
    "We tour in a van because the experience is always the whole point",
    "The energy when everyone knows every word is genuinely indescribable",
    "I want every song to feel like it was written the day before it needed to exist",
    "The scene is the family you build when the one you were born into doesn't fit",
    "We play for the kids in the back who came looking for a reason to stay",
    "The two-minute song is a philosophical position about what deserves your time",
    "I measure success in converted people not in chart positions ever",
    "The amps are cranked because the truth when finally said is a loud thing",
    "Punk gave permission to everyone who didn't know they were allowed to make art",
    "The band broke up and got back together because the music was still there",
    "We are louder than our influences because we have more to be angry about",
    "Ive been writing protest songs because the protest is nowhere near over",
    "The chord progression is borrowed — the conviction is completely original",
    "I learned from The Clash that political music can also be the best music",
    "The kids at the front are the reason the genre survives every decade",
    "I play guitar like Im arguing — because that's what playing it is for",
    "The audience becomes the band when they know all the words to everything",
    "Every punk record is a time capsule of a specific outrage at a specific moment",
    "I play fast because slow means sitting with the feeling considerably longer",
    "We are not nostalgic for punk — we are actively continuing it right now",
    "The scene is not dead — it's in a different basement in a different decade",
    "Hardcore kept the flame burning through every decade between the peaks",
    "I came to punk because I needed a place to put the anger and the love together",
  ],

  phonk: [
    "Rode through the city at midnight when the city belongs to no one",
    "Cold like the engine — no feeling required, just the function itself",
    "They sleep — I move — that's been the arrangement since the very start",
    "The bass hits different when the whole world is finally quiet",
    "Built different from the ground — not by choice but by circumstance",
    "I don't need the crowd's energy — I need the empty road and the dark",
    "Slowed and reverbed like the dream you can't quite shake loose all morning",
    "Moving calculated — every step a chapter in the considerably longer story",
    "The midnight has a frequency that daylight will never understand at all",
    "I ride alone because the ones who rode with me originally are gone now",
    "Everything I built I built in the dark when nobody was watching at all",
    "The streets remember you even after you've moved on from them",
    "Keep the circle tight — the ones outside it don't require any access",
    "There's a version of me in every city I never properly said goodbye to",
    "The phonk drops and suddenly every problem shrinks to the right size",
    "Cold and deliberate — that's the only operating temperature I know",
    "I don't discuss the process — I only discuss the verifiable outcome",
    "The whip rolls slow because slow is how you notice everything around you",
    "Deep in the cut where nobody looks — that's where the real work gets done",
    "Every move intentional — nothing wasted — everything already counted",
    "The slowed reverb is the aesthetic of a memory you cannot shake loose",
    "I move through the city at three AM when it's finally most itself",
    "Cold production for cold emotions — the temperature is a design choice",
    "The Memphis underground kept the realest sound alive through every decade",
    "I make music for the late-night drive nobody knows you're taking",
    "The cowbell hit is the metronome of a completely different kind of menace",
    "Every drift is a metaphor for controlled loss of traction on purpose",
    "The phonk aesthetic is not for everyone — that's the intended design",
    "I sample the dead because the dead understood what we collectively forgot",
    "The slowed-down vocal is the ghost in the machine making its confession",
    "Nobody phonk harder than the ones who came from where I actually came from",
    "The 808 in the dark is the sound of intention without any explanation",
    "I produce in the hours when the productive people have all gone to sleep",
    "The old Memphis sound was the original phonk and was dangerous for a reason",
    "The cowbell and the 808 are the two instruments of the current dark era",
    "I make the music that plays in the background of the heist that goes perfectly",
    "The reverb on the vocal is the distance between the feeling and its expression",
    "Every phonk track is a night drive with no destination but perfect energy",
    "The lo-fi texture is not laziness — it is the correct emotional resolution",
    "I dig for samples in the places other producers don't know to look",
    "The bass in phonk is slower than your heartbeat — that is the whole secret",
    "Three AM and the only light is monitor glow and an open sample rack",
    "The genre emerged from underground because the underground needed this sound",
    "I produce music that sounds like it was found somewhere — not manufactured",
    "The trap hi-hat at half speed is the sound of deliberate practiced patience",
    "Every phonk producer is a historian of a very specific documented darkness",
    "The sample flip is the art form — finding the life hidden in the original",
    "I make music that plays loud in the empty parking lot at two in the morning",
    "The distorted 808 is the instrument of a generation raised entirely on bass",
    "The aesthetic is the argument and the argument is entirely the aesthetic here",
    "I choose sounds the way writers choose words — for their precise weight",
    "The phonk scene is the underground keeping the underground completely honest",
    "Every track I make is a letter to the person driving somewhere alone tonight",
    "The vinyl crackle is not nostalgia — it is the warmth that digital forgot",
    "I slow the sample down until it reveals the emotion buried in the original",
    "The grimiest production is often the most honest emotional document",
    "Cowbell patterns are the morse code of the whole Memphis underground tradition",
    "I make music that sounds like the feeling you can't explain to anyone sober",
    "The reverb tail is longer than the note itself — that tells the whole story",
    "Every distortion is a decision about how honest Im willing to be sonically",
    "The phonk is not a genre — it is a philosophical position on sound design",
    "I produce at the intersection of menace and melancholy and I live there",
    "The chopped and screwed tradition is the origin of every slowed aesthetic",
    "I make the music that other producers actually tell you to avoid making",
    "The sample is a resurrection — bringing back the feeling the original buried",
    "Every bass hit is a statement about what genuine seriousness actually sounds like",
    "The underground stays underground because the mainstream can't metabolize it",
    "I tune the 808 to the minor key because that's where the truth consistently lives",
    "Make it cold, make it deliberate, make it undeniable — that's the full brief",
  ],

  drill: [
    "Came from the ends where the cold nights go on forever",
    "Moved different from the day I understood what different actually meant",
    "Every bar is documented truth — not a syllable of performance in it",
    "Before the paper came I had to figure out what I was actually worth",
    "The road gave me everything it took — that's the deal you sign up for",
    "My mandem know what it is — we don't explain it to anyone outside",
    "Kept the circle small when small meant the ones who wouldn't fold on you",
    "Real ones stood still when standing still cost them something genuinely real",
    "The ends raised me and the ends is in every bar Ive ever written",
    "I made something from nothing with a nothing that was completely real",
    "Say less — the work speaks and the mouth has nothing to add to it",
    "They counted me out — I kept the count going entirely on my own",
    "The level changed but the code stayed exactly where it's always been",
    "I built this from the block up with nothing but the will and the mandem",
    "Road knowledge is the education no school ever put on any syllabus",
    "Every move was calculated — nothing was left to what they call luck",
    "Watched the elders fall before me and took the lesson not the lane",
    "The drill beat drops and every bar arrives already knowing where to go",
    "Loyal when loyalty was the most expensive choice available — I chose it",
    "The ends is not the backdrop — the ends is the protagonist of every verse",
    "Moved through the system built specifically to produce my failure",
    "The drill beat is the architecture of a specific kind of urban survival",
    "Every bar is a piece of evidence from the place that shaped me",
    "The sliding 808 is the sound of a generation that learned to adapt everything",
    "I speak for the estate in rooms the estate was never invited into",
    "The cold delivery is not affect — it is the emotional temperature of experience",
    "I came from the block the city pretends doesn't exist until it has to",
    "Every feature I do I bring the whole postcode with me — that's the deal",
    "The hi-hat pattern is the rhythm of a city that never stops being tense",
    "I earned the right to speak on this — the receipts are the verses themselves",
    "The dark piano is the melody of the specific London melancholy",
    "I recorded this in the studio at midnight when the feeling was right",
    "Every bar I write I write for the ones who don't have a platform for this",
    "The block raised me to be exactly what the block requires right now",
    "I keep it real because keeping it real is the only thing that holds",
    "The UK drill sound is the sound of a specific generational frustration",
    "I moved from the estate to the arena — the estate is in every song",
    "Every rapper from the ends knows the music is simultaneously documentation",
    "The cold energy in the track is the emotional temperature of lived experience",
    "I don't perform the struggle — I report it from the inside in real time",
    "The hook is catchy because pain that's catchy gets heard by more people",
    "I write the verses and the verses write back with what I didn't know I knew",
    "The grime and the drill are different accents of the identical truth",
    "Every drill track is the autobiography of a generation doing the math",
    "I know the studio is a privilege because I know what came before it",
    "The night shift at the ends is the origin of every bar in this discography",
    "I earned my place in this room by never pretending to be from somewhere else",
    "The dark production is the mirror of the emotional reality it documents",
    "Every sliding note in the 808 is the sound of constant readjustment",
    "I built this career without the connections that most careers are built on",
    "The drill format is the vessel for the most contemporary kind of honesty",
    "I speak plainly because plain speech is what the music requires here",
    "The city that shaped me is in every syllable of every verse Ive written",
    "I came from the stats that nobody quotes when they talk about success",
    "The music is the way out — I know because I watched it be the way out",
    "Every lyric I write is the primary source material for this particular history",
    "The flow adapts because the circumstances demand constant adaptation",
    "I don't explain the slang — the slang is the identity and that's the point",
    "The estate is not the backdrop — the estate is the protagonist",
    "I make music that the block recognizes because the block made me first",
    "Every bar I drop is for the ones who thought they'd never hear themselves",
    "The drill is the documentation — every lyric is the primary record",
    "I came from nothing and built something and Im still actively building",
    "The beat is cold because the environment requires a specific composure",
    "I don't cap about where Im from — it's the only credential that matters",
    "Every show I do I remember the shows I couldn't afford to get into",
    "The music business tried to understand us — we just kept making music",
    "I am the sum of every experience the system tried to make into a limitation",
    "The UK drill sound is a generation refusing to be invisible",
    "Every verse I write is the answer to someone who said this wasn't possible",
    "I walk into every room as the sum of every room I was kept out of before",
  ],

  default: [
    "Ive been carrying the weight of who I used to be for too long now",
    "There's a version of this story where I made the call I needed to make",
    "Every road Ive taken has been teaching me the same thing differently",
    "I have been the problem and the solution and the lesson in between",
    "The light comes back eventually — it always has and I believe it will",
    "I stood at the crossroads of who I was and chose the harder path",
    "Some things take a whole life to become what they were always meant to be",
    "There are no shortcuts to the honest version of yourself — trust me",
    "I asked the road for easy and the road gave me the true instead",
    "All the things I thought were setbacks were the necessary architecture",
    "What I know now I couldn't have known without the cost of learning it",
    "I am every mile Ive traveled and every door I had to knock on first",
    "The hardest thing I did was keep going when going looked completely wrong",
    "Somewhere in the distance between who I was then and who Im becoming",
    "The only version of this story that holds is the one I stopped lying in",
    "I have been most honest in the moments I was too tired to perform",
    "Every season Ive survived left me different — not better, not worse, true",
    "The turning point rarely announces itself — you see it in the rearview",
    "I keep returning to the same realization dressed in different clothes",
    "The work was always the answer — I just kept asking the wrong question",
    "Something shifted and I was different on the other side — that's the story",
    "I am assembled from every version of myself I had to walk away from",
    "The honest thing and the easy thing have rarely been the same for me",
    "Ive learned to sit inside the uncertainty until it teaches me what it knows",
    "Every question Ive avoided has eventually found me in a quieter room",
    "I stopped performing for the audience in my head and started living",
    "The version of me I want to be is just past the version Im afraid to be",
    "I carry gratitude for the hard years now that I can see what they built",
    "Some truths are only available on the far side of the difficult thing",
    "I have been the author of my confusion and the only one who can rewrite it",
    "The journey inward is longer and stranger than any road Ive traveled",
    "Every broken thing Ive carried has eventually revealed its purpose",
    "I stopped waiting for permission to become what I was already becoming",
    "The most important decisions Ive made happened in the quietest moments",
    "I trust the process now because Ive seen the process deliver on its promises",
    "Every door that closed was making space for one not yet built",
    "The people who shaped me most were not the ones who made it easiest",
    "I am becoming something I couldn't have planned for and Im grateful",
    "The life I have is not the one I imagined — it's better and more honest",
    "Every moment of doubt Ive survived confirmed something I needed confirmed",
    "I learn the most about myself in the seasons I didn't choose to be in",
    "The version of success that fits me isn't in any template I was handed",
    "Ive been most creative when the circumstances left no other choice",
    "Growth never looks like growth from where you're standing inside it",
    "I found my voice by losing the performance of it I'd been maintaining",
    "Every relationship that ended taught me something the lasting ones couldn't",
    "I am not defined by the worst thing that happened — I am what survived it",
    "The road was long and the lesson was hidden in the length of it",
    "Ive stopped trying to skip to the end and started living inside the middle",
    "Whatever this is — Im grateful the version of me that got to experience it",
    "I have been surprised by my own resilience more times than I can count",
    "The thing about change is it happens before you notice it happened",
    "I built something Im proud of from materials I didn't choose",
    "Every version of the story I tell myself gets a little closer to the truth",
    "Ive made peace with not knowing and found it's the start of everything",
    "The work is its own reward — everything else is just what follows the work",
    "I showed up when showing up was the only thing I had left to offer",
    "Some seasons are for planting and some are for waiting and both are necessary",
    "I have loved imperfectly and been loved imperfectly and that is all of it",
    "The path forward became clear the moment I stopped looking for the shortcut",
    "I am most myself in the moments I stop trying to be anything at all",
    "What I want most now is what I had all along and didn't know to keep",
    "Ive been building toward something without knowing exactly what it was",
    "The best version of any story is the one where someone tells the truth",
  ],
};

// 8b. GENRE LINE RETRIEVAL — with dedup, rhyme-end compatibility
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getLinePool(genreKey) {
  return GENRE_LINES[genreKey] || GENRE_LINES.default;
}

function cleanLine(s) {
  if (!s) return s;
  let r = s.replace(/\s{2,}/g, ' ').trim();
  // Fix duplicate adjacent words: "the the" / "a a" etc.
  r = r.replace(/\b(\w+) \1\b/gi, '$1');
  // Fix a/an
  r = r.replace(/ a ([aeiou])/gi, (m,v) => ` an ${v}`);
  // Fix lowercase "i" as standalone word
  r = r.replace(/\bi\b/g, 'I');
  // Fix capitalization after em-dash mid-sentence (beatStarter + pool line joins)
  // "That's when — i was" -> "That's when — I was"
  r = r.replace(/ — ([a-z])/g, (m, c) => ` — ${c.toUpperCase()}`);
  return r.trim();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DYNAMIC LINE COMPOSER — generates unique lines from templates + parts
// Combinatorial space: ~50K–100K unique lines per genre
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Pronouns that need verb form agreement
const _pronounSubjects = new Set(['i','we','you','they','he','she','it']);
// Subjects that need third-person singular verbs (starts → "the city starts")
const _thirdPersonSingular = new Set([
  'the city','the night','the truth','the hustle','the block','the grind',
  'my mind','my heart','my pen','this feeling','this moment','the light',
  'the pain','the music','the beat','the rhythm','the sound','the love',
  'the wind','the road','the weight','the world','something','everything',
  'nothing','the silence','the fire','the storm','the morning','the dark',
  'the dawn','the memory','the song','the money','the crowd','the energy',
]);

function _needsThirdPerson(subject) {
  const s = subject.toLowerCase().trim();
  if (_thirdPersonSingular.has(s)) return true;
  // Single-word non-pronoun subjects → third person
  if (s.split(' ').length === 1 && !_pronounSubjects.has(s)) return true;
  // "the X", "my X", "this X", "every X" (singular determiners)
  if (/^(the|my|this|that|her|his|its|our|your|each|another) /.test(s)) return true;
  return false;
}

// Quick third-person conjugation for common verb starts
function _conjugateThird(verbPhrase) {
  const vp = verbPhrase.trim();
  const firstWord = vp.split(' ')[0];
  // Already past tense (-ed ending), or starts with a known past/modal — leave alone
  if (/ed$/.test(firstWord) && firstWord.length > 3) return vp;
  // Already third-person conjugated (-s/-es ending on short verbs)
  if (/[^s]s$/.test(firstWord) && firstWord.length > 3 && !/ss$/.test(firstWord)) return vp;
  if (/es$/.test(firstWord) && /[sxz]es$|[cs]hes$/.test(firstWord)) return vp;
  if (/^(was |were |had |has |could |would |should |might |will |did |got |made |took |came |went |broke |found |lost |left |held |sat |ran |fell |built |wrote |stayed |turned |kept |grew |watched |learned |rose |carried |walked |started |saw |looked |knew |felt |gave |called |played |heard |drove |swore |lived |loved |tried |moved |showed |earned |said |chose |set |lit |hit |cut |let |put |drew |wore |woke |stood |thought |brought |caught |fought |bought |taught )/.test(vp)) return vp;
  if (/^(never |dont |cant |wont |didnt |couldnt |wouldnt |shouldnt |ain't |isnt )/.test(vp)) return vp;
  
  const words = vp.split(' ');
  const v = words[0];
  // Common irregular verbs
  const irregulars = {
    'come':'comes','go':'goes','do':'does','have':'has','be':'is',
    'rise':'rises','shine':'shines','dance':'dances','take':'takes',
    'make':'makes','give':'gives','break':'breaks','fall':'falls',
    'hold':'holds','run':'runs','reach':'reaches','push':'pushes',
    'crash':'crashes','burn':'burns','turn':'turns','find':'finds',
    'keep':'keeps','build':'builds','speak':'speaks','fly':'flies',
    'carry':'carries','try':'tries',
  };
  if (irregulars[v]) { words[0] = irregulars[v]; return words.join(' '); }
  // Regular: add -s/-es
  if (/[sxz]$|[cs]h$/.test(v)) words[0] = v + 'es';
  else if (/[^aeiou]y$/.test(v)) words[0] = v.slice(0,-1) + 'ies';
  else words[0] = v + 's';
  return words.join(' ');
}

// Reverse third-person conjugation back to base form
// "shines brighter" → "shine brighter", "dances until" → "dance until"
function _deconjugateToBase(verbPhrase) {
  const vp = verbPhrase.trim();
  const words = vp.split(' ');
  const v = words[0];
  // Don't touch past tense, modals, or negations
  if (/ed$/.test(v) && v.length > 3) return vp;
  if (/^(was|were|had|has|could|would|should|might|will|did|never|dont|cant|wont|didnt)$/i.test(v)) return vp;
  // Common irregulars back to base
  const irregulars = {
    'comes':'come','goes':'go','does':'do','has':'have','is':'be',
    'rises':'rise','shines':'shine','dances':'dance','takes':'take',
    'makes':'make','gives':'give','breaks':'break','falls':'fall',
    'holds':'hold','runs':'run','reaches':'reach','pushes':'push',
    'crashes':'crash','burns':'burn','turns':'turn','finds':'find',
    'keeps':'keep','builds':'build','speaks':'speak','flies':'fly',
    'carries':'carry','tries':'try','lives':'live','moves':'move',
    'lights':'light','knows':'know','sits':'sit','gets':'get',
    'hits':'hit','puts':'put','cuts':'cut','lets':'let','sets':'set',
    'wins':'win','spins':'spin','begins':'begin','screams':'scream',
    'dreams':'dream','floats':'float','chases':'chase','ignites':'ignite',
    'spirals':'spiral','owns':'own','fills':'fill','pulls':'pull',
    'feels':'feel','sees':'see','hears':'hear','says':'say',
    'plays':'play','stays':'stay','calls':'call','starts':'start',
    'stops':'stop','leaves':'leave','stands':'stand','walks':'walk',
    'opens':'open','closes':'close','writes':'write','reads':'read',
    'sings':'sing','grows':'grow','shows':'show','drives':'drive',
    'leads':'lead','needs':'need','wants':'want','loves':'love',
    'refuses':'refuse','chooses':'choose','proves':'prove',
    'changes':'change','creates':'create','becomes':'become',
  };
  if (irregulars[v]) { words[0] = irregulars[v]; return words.join(' '); }
  // Regular: remove -s/-es/-ies
  if (/ies$/.test(v) && v.length > 4) { words[0] = v.slice(0,-3) + 'y'; return words.join(' '); }
  if (/sses$/.test(v)) { words[0] = v.slice(0,-2); return words.join(' '); } // misses→miss
  if (/[sc]es$/.test(v) && v.length > 4) { words[0] = v.slice(0,-1); return words.join(' '); } // refuses→refuse, dances→dance
  if (/[xz]es$|ches$|shes$/.test(v)) { words[0] = v.slice(0,-2); return words.join(' '); }
  if (/[^s]s$/.test(v) && v.length > 3 && !/ss$/.test(v)) { words[0] = v.slice(0,-1); return words.join(' '); }
  return vp;
}

function composeLine(rng, genre, genreKey, songUsed, maxWords=16, minWords=7) {
  const templates = GENRE_TEMPLATES[genreKey] || GENRE_TEMPLATES.default || [];
  // Filter to single-subject templates only — double {S}{V} causes conjugation issues
  // Also exclude templates with 'said/watch/told me/every {T}/real {T}' which break
  // grammar when combined with past-tense verbs or pronoun topics
  const dynamicTemplates = templates.filter(t => {
    if (!t.includes('{')) return false;
    if ((t.match(/\{V\}/g) || []).length > 1) return false;
    if (/^(said|watch|they said|told me) /.test(t)) return false;
    if (/every \{T\}|real \{T\}/.test(t)) return false;
    return true;
  });
  if (dynamicTemplates.length === 0) return null;

  const subjects = genre.subjects || [];
  const verbs = genre.verbPhrases || [];
  const images = genre.images || [];
  const modifiers = genre.modifiers || [];
  if (subjects.length === 0 || verbs.length === 0) return null;

  // Try up to 20 template+slot combos to find a good line
  for (let attempt = 0; attempt < 20; attempt++) {
    const tpl = rPick(rng, dynamicTemplates);
    const s = rPick(rng, subjects);
    let v = rPick(rng, verbs);
    const img = images.length > 0 ? rPick(rng, images) : '';
    const m = modifiers.length > 0 ? rPick(rng, modifiers) : '';

    // Conjugate/deconjugate verb based on subject
    if (_needsThirdPerson(s)) {
      v = _conjugateThird(v);
    } else {
      // Subject is first/second person (I, we, you, they) — 
      // verb might already be third-person from the pool, so deconjugate
      v = _deconjugateToBase(v);
    }

    // Handle topic slot — use a non-pronoun subject as topic word
    const topicPool = subjects.filter(s => s.length > 2 && !/^(I|we|you|they|he|she|it)$/i.test(s));
    const t = topicPool.length > 0 ? rPick(rng, topicPool) : rPick(rng, subjects);

    let line = tpl;
    // Replace slots (handle double {S}/{V} in templates like "{S} {V}, {S} {V}")
    let sUsed = 0, vUsed = 0;
    line = line.replace(/\{S\}/g, () => { sUsed++; return sUsed === 1 ? s : rPick(rng, subjects); });
    line = line.replace(/\{V\}/g, () => {
      vUsed++;
      let vb = vUsed === 1 ? v : rPick(rng, verbs);
      // Conjugate subsequent subjects too
      if (vUsed > 1) {
        // Check the preceding subject for this verb
        const parts = line.split(',');
        if (parts.length >= vUsed) {
          const precedingPart = parts[vUsed - 1] || '';
          const precedingSubj = precedingPart.trim().split(' ')[0];
          // Simple heuristic: if prior part started with a third-person trigger, conjugate
        }
      }
      return vb;
    });
    line = line.replace(/\{I\}/g, img);
    line = line.replace(/\{M\}/g, m);
    line = line.replace(/\{T\}/g, t);

    // Clean up
    line = line.replace(/\s{2,}/g, ' ').trim();
    // Skip if "every the" or similar broken constructions
    if (/every (the |my |this |a |an )/i.test(line)) continue;
    if (/real (the |my |this |a |an )/i.test(line)) continue;

    // Word count check
    const wordCount = line.split(/\s+/).length;
    if (wordCount < minWords || wordCount > maxWords) continue;

    // Skip if already used
    if (songUsed && songUsed.has(line)) continue;
    if (_batchUsedLines.has(line)) continue;

    // Grammar validation — reject obviously broken compositions
    // "I runs/makes/holds" — first person + third person verb
    if (/^I [a-z]+s /i.test(line) && !/^I (was|is|miss|cross|guess|press|pass|confess|process|possess|address|express|witness|dismiss) /i.test(line)) continue;
    // "We/You/They runs/makes" — plural + third person verb
    if (/^(we|you|they) [a-z]+s /i.test(line) && !/^(we|you|they) (was|is|miss|cross|guess|press|pass|confess|process) /i.test(line)) continue;
    // "the stars crashes" / "the lights shines" — plural noun + singular verb
    if (/\bthe \w+s [a-z]+s /i.test(line) && !/\bthe \w+s (was|is|miss|cross|guess|press|pass) /i.test(line)) continue;
    // Double verb: "You make life runs" but not "make the memory that survives"
    if (/\bmake[s]? (my |the |this |your |our |a )?\w+ [a-z]+s /i.test(line) && !/\bthat [a-z]+s\b/i.test(line)) continue;
    // Dangling modifiers: "Entirely — the light turns" at start is fine but "Entirely — something shine" is bad
    // "something/everything + third person singular" needs conjugation
    if (/\b(something|everything|nothing|anything) [a-z]+(?!s|ed|ing)\b/i.test(line)) {
      // Check if the verb after something/everything is unconjugated
      const m = line.match(/\b(something|everything|nothing|anything) ([a-z]+)\b/i);
      if (m) {
        const v = m[2].toLowerCase();
        // These indefinite pronouns need third-person singular
        if (!/^(electric|honest|real|new|old|big|small|good|bad|dark|bright|sacred|holy|heavy|light|deep|pure|raw|wild|still|quiet|loud|true|false|beautiful|impossible|incredible|different|specific)$/i.test(v)) {
          // It's a verb, not an adjective — check if it needs -s
          if (!/s$|ed$|ing$/.test(v) && v.length > 2) continue;
        }
      }
    }

    // Capitalize first letter
    line = line.charAt(0).toUpperCase() + line.slice(1);
    return line;
  }
  return null; // couldnt compose a valid line
}

// Compose a hook-worthy line — shorter, punchier
function composeHookLine(rng, genre, genreKey, songUsed) {
  const subjects = genre.subjects || [];
  const verbs = genre.verbPhrases || [];
  const modifiers = genre.modifiers || [];
  if (subjects.length === 0 || verbs.length === 0) return null;

  // Hook-specific templates: short, declarative, singable
  const hookTemplates = [
    '{S} {V}',
    '{S} {V} — {M}',
    '{M} — {S} {V}',
    '{S} {V}, {M}',
  ];

  // Use shorter subjects and verbs for hooks
  const shortSubjects = subjects.filter(s => s.split(' ').length <= 3);
  const shortVerbs = verbs.filter(v => v.split(' ').length <= 8);
  if (shortSubjects.length === 0 || shortVerbs.length === 0) return null;

  for (let attempt = 0; attempt < 15; attempt++) {
    const tpl = rPick(rng, hookTemplates);
    const s = rPick(rng, shortSubjects);
    let v = rPick(rng, shortVerbs);
    const m = modifiers.length > 0 ? rPick(rng, modifiers) : '';

    if (_needsThirdPerson(s)) {
      v = _conjugateThird(v);
    } else {
      v = _deconjugateToBase(v);
    }

    let line = tpl
      .replace('{S}', s)
      .replace('{V}', v)
      .replace('{M}', m)
      .replace(/\s{2,}/g, ' ').trim();

    const wordCount = line.split(/\s+/).length;
    if (wordCount < 5 || wordCount > 13) continue;
    if (songUsed && songUsed.has(line)) continue;
    if (_batchUsedLines.has(line)) continue;

    // Grammar validation
    if (/^I [a-z]+s /i.test(line) && !/^I (was|is|miss|cross|guess|press|pass|confess|process|possess|address|express|witness|dismiss) /i.test(line)) continue;
    if (/^(we|you|they) [a-z]+s /i.test(line) && !/^(we|you|they) (was|is|miss|cross|guess|press) /i.test(line)) continue;
    if (/\bmake[s]? (my |the |this |your |our |a )?\w+ [a-z]+s /i.test(line) && !/\bthat [a-z]+s\b/i.test(line)) continue;

    line = line.charAt(0).toUpperCase() + line.slice(1);
    return line;
  }
  return null;
}

function buildLine(rng, genre, songUsed, globalHist, maxRetries=20, isOpener=false, theme=null, register=null, genreKey=null, arcPhase=null) {
  // Primary pool: pre-written songwriter lines for this genre
  // Arc-phase biased: verse1=early lines, verse2=mid, bridge=late, outro=last
  const fullPool = getLinePool(genreKey);
  let pool = fullPool;
  if (arcPhase) {
    const half = Math.floor(fullPool.length / 2);
    const quarter = Math.floor(fullPool.length * 0.75);
    if (arcPhase === 'establish' || arcPhase === 'origin') {
      pool = fullPool.slice(0, Math.ceil(fullPool.length * 0.6));
    } else if (arcPhase === 'pivot' || arcPhase === 'rock_bottom') {
      pool = fullPool.slice(half);
    } else if (arcPhase === 'resolve' || arcPhase === 'victory' || arcPhase === 'impact') {
      pool = fullPool.slice(quarter);
    }
    if (pool.length < 5) pool = fullPool;
  }

  // Also pull from the legacy verbPhrases pool as a deep fallback buffer
  const verbPool = genre.verbPhrases || [];

  // Strategy: dynamic compose ratio increases as batch progresses.
  // Song 1 = ~40% composed (quality anchor), Song 10 = ~85% composed (variety).
  const composeFirst = rng() < _composeRatio;

  if (composeFirst) {
    const composed = composeLine(rng, genre, genreKey, songUsed);
    if (composed) {
      songUsed.add(composed);
      _batchUsedLines.add(composed);
      if (isOpener) { _persistentOpeners.add(composed); }
      return composed;
    }
  }

  // Collect fresh candidates from pre-written pool
  const fresh = pool.filter(l =>
    !songUsed.has(l) &&
    !_batchUsedLines.has(l) &&
    !(isOpener && _persistentOpeners.has(l)) &&
    !(isOpener && [..._persistentOpeners].some(prev => tokenOverlap(lineHash(l), lineHash(prev)) > 0.65))
  );

  if (fresh.length > 0) {
    const line = rPick(rng, fresh);
    songUsed.add(line);
    _batchUsedLines.add(line);
    if (isOpener) {
      _persistentOpeners.add(line);
    }
    return line;
  }

  // Pool exhausted — always compose
  const composed2 = composeLine(rng, genre, genreKey, songUsed);
  if (composed2) {
    songUsed.add(composed2);
    _batchUsedLines.add(composed2);
    if (isOpener) { _persistentOpeners.add(composed2); }
    return composed2;
  }

  // Pool exhausted, first compose failed — try harder with more attempts
  for (let extraAttempt = 0; extraAttempt < 20; extraAttempt++) {
    const composed3 = composeLine(rng, genre, genreKey, songUsed);
    if (composed3 && !_batchUsedLines.has(composed3)) {
      songUsed.add(composed3);
      _batchUsedLines.add(composed3);
      return composed3;
    }
  }

  // Tertiary: reuse from pool (compose exhausted after 30 total attempts)
  const fallback = rPick(rng, pool);
  songUsed.add(fallback);
  return fallback;
}

function buildHookLine(rng, genre, songUsed, globalHist, theme, register, genreKey) {
  // Try pre-written hook fragments first (never reuse any across all songs)
  const candidates = genre.hookFragments.filter(h =>
    !songUsed.has(h) && !globalHist.isDuplicate(h,0.65) && !_persistentOpeners.has(h)
  );
  if (candidates.length > 0) {
    const line = rPick(rng, candidates);
    songUsed.add(line);
    _persistentOpeners.add(line);
    globalHist.add(line);
    return line;
  }
  // All pre-written hooks used — compose a unique hook line from genre parts
  const composed = composeHookLine(rng, genre, genreKey, songUsed);
  if (composed) {
    songUsed.add(composed);
    _persistentOpeners.add(composed);
    globalHist.add(composed);
    return composed;
  }
  // Final fallback: build from verse pool
  return buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey);
}

function buildRhymedPair(rng, genre, songUsed, globalHist, firstIsOpener=false, theme=null, register=null, genreKey=null) {
  // 40% of the time, use rhyme dictionary to anchor end words — much more reliable
  if (rng() < 0.40) {
    const [wordA, wordB] = pickRhymeSet(rng, 2);
    // Build lineA and try to make it end with wordA
    let lineA = null, lineB = null;
    for (let i=0; i<6; i++) {
      const cand = buildLine(rng, genre, songUsed, globalHist, 12, firstIsOpener, theme, register, genreKey);
      if (!lineA) { lineA = cand; continue; } // take first as lineA
      if (rhymesBetter(wordA, lastWord(cand)) || rhymesBetter(wordB, lastWord(cand))) {
        lineB = cand; break;
      }
    }
    if (lineA && lineB) return [lineA, lineB];
  }
  // Fallback: original method
  const lineA = buildLine(rng, genre, songUsed, globalHist, 12, firstIsOpener, theme, register, genreKey);
  let lineB = null;
  for (let i=0; i<8; i++) {
    const candidate = buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey);
    if (rhymesBetter(lastWord(lineA), lastWord(candidate))) { lineB=candidate; break; }
  }
  if (!lineB) lineB = buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey);
  return [lineA, lineB];
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE-AWARE RHYME SCHEME TABLES
// Verse schemes and chorus/hook schemes are DIFFERENT by design
// Based on proven commercial songwriting patterns
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_RHYME_SCHEMES = {
  hiphop:    { verse: ['AAAA','AABB','ABAB','AAAB'], chorus: ['AAAA','AABA','AABB'] },
  pop:       { verse: ['ABAB','AABB'],               chorus: ['AAAA','AABA','AABB'] },
  rnb:       { verse: ['AABB','ABAB'],               chorus: ['AAAA','AABA','AABB'] },
  rock:      { verse: ['ABAB','AABB'],               chorus: ['AAAA','AABA','AABB'] },
  country:   { verse: ['AABB','ABAB'],               chorus: ['AAAA','AABA','AABB'] },
  latin:     { verse: ['AABB','ABAB'],               chorus: ['AAAA','AABA','AABB'] },
  kpop:      { verse: ['AABB','ABAB'],               chorus: ['AAAA','AABA','AABB'] },
  indie:     { verse: ['ABAB','AABB','ABCB'],        chorus: ['AAAA','AABA','AABB'] },
  electronic:{ verse: ['AABB','ABAB'],               chorus: ['AAAA','AABB'] },
  folk:      { verse: ['AABB','ABCB','ABAB'],        chorus: ['AAAA','AABA','AABB'] },
  jazz:      { verse: ['ABAB','AABB','ABCB'],        chorus: ['AAAA','AABA','AABB'] },
  gospel:    { verse: ['AABB','ABAB'],               chorus: ['AAAA','AABA','AABB'] },
  metal:     { verse: ['ABAB','AABB'],               chorus: ['AAAA','AABA','AABB'] },
  reggae:    { verse: ['AABB','ABAB'],               chorus: ['AAAA','AABA','AABB'] },
  punk:      { verse: ['AABB','ABAB'],               chorus: ['AAAA','AABA','AABB'] },
  phonk:     { verse: ['AAAA','AABB','ABAB'],        chorus: ['AAAA','AABA'] },
  drill:     { verse: ['AAAA','AABB','ABAB'],        chorus: ['AAAA','AABA','AABB'] },
  default:   { verse: ['ABAB','AABB'],               chorus: ['AAAA','AABA','AABB'] },
};

function getVerseScheme(rng, genreKey) {
  const map = GENRE_RHYME_SCHEMES[genreKey] || GENRE_RHYME_SCHEMES.default;
  return rPick(rng, map.verse);
}

function getChorusScheme(rng, genreKey) {
  const map = GENRE_RHYME_SCHEMES[genreKey] || GENRE_RHYME_SCHEMES.default;
  return rPick(rng, map.chorus);
}

function buildVerseLines(rng, genre, songUsed, globalHist, scheme='ABAB', lineCount=4, firstIsOpener=false, theme=null, register=null, genreKey=null, arcPhase=null) {
  const lines = [];

  // Helper: try to find a line rhyming with targetLine, attempt N times
  function findRhyme(targetLine, attempts=10) {
    for (let i=0; i<attempts; i++) {
      const c = buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey, arcPhase);
      if (rhymesBetter(lastWord(targetLine), lastWord(c))) return c;
    }
    return buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey);
  }

  // Use rhyme dictionary to anchor end words — guaranteed rhymes
  const [rwA, rwB, rwC, rwD] = pickRhymeSet(rng, 4);

  if (scheme === 'AABB') {
    // AA BB — two couplets, each pair shares an end rhyme
    const pairCount = Math.max(1, Math.floor(lineCount / 2));
    const anchors = [rwA, rwB, rwC, rwD];
    for (let i=0; i<pairCount; i++) {
      const anchor = anchors[i % 4];
      const a = buildAnchoredVerseLine(rng, genre, songUsed, globalHist, anchor, firstIsOpener && i===0, theme, register, genreKey, arcPhase);
      const b = buildAnchoredVerseLine(rng, genre, songUsed, globalHist, anchor, false, theme, register, genreKey, arcPhase);
      lines.push(a, b);
    }

  } else if (scheme === 'AAAA') {
    // All four lines rhyme on same sound — hip-hop / hook energy
    const count = Math.min(lineCount, 4);
    for (let i=0; i<count; i++) {
      lines.push(buildAnchoredVerseLine(rng, genre, songUsed, globalHist, rwA, firstIsOpener && i===0, theme, register, genreKey, arcPhase));
    }

  } else if (scheme === 'AAAB') {
    // Three rhyming lines, one non-rhyming payoff line
    const a1 = buildLine(rng, genre, songUsed, globalHist, 12, firstIsOpener, theme, register, genreKey);
    const a2 = findRhyme(a1, 10);
    const a3 = findRhyme(a1, 10);
    const b  = buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey);
    lines.push(a1, a2, a3, b);

  } else if (scheme === 'ABCB') {
    // Lines 2 and 4 rhyme, 1 and 3 are free — folk/indie/country feel
    const a = buildLine(rng, genre, songUsed, globalHist, 12, firstIsOpener, theme, register, genreKey, arcPhase);
    const b = buildAnchoredVerseLine(rng, genre, songUsed, globalHist, rwB, false, theme, register, genreKey, arcPhase);
    const c = buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey, arcPhase);
    const d = buildAnchoredVerseLine(rng, genre, songUsed, globalHist, rwB, false, theme, register, genreKey, arcPhase);
    lines.push(a, b, c, d);

  } else {
    // ABAB — alternating rhyme: A rhymes with C, B rhymes with D
    const a = buildAnchoredVerseLine(rng, genre, songUsed, globalHist, rwA, firstIsOpener, theme, register, genreKey, arcPhase);
    const b = buildAnchoredVerseLine(rng, genre, songUsed, globalHist, rwB, false, theme, register, genreKey, arcPhase);
    const c = buildAnchoredVerseLine(rng, genre, songUsed, globalHist, rwA, false, theme, register, genreKey, arcPhase);
    const d = buildAnchoredVerseLine(rng, genre, songUsed, globalHist, rwB, false, theme, register, genreKey, arcPhase);
    lines.push(a, b, c, d);
  }

  return lines;
}

function buildChorus(rng, genre, songUsed, globalHist, theme, register, genreKey) {
  const chorusScheme = getChorusScheme(rng, genreKey);

  // Use rhyme dictionary anchors for guaranteed end-word rhymes
  const [rhymeA, rhymeB] = pickRhymeSet(rng, 2);

  if (chorusScheme === 'AAAA') {
    // All four hook lines rhyme on same sound — chantable, catchy
    return [
      buildAnchoredHookLine(rng, genre, songUsed, globalHist, rhymeA, theme, register, genreKey),
      buildAnchoredHookLine(rng, genre, songUsed, globalHist, rhymeA, theme, register, genreKey),
      buildAnchoredHookLine(rng, genre, songUsed, globalHist, rhymeA, theme, register, genreKey),
      buildAnchoredHookLine(rng, genre, songUsed, globalHist, rhymeA, theme, register, genreKey),
    ];

  } else if (chorusScheme === 'AABA') {
    // A A B A — three A-rhymes, one pivot, returns to A
    return [
      buildAnchoredHookLine(rng, genre, songUsed, globalHist, rhymeA, theme, register, genreKey),
      buildAnchoredHookLine(rng, genre, songUsed, globalHist, rhymeA, theme, register, genreKey),
      buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey),  // B pivot
      buildAnchoredHookLine(rng, genre, songUsed, globalHist, rhymeA, theme, register, genreKey),
    ];

  } else {
    // AABB — first hook pair rhymes, second pair rhymes separately
    return [
      buildAnchoredHookLine(rng, genre, songUsed, globalHist, rhymeA, theme, register, genreKey),
      buildAnchoredHookLine(rng, genre, songUsed, globalHist, rhymeA, theme, register, genreKey),
      buildAnchoredVerseLine(rng, genre, songUsed, globalHist, rhymeB, false, theme, register, genreKey, null),
      buildAnchoredVerseLine(rng, genre, songUsed, globalHist, rhymeB, false, theme, register, genreKey, null),
    ];
  }
}

function buildBridge(rng, genre, songUsed, globalHist, theme, register, genreKey) {
  const lines = [];
  const fresh = genre.bridgeLines.filter(l =>
    !songUsed.has(l) && !globalHist.isDuplicate(l,0.65) && !_persistentOpeners.has(l)
  );
  const prewritten = rPickN(rng, fresh, Math.min(2,fresh.length));
  prewritten.forEach(l => { songUsed.add(l); globalHist.add(l); _persistentOpeners.add(l); });
  lines.push(...prewritten);
  while (lines.length < 3) lines.push(buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey));
  return lines;
}

function buildOutro(rng, genre, songUsed, globalHist, theme, register, genreKey) {
  const fresh = genre.outroLines.filter(l =>
    !songUsed.has(l) && !globalHist.isDuplicate(l,0.65) && !_persistentOpeners.has(l)
  );
  if (fresh.length > 0) {
    const line = rPick(rng, fresh);
    songUsed.add(line); globalHist.add(line); _persistentOpeners.add(line);
    return [line];
  }
  return [buildLine(rng, genre, songUsed, globalHist, 12, false, theme, register, genreKey)];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. TITLE GENERATOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getTitle(rng, genre, usedTitles, theme) {
  // Try theme-specific titles first if genre has them
  const available = genre.titles.filter(t => !usedTitles.has(t));
  if (available.length > 0) {
    const t = rPick(rng, available);
    usedTitles.add(t);
    return t;
  }
  const suffixes = ['II','III','(Acoustic)','(Reprise)','(Extended)','(Live)','(Demo)','Pt. 2','Pt. 3','(Remix)','(Alt)','Interlude','(feat. Nobody)'];
  const base = rPick(rng, genre.titles);
  return `${base} ${rPick(rng, suffixes)}`;
}

// Song fingerprint for whole-song dedup
function songFingerprint(lyrics) {
  const lines = lyrics.split('\n').filter(l => l && !l.startsWith('[') && l.trim());
  const allTokens = lines.flatMap(l => normTokens(l));
  const freq = {};
  allTokens.forEach(t => { freq[t]=(freq[t]||0)+1; });
  const top = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,30).map(e=>e[0]);
  return top.sort().join('|');
}

function songOverlap(lyricsA, lyricsB) {
  const fpA = songFingerprint(lyricsA).split('|');
  const fpB = songFingerprint(lyricsB).split('|');
  const setA=new Set(fpA), setB=new Set(fpB);
  let shared=0;
  setA.forEach(t=>{ if(setB.has(t)) shared++; });
  const union=setA.size+setB.size-shared;
  return union===0 ? 0 : shared/union;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. MAIN GENERATION PIPELINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function generateSong({ genreKey, stylePrompt='', seedInfo={}, options={}, batchIndex=0, batchCount=1 }) {
  const { allowExplicit=false } = options;
  // Dynamic compose ratio: song 1 = 40% composed, song 10 = 85% composed
  // This prevents pool exhaustion in large batches
  _composeRatio = batchCount <= 1 ? 0.50 : Math.min(0.85, 0.40 + (batchIndex / batchCount) * 0.50);
  const resolvedKey = genreKey || detectGenreKey(stylePrompt);
  const blended = buildBlendedGenre(stylePrompt);
  const genre = blended || GENRES[resolvedKey] || GENRES.default;
  const rng = makePRNG({ ...seedInfo, genre: resolvedKey, timestamp: seedInfo.timestamp||Date.now() });

  const songUsed = new Set();
  const structure = rPick(rng, genre.structures);
  // Verse scheme is picked fresh per-song; chorus scheme is handled inside buildChorus
  const rhymeScheme = getVerseScheme(rng, resolvedKey);

  const register = pickRegister(rng, resolvedKey);
  const theme = pickTheme(rng, resolvedKey, register);
  const arc = pickNarrativeArc(rng);
  const totalSections = structure.length;
  let sectionIndex = 0;

  const title = getTitle(rng, genre, _usedTitlesGlobal, theme);
  const sections = [];
  const usedChorusLines = [];
  let chorusRepeatCount = 0;
  let _songFirstLineDone = false;

  // ── Coherence System 1: Concept anchor ──
  const topicWords = (() => {
    const raw = (theme && TOPICS[resolvedKey]) ? (TOPICS[resolvedKey][theme] || []) : [];
    // Filter to noun-friendly words only — verbs/adjectives break template substitution
    const verbsAdj = new Set(['build','stay','earn','tend','keep','bloom','thaw','grow','give','make','take','find','feel','love','care','know','see','go','do','run','move','walk','rise','hold','stand','wait','leave','come','say','tell','show','hear','need','want','try','work','live','play','sing','dance','dream','hope','fight','win','lose','fail','heal','break','fix','save','give','help','trust','pray','seek','push','pull','lift','fall','turn','change','open','close','start','stop','reach','touch','create','begin','end','return','believe','accept','release','learn','teach','write','speak','listen','forget','remember','search','question','answer','struggle','suffer','survive','achieve','overcome']);
    return raw.filter(w => {
      const lower = w.toLowerCase();
      if (verbsAdj.has(lower)) return false;
      if (/^(a |an |the )/.test(lower)) return true; // "the block", "a summer" — good phrases
      if (lower.split(' ').length > 1) return true;  // multi-word phrases always ok
      if (/ing$|tion$/.test(lower) && lower.length < 8) return false; // short -ing/-tion verbs
      return true;
    });
  })();
  const conceptAnchor = pickConceptAnchor(rng, resolvedKey, theme, topicWords);
  let anchorUsed = false;

  // ── Coherence System 5: Hook callback state ──
  let hookAnchorWord = null;

  // ── Syllable targeting: extract BPM from style prompt ──
  const bpm = extractBPMFromPrompt(stylePrompt);

  let verseCount = 0;

  for (const tag of structure) {
    let lines = [];
    const tagLower = tag.toLowerCase();
    const arcPhase = getArcPhaseForSection(arc, sectionIndex++, totalSections);

    // Set syllable window for this section type
    const sectionType = tagLower.includes('chorus') || tagLower.includes('hook') || tagLower.includes('drop') ? 'hook'
      : tagLower.includes('pre') ? 'prechorus'
      : tagLower.includes('bridge') || tagLower.includes('breakdown') ? 'bridge'
      : 'verse';
    const [sylMin, sylMax] = getSyllableWindow(bpm, resolvedKey, sectionType);
    _songSyllableMin = sylMin;
    _songSyllableMax = sylMax;
    _currentSection  = sectionType;

    if (tagLower.includes('intro')) {
      lines = buildVerseLines(rng,genre,songUsed,_globalHistory,rhymeScheme,2,!_songFirstLineDone,theme,register,resolvedKey,arcPhase);
      _songFirstLineDone = true;

    } else if (tagLower.includes('verse') || tagLower.includes('verso')) {
      verseCount++;
      const isV1 = verseCount === 1;
      const isV2 = verseCount === 2;

      // ── Story beat: inject beat starter on first line
      const beatIntent = isV1 ? 'establish' : isV2 ? 'complicate' : null;
      const beatStarter = beatIntent ? getBeatStarter(rng, beatIntent, resolvedKey) : null;

      if (isV2 && hookAnchorWord) {
        // ── Coherence System 5: verse 2 last line echoes the hook anchor
        lines = buildVerseWithHookCallback(rng,genre,songUsed,_globalHistory,rhymeScheme,4,!_songFirstLineDone,theme,register,resolvedKey,arcPhase,hookAnchorWord);
      } else {
        lines = buildVerseLines(rng,genre,songUsed,_globalHistory,rhymeScheme,4,!_songFirstLineDone,theme,register,resolvedKey,arcPhase);
      }
      // Narrative coherence: scenario anchor for verse 1 and verse 2
      if (theme && (isV1 || isV2)) {
        const scenarioLine = pickScenarioLine(rng, resolvedKey, theme, songUsed);
        if (scenarioLine) lines[0] = scenarioLine;
      }
      _songFirstLineDone = true;

      // ── Coherence System 1: concept anchor — only inject if template
      // produced a full natural sentence (topic-word fragments break quality)
      if (isV1 && conceptAnchor) { anchorUsed = true; } // scenario lines handle v1 anchor now

      // ── Story beat: prepend beat starter if we got one
      if (beatStarter && lines.length > 0) {
        // Only prepend if line doesn't already start with a known starter pattern
        const firstLine = lines[0];
        const alreadyHasStarter = /^(let me|back when|this is|here's|I was|it was|out on|started|picture|the night|before all|I remember|from day|look —|hear me|but then|that's when|what they|here's where|then the|the moment|after all|what I never|in the quiet|the honest|stripped|here's what|one step|the rhythm|something honest|something building|right at|cant hold|being — almost|the feeling|we're almost|and it's|everything's been|the pressure|the signal|the frequency|the beat|the chord|the room|something unresolved|the night gets)/i.test(firstLine);
        if (!alreadyHasStarter) {
          // Only prepend if beatStarter is substantial (≥4 words) AND result ≤16 words
          const starterCore = beatStarter.trim().replace(/[—\-,]+$/, '').trim();
          const starterWordCount = starterCore.split(/\s+/).filter(w=>w.length>0).length;
          const combined = beatStarter + ' ' + firstLine;
          const totalWords = combined.split(/\s+/).length;
          if (starterWordCount >= 5 && totalWords <= 16) {
            const rest = firstLine.charAt(0).toLowerCase() + firstLine.slice(1);
            lines[0] = cap(cleanLine(beatStarter + ' ' + rest));
          }
          // Short starters skip — pool line stands alone
        }
      }

      // ── Coherence System 1: echo anchor in verse 2
      // Only inject if the echo produces a full sentence (not a word-fragment)
      if (isV2 && anchorUsed && topicWords.length > 0 && rng() < 0.40) {
        const echo = buildAnchorEcho(rng, resolvedKey, topicWords);
        if (echo && echo.trim().split(/\s+/).length >= 9) {
          lines[lines.length - 1] = cap(cleanLine(echo));
        }
      }

    } else if (tagLower.includes('pre-chorus') || tagLower.includes('pre chorus') || tagLower.includes('pre hook')) {
      // ── Coherence System 4: dedicated pre-chorus tension lines
      lines = buildPreChorus(rng,genre,songUsed,_globalHistory,theme,register,resolvedKey);

    } else if (tagLower.includes('chorus') || tagLower.includes('coro') || tagLower.includes('hook') || tagLower.includes('drop')) {
      if (usedChorusLines.length === 0) {
        const cl = buildChorus(rng,genre,songUsed,_globalHistory,theme,register,resolvedKey);
        usedChorusLines.push(...cl);
        lines = cl;
        chorusRepeatCount = 1;
        // ── Coherence System 5: extract hook anchor for verse 2 callback
        if (!hookAnchorWord && cl.length > 0) {
          hookAnchorWord = extractHookAnchor(cl[0]);
        }
      } else {
        chorusRepeatCount++;
        lines = [...usedChorusLines];
        // Final chorus: swap last line for a fresh variation to avoid pure copy-paste
        if (chorusRepeatCount >= 2 && lines.length >= 3) {
          const freshLine = buildLine(rng,genre,songUsed,_globalHistory,12,false,theme,register,resolvedKey);
          lines[lines.length - 1] = freshLine;
        }
      }

    } else if (tagLower.includes('bridge') || tagLower.includes('puente') || tagLower.includes('breakdown')) {
      // ── Story beat: pivot
      const pivotStarter = getBeatStarter(rng, 'pivot', resolvedKey);
      lines = buildBridge(rng,genre,songUsed,_globalHistory,theme,register,resolvedKey);
      if (pivotStarter && lines.length > 0) {
        const alreadyHasStarter = /^(let me|here's|what I|in the quiet|the honest|stripped|what nobody|real talk|after all|the raw|the truth is)/i.test(lines[0]);
        if (!alreadyHasStarter) {
          const rest = lines[0].charAt(0).toLowerCase() + lines[0].slice(1);
          lines[0] = cap(cleanLine(pivotStarter + ' ' + rest));
        }
      }

    } else if (tagLower.includes('outro')) {
      // ── Story beat: resolve + final anchor echo
      const resolveStarter = getBeatStarter(rng, 'resolve', resolvedKey);
      lines = buildOutro(rng,genre,songUsed,_globalHistory,theme,register,resolvedKey);
      if (resolveStarter && lines.length > 0) {
        const alreadyHasStarter = /^(so here's|at the end|what I know|after all|and still|this is where|and this is|what the years|when it's said)/i.test(lines[0]);
        const resolveCore = resolveStarter.trim().replace(/[—\-,]+$/, '').trim();
        const resolveWordCount = resolveCore.split(/\s+/).filter(w=>w.length>0).length;
        const resolveTotal = (resolveStarter + ' ' + lines[0]).split(/\s+/).length;
        if (!alreadyHasStarter && resolveWordCount >= 5 && resolveTotal <= 16) {
          const rest = lines[0].charAt(0).toLowerCase() + lines[0].slice(1);
          lines[0] = cap(cleanLine(resolveStarter + ' ' + rest));
        }
      }
      // Final anchor echo in outro
      if (anchorUsed && topicWords.length > 0 && rng() < 0.50) {
        const echo = buildAnchorEcho(rng, resolvedKey, topicWords);
        if (echo && echo.trim().split(/\s+/).length >= 9) lines.push(cap(cleanLine(echo)));
      }

    } else if (tagLower.includes('solo') || tagLower.includes('instrumental')) {
      lines = ['[Instrumental]'];
    } else if (tagLower.includes('vamp') || tagLower.includes('tag')) {
      // Vamp: repeat the last chorus line with slight variation
      if (usedChorusLines.length > 0) {
        lines = [usedChorusLines[0], usedChorusLines[0]]; // intentional repeat for vamp feel
      } else {
        lines = buildVerseLines(rng,genre,songUsed,_globalHistory,rhymeScheme,2,false,theme,register,resolvedKey);
      }
    } else {
      lines = buildVerseLines(rng,genre,songUsed,_globalHistory,rhymeScheme,4,false,theme,register,resolvedKey);
    }

    // Occasional genre adlib
    if (genre.adlibs && genre.adlibs.length > 0 && rng() < 0.20) {
      const adlib = rPick(rng, genre.adlibs);
      lines = lines.map((l,i) => i === lines.length-1 ? l + ' ' + adlib : l);
    }

    lines = lines.map(l => safetyFilter(l));
    sections.push({ tag, lines });
  }

  sections.forEach(s => s.lines.forEach(l => { if (l !== '[Instrumental]') _globalHistory.add(l); }));
  return { title, sections, genre: resolvedKey, rhymeScheme, theme, register, seedInfo };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SUNO SECTION ANNOTATION SYSTEM
// Enriches bare section tags into full Suno-format arrangement cues
// [Chorus] → [Chorus | 8 bars | full kick, layered synths, vocal stack]
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SUNO_CUES = {
  hiphop: {
    intro:       ['2 bars | sparse 808 sub, hi-hat intro','2 bars | cold piano loop, single kick','2 bars | beat drops in half, bass pulse'],
    verse:       ['8 bars | rolling hi-hats, 808 sub, snare on 2 and 4','12 bars | punchy kick-snare, minimal pads, bass sub','8 bars | trap hi-hat, 808 slides, sparse synth','10 bars | boom-bap drums, deep bass, sample chop'],
    hook:        ['8 bars | full 808, layered hi-hats, crowd vocal','8 bars | melodic hook, synth stack, heavy sub','6 bars | catchy hook, 808 bounce, clap'],
    bridge:      ['4 bars | stripped drums, pad wash','4 bars | half-time feel, echoed vocal, piano hit','4 bars | beat breakdown, single 808 pulse'],
    outro:       ['4 bars | fade 808, hi-hat roll off','4 bars | stripped beat, last vocal echo','4 bars | cold cut, silence'],
    prechorus:   ['2 bars | rising snare roll, filter sweep','2 bars | hi-hat build, 808 tension'],
    interlude:   ['4 bars | ambient pad, no drums','4 bars | sample loop, minimal percussion'],
    skit:        ['8 bars | no beat, spoken word energy'],
    breakdown:   ['4 bars | stripped to kick only, bass sub pulse'],
    beatswitch:  ['1 bar | hard cut to new BPM, new 808 pattern'],
    adliboutro:  ['4 bars | beat continues, vocal ad-libs trail off'],
  },
  pop: {
    intro:       ['2 bars | piano or synth pad alone','2 bars | electronic pulse, single note melody','2 bars | beat builds in, clap on 2 and 4'],
    verse:       ['8 bars | stripped synth, kick-clap, vocal forward','8 bars | acoustic or electric guitar, soft drums','8 bars | minimal beat, pad wash, close vocal'],
    prechorus:   ['4 bars | bass and drums build, synth riser','4 bars | claps accelerate, filter opens up','4 bars | snare roll, synth stack building'],
    chorus:      ['8 bars | full synth stack, sidechained bass, clap hits','8 bars | big layered vocals, four-on-the-floor kick','8 bars | explosive hook, punchy drums, wall of sound'],
    postchorus:  ['4 bars | hook repeat, beat stripped back, momentum hold','2 bars | riff or vocal tag, beat half-time'],
    bridge:      ['4 bars | stripped down, piano and vocal only','4 bars | ambient breakdown, single synth melody','4 bars | key shift, new harmonic color'],
    outro:       ['4 bars | stripped to vocal and pad','4 bars | reverb trail, beat fades','4 bars | final hook repeat, fade out'],
    finalchorus: ['8 bars | biggest version, stacked vocals, all elements','8 bars | key modulation up, full production peak'],
    tag:         ['2 bars | hook repeat, hold final note'],
  },
  rnb: {
    intro:       ['2 bars | warm Rhodes or keys alone','2 bars | sub bass pulse, half-time groove starts','2 bars | ambient pad, no percussion yet'],
    verse:       ['8 bars | half-time drums, pad, sub bass, intimate vocal','8 bars | sparse groove, Rhodes, whispered delivery','8 bars | brushed drums, warm synth bass, close mic'],
    prechorus:   ['2 bars | tension build, snare anticipation','2 bars | bass rises, harmony adds in'],
    chorus:      ['8 bars | full groove, vocal harmonies, punchy sub','8 bars | melodic peak, layered backing, bass lock','6 bars | hook, lush pad, rhythmic bass hit'],
    bridge:      ['4 bars | stripped to pad and vocal, key shift','4 bars | spoken word or whisper, ambient texture','4 bars | half-time breakdown, single piano note'],
    outro:       ['4 bars | fade groove, last vocal echo','4 bars | ad-lib vocal run, beat strips back'],
    interlude:   ['4 bars | ambient swell, no drums, spoken vibe'],
    adliboutro:  ['4 bars | vocal riff, groove continues, trail off'],
    finalchorus: ['8 bars | fullest production, gospel harmonies peak'],
  },
  rock: {
    intro:       ['4 bars | guitar riff alone, no drums yet','2 bars | full band drop in, immediate energy','4 bars | clean guitar builds to distortion'],
    verse:       ['8 bars | guitar-bass-drums, vocal forward','8 bars | clean verse, tight rhythm section','8 bars | crunchy rhythm guitar, snare backbeat'],
    prechorus:   ['4 bars | tension build, drums accelerate','2 bars | snare roll, guitar chord hold'],
    chorus:      ['8 bars | distorted guitar, crash cymbal, full band','8 bars | anthemic vocal, power chord hits','8 bars | big dynamics, bass thump, crowd sing'],
    bridge:      ['4 bars | stripped to voice and single instrument','4 bars | half-time feel, dark chord progression'],
    guitarsolo:  ['8 bars | lead guitar showcase, rhythm continues','16 bars | extended solo over verse changes','4 bars | brief solo fill between sections'],
    outro:       ['4 bars | guitar fade, drum fill end','4 bars | full band final hit, silence'],
    breakdown:   ['4 bars | bass and drums only, tension build'],
    tag:         ['2 bars | final chord hold, cymbal crash decay'],
    finalchorus: ['8 bars | biggest version, extra guitar layer, anthemic'],
    instrumentaloutro: ['8 bars | guitar jam, band groove, natural fade'],
  },
  country: {
    intro:       ['2 bars | acoustic guitar alone','4 bars | fiddle intro or guitar lick','2 bars | band enters on beat 2, immediate warm feel'],
    verse:       ['8 bars | acoustic guitar, light drumming, vocal storytelling','8 bars | acoustic and electric guitar, walking bass','8 bars | sparse arrangement, story front and center'],
    prechorus:   ['2 bars | build toward chorus, pedal steel swells','2 bars | snare roll, anticipation builds'],
    chorus:      ['8 bars | full band, pedal steel swell, big chorus','8 bars | electric guitar fills, bass forward, crowd moment','6 bars | anthemic hook, fiddle accent, band full'],
    bridge:      ['4 bars | stripped to guitar and vocal, key feel shift','4 bars | mandolin or banjo accent, emotional peak'],
    instrumentalbreak: ['8 bars | fiddle or steel guitar solo, band behind','4 bars | guitar break between sections'],
    outro:       ['4 bars | fade with steel guitar or acoustic','4 bars | stripped ending, single guitar note holds'],
    tag:         ['2 bars | final hook line, band stops, last word alone'],
    finalchorus: ['8 bars | biggest version, key lift, full production'],
  },
  electronic: {
    intro:       ['8 bars | ambient texture, no beat yet','4 bars | beat drops in slowly, single element at a time','4 bars | synth pad alone, atmosphere builds'],
    verse:       ['8 bars | groove established, minimal elements, vocal in','8 bars | bass line, hi-hat, melodic synth pad'],
    build:       ['8 bars | elements adding in, filter opens, energy rising','4 bars | riser sweep, snare roll, tension peak','8 bars | all elements stack, crowd energy builds'],
    drop:        ['8 bars | full bass drop, kick on every beat, synth lead hits','16 bars | peak energy, sidechain compression, crowd moment','8 bars | melodic drop, bass and lead synth, euphoria'],
    breakdown:   ['8 bars | stripped to ambient pad, beat removed','4 bars | single piano or synth, breath before rebuild','8 bars | minimal groove, tension holds'],
    break:       ['4 bars | beat stripped, ambient only','4 bars | half-time feel, filter closed'],
    outro:       ['8 bars | elements removing one by one, fade','4 bars | ambient tail, beat stops, pad holds'],
    groove:      ['8 bars | deep groove, bass-forward, hi-hat pattern','16 bars | locked groove, subtle variation, hypnotic'],
    peak:        ['8 bars | maximum energy, all elements, crowd peak'],
    predrop:     ['4 bars | riser hits, kick cuts out, drop imminent','2 bars | silence before drop, tension maximum'],
    drop2:       ['8 bars | variant drop, new element or new rhythm','8 bars | drop variation, different synth lead'],
    finaldrop:   ['16 bars | biggest version, extra percussion, climax'],
  },
  indie: {
    intro:       ['2 bars | guitar or keys alone, intimate feel','4 bars | soft drums enter, atmospheric build','2 bars | single instrument, close-mic warmth'],
    verse:       ['8 bars | lo-fi drums, guitar, close vocal','8 bars | fingerpicked guitar, minimal percussion','8 bars | ambient guitar, brushed drums, poetic delivery'],
    chorus:      ['6 bars | full band enters, drums open up, vocal soars','8 bars | jangly guitar, full drums, open reverb','8 bars | loud-quiet dynamic, bass-forward, emotional peak'],
    bridge:      ['4 bars | stripped to voice and single element','4 bars | ambient texture, key harmonic shift'],
    outro:       ['4 bars | guitar fades, reverb trail','8 bars | extended outro, instrumental fade'],
    breakdown:   ['4 bars | drums drop out, single guitar sustain'],
    guitarbreak: ['4 bars | guitar solo or interplay, vocals rest','8 bars | lead guitar melodic motif'],
    finalchorus: ['8 bars | fullest version, extra layers, emotional climax'],
    extendedoutro: ['8 bars | instrumental wind-down, natural decay'],
  },
  jazz: {
    intro:       ['4 bars | piano solo, brushed drums start soft','4 bars | walking bass intro, rhythm section enters','2 bars | vamp chord, establish feel and key'],
    verse:       ['8 bars | full rhythm section, vocal phrase delivery','8 bars | chord changes, melodic improvisation feel'],
    chorus:      ['8 bars | swung rhythm, full group, vocal peak','8 bars | horn or piano stab, full ensemble moment'],
    instrumental:['16 bars | improvised solo over changes, full support','8 bars | piano trio solo, walking bass prominent','12 bars | horn solo, comping behind, swing groove'],
    instrumentalsolo: ['16 bars | lead instrument feature, full improvisation','24 bars | extended solo, rhythm section support'],
    bridge:      ['4 bars | modulation, new harmonic territory','4 bars | rubato feel, sparse accompaniment'],
    outro:       ['4 bars | ritardando, final chord hold','4 bars | tag, piano alone last note','4 bars | trading phrases, last hit together'],
    tag:         ['4 bars | last phrase repeat, ritardando to hold'],
    head:        ['8 bars | melody played in unison, theme stated'],
    montuno:     ['8 bars | percussion spotlight, clave pattern, bass tumbao'],
  },
  gospel: {
    intro:       ['2 bars | organ swell alone','4 bars | piano intro, choir hum builds','4 bars | full band enters, crowd energy sets'],
    verse:       ['8 bars | testimony delivery, organ and piano, light drums','8 bars | choir harmony behind, intimate vocal','8 bars | full band, testifying delivery'],
    prechorus:   ['4 bars | build to praise, snare anticipation','2 bars | riser, choir voices swell'],
    chorus:      ['8 bars | full choir, organ hit, claps, drum peak','8 bars | praise break energy, tambourine, crowd moment','8 bars | big harmony, bass drum accent, celebration'],
    bridge:      ['4 bars | stripped, piano and vocal whisper, vulnerable','4 bars | spoken word testimony over soft organ'],
    vamp:        ['8 bars | repeated phrase, choir ad-lib, crowd call-and-response','8 bars | spontaneous worship, choir builds freely'],
    tag:         ['4 bars | final phrase repeats, choir holds last note','2 bars | last chord, organ sustain'],
    finalchorus: ['8 bars | biggest moment, full choir, all voices stacked'],
    spokenbr:    ['4 bars | minister speaks over soft organ'],
    outro:       ['4 bars | organ fade, choir hum, crowd settled'],
  },
  metal: {
    intro:       ['4 bars | guitar riff alone, no drums','8 bars | full band intro, blast beat entry','4 bars | clean guitar arpeggios, ominous build'],
    verse:       ['8 bars | palm-muted guitar, tight drums, aggressive delivery','8 bars | down-tuned riff, bass follows guitar, double kick','8 bars | groove riff, snare on 2 and 4'],
    prechorus:   ['2 bars | tension riff, snare accelerates','2 bars | chromatic run, drop into chorus'],
    chorus:      ['8 bars | power chords, cymbal crash, vocal peak','8 bars | anthemic riff, double bass drum, layered guitars','8 bars | full wall of sound, bass accent, crowd moment'],
    guitarsolo:  ['8 bars | shred solo over verse changes','16 bars | extended lead guitar, rhythm continues','4 bars | brief melodic solo phrase'],
    bridge:      ['4 bars | drop in energy, single note riff','4 bars | atmospheric passage, palm mutes only'],
    breakdown:   ['4 bars | half-time feel, heaviest riff, bass drop','8 bars | breakdown groove, crowd pit moment'],
    outro:       ['4 bars | final riff decay, last chord sustain','4 bars | chaos then silence'],
    finalchorus: ['8 bars | biggest version, extra guitar layer, maximum energy'],
    doublesolos: ['16 bars | two guitar solos trade, harmonic peaks'],
  },
  reggae: {
    intro:       ['4 bars | bass line alone, one-drop pattern starts','4 bars | rhythm guitar skank enters, organ bubble','2 bars | full riddim established'],
    verse:       ['8 bars | one-drop pattern, bass upbeat, vocal front','8 bars | skank guitar, nyahbinghi feel, rootsy delivery','8 bars | conscious delivery, organ bubble, bass push'],
    chorus:      ['8 bars | full riddim, percussion fills, vocal harmony','6 bars | big hook, bass accent, riddim locked','8 bars | chorus melody, organ swell, uplifting'],
    bridge:      ['4 bars | percussion breakdown, bass solo moment','4 bars | minor key shift, reflective passage'],
    dubbreak:    ['8 bars | dub echo, stripped riddim, bass forward, reverb washes','8 bars | drum and bass only, delay effects, space'],
    instrumentalbreak: ['8 bars | instrumental version of verse riddim','4 bars | percussion feature, nyahbinghi spotlight'],
    outro:       ['8 bars | dub fade, reverb trails, bass hum out','4 bars | voice and bass only, natural end'],
    tag:         ['4 bars | chorus line repeat, crowd sing-along fade'],
    montuno:     ['8 bars | percussion-led, clave and bass, no melody'],
    hook:        ['6 bars | simple catchy hook, tight riddim behind'],
  },
  folk: {
    intro:       ['2 bars | fingerpicked acoustic guitar alone','4 bars | single instrument, intimate and quiet','2 bars | banjo or fiddle sets the scene'],
    verse:       ['8 bars | fingerpicked guitar, minimal or no drums','8 bars | story delivery, natural dynamic, plain arrangement','12 bars | slow verse, poetic phrasing, voice forward'],
    chorus:      ['6 bars | group vocal, strummed guitar, warmth','8 bars | fuller sound, bass enters, communal feel','6 bars | simple melody, voice-and-guitar heart'],
    bridge:      ['4 bars | single instrument, emotional turn','4 bars | rubato feel, no percussion, breath'],
    instrumentalbreak: ['8 bars | fiddle or banjo solo, guitar behind','4 bars | guitar instrumental, breathing space'],
    outro:       ['4 bars | acoustic alone, last note rings','4 bars | voices hum, natural fade'],
    tag:         ['2 bars | final line spoken or sung softly'],
    finalchorus: ['6 bars | fullest version, everyone singing'],
    spokenbr:    ['4 bars | spoken story over soft guitar picking'],
  },
  punk: {
    intro:       ['2 bars | guitar riff, no drums yet','1 bar | count in, full band crash entry','2 bars | blast of energy, immediate drop'],
    verse:       ['8 bars | fast power chords, snare every beat','8 bars | driving rhythm, bass follows guitar exactly','4 bars | tight fast verse, bark delivery'],
    chorus:      ['8 bars | shouted hook, all instruments peak','6 bars | group shout, full band at maximum','8 bars | anthemic chorus, audience moment'],
    bridge:      ['4 bars | brief pause, single chord stab','2 bars | spoken moment or musical break'],
    guitarsolo:  ['4 bars | fast messy solo, energy only','4 bars | brief riff break between sections'],
    outro:       ['2 bars | final chord, noise stop','4 bars | speed out, last crash'],
    breakdown:   ['4 bars | half-time stomp, rhythm section heavy'],
    tag:         ['2 bars | repeat last phrase, final hit'],
    skabreak:    ['8 bars | upstroke ska rhythm, brass enters if available'],
    finalchorus: ['8 bars | biggest shout, all instruments, crowd'],
  },
  kpop: {
    intro:       ['4 bars | concept audio or spoken word','4 bars | synth pulse, rhythm builds from silence','2 bars | beat drops, immediate energy'],
    verse:       ['8 bars | layered synths, kick pattern, clean vocal delivery','8 bars | mid-energy groove, rap or melodic verse'],
    prechorus:   ['4 bars | energy builds, synth riser, vocal tension','2 bars | beat anticipation, drop hint'],
    chorus:      ['8 bars | all synths in, punchy drums, hook at peak','8 bars | full production, layered harmonies, crowd moment','8 bars | melodic peak, bass hit, stage energy'],
    bridge:      ['4 bars | stripped to minimal, emotional contrast','4 bars | acoustic or piano moment, concept depth'],
    dancebreak:  ['8 bars | instrumental only, percussion showcase','8 bars | beat minimal or complex, no vocals'],
    postchorus:  ['4 bars | hook echo, energy sustained','2 bars | chant element, crowd participation'],
    outro:       ['4 bars | fade or concept audio end','4 bars | final note, beat drops out'],
    finalchorus: ['8 bars | full production peak, extra vocal layers'],
    breakdown:   ['4 bars | drops to half-time, tension before final'],
    drop:        ['8 bars | EDM-influenced drop, maximum energy'],
    build:       ['4 bars | beat builds toward drop, riser prominent'],
  },
  drill: {
    intro:       ['2 bars | dark synth alone, no drums','4 bars | beat establishes, sliding 808','2 bars | cold drop in, bass heavy'],
    verse:       ['16 bars | fast hi-hat, sliding 808, cold delivery','8 bars | drill pattern, dark piano keys, minimal vibe','12 bars | eerie melody, tight drum pattern, street energy'],
    chorus:      ['8 bars | melodic hook, 808 bounce, catchy delivery','6 bars | simple cold hook, sliding bass, repeat-ready'],
    bridge:      ['4 bars | stripped drums, single 808 note, atmospheric','4 bars | dark piano, no hi-hat, mood shift'],
    outro:       ['4 bars | beat strips to bass only, fades cold','4 bars | cold cut, no fade'],
    prehook:     ['2 bars | rising 808 tension, hi-hat doubles'],
    hook:        ['6 bars | catchy melodic hook over drill pattern'],
    interlude:   ['4 bars | ambient dark texture, percussion removed'],
    adliboutro:  ['4 bars | beat continues, vocals trail off coldly'],
  },
  phonk: {
    intro:       ['4 bars | slowed cowbell pattern alone','4 bars | dark synth drone, beat drops in slow','2 bars | atmospheric cold open, 808 pulse'],
    verse:       ['8 bars | slowed trap beat, heavy sub, dark synth lead','8 bars | phonk hi-hat pattern, 808 with reverb, cold delivery'],
    hook:        ['4 bars | catchy hook, slowed vocal chop, bass hits','6 bars | simple hook, dark melody, heavy low end'],
    bridge:      ['4 bars | breakdown, single synth note, bass hum','4 bars | stripped to 808 and atmosphere'],
    outro:       ['4 bars | reverb trail, beat slows further','4 bars | cold fade, 808 sustain'],
    instrumental:['8 bars | pure instrumental, no vocals, phonk groove'],
    beatswitch:  ['2 bars | tempo shift, new 808 pattern drops in'],
    vamp:        ['4 bars | hook loops, crowd energy, ad-libs over'],
    extendedoutro: ['8 bars | extended reverb fade, atmospheric'],
  },
  latin: {
    intro:       ['4 bars | percussion alone, clave sets the feel','4 bars | bass and piano chord vamp','2 bars | full ensemble entrance'],
    verso:       ['8 bars | dembow rhythm, bass hit, melodic phrase','8 bars | reggaeton groove, piano or synth, storytelling'],
    coro:        ['8 bars | full production, hook vocal, bass bounce','6 bars | catchy coro, percussion fills, energy peak'],
    puente:      ['4 bars | stripped back, emotional shift','4 bars | breakdown, bass alone, percussion stop'],
    montuno:     ['8 bars | salsa percussion spotlight, clave and timbales','16 bars | extended improvisation over montuno pattern'],
    outro:       ['4 bars | percussion fade, bass sustain','4 bars | final coro echo, crowd sing out'],
    precoro:     ['2 bars | tension build, bass rises, drop incoming'],
    hook:        ['6 bars | simple hook, full riddim, catchy energy'],
    instrumentalbreak: ['8 bars | brass or guitar solo over groove'],
    finalcoro:   ['8 bars | biggest version, extra percussion, full celebration'],
  },
  default: {
    intro:       ['2 bars | opening instrumentation','4 bars | groove establishes'],
    verse:       ['8 bars | main groove, vocal delivery'],
    chorus:      ['8 bars | full production, hook peak'],
    bridge:      ['4 bars | contrast section, key change'],
    outro:       ['4 bars | fade or cold ending'],
    hook:        ['8 bars | catchy hook, full band'],
    drop:        ['8 bars | energy peak, full arrangement'],
    build:       ['4 bars | building tension toward peak'],
  },
};

// Inline lyric cues — appended to lines probabilistically
const INLINE_CUES = {
  hiphop:    ['(808 drops)','(hi-hat roll)','(snare hit)','(bass sub)','(ad-lib echo)','(beat cuts)','(bass slides)','(kick punch)','(hi-hat open)','(808 sustain)'],
  pop:       ['(clap hit)','(synth swell)','(bass drop)','(drum fill)','(riser peak)','(crowd moment)','(vocal stack)','(synth pulse)','(beat lift)','(chorus crash)'],
  rnb:       ['(pad wash)','(sub bass)','(snare ghost)','(harmony in)','(key stab)','(bass pulse)','(vocal breathe)','(Rhodes note)','(percussion fill)','(harmony peak)'],
  rock:      ['(guitar crunch)','(crash cymbal)','(bass thump)','(snare hit)','(guitar bend)','(drum fill)','(power chord)','(bass walk)','(riff drop)','(cymbal wash)'],
  country:   ['(steel guitar)','(fiddle run)','(acoustic strum)','(bass walk)','(snare crack)','(pedal steel)','(guitar fill)','(drum kick)','(fiddle accent)','(acoustic pick)'],
  electronic:['(bass drop)','(synth pulse)','(hi-hat roll)','(riser peak)','(sidechain)','(sub pulse)','(filter sweep)','(synth stab)','(bass wobble)','(percussive hit)'],
  indie:     ['(guitar jangle)','(brush drum)','(reverb tail)','(bass hum)','(strum fill)','(ambient wash)','(guitar note)','(subtle drum)','(string swell)','(acoustic note)'],
  jazz:      ['(piano fill)','(brush sweep)','(bass walk)','(horn stab)','(ride cymbal)','(chord comp)','(piano run)','(bass pluck)','(crash soft)','(rubato feel)'],
  gospel:    ['(organ swell)','(clap hit)','(choir breathe)','(tambourine)','(bass drum)','(choir peak)','(piano stab)','(organ hit)','(snare crack)','(harmony soar)'],
  metal:     ['(power chord)','(crash hit)','(double kick)','(palm mute)','(bass drop)','(snare blast)','(guitar bend)','(riff punch)','(bass thump)','(cymbal crash)'],
  reggae:    ['(bass upbeat)','(skank strum)','(snare drop)','(organ bubble)','(bass push)','(riddim lock)','(dub echo)','(percussion fill)','(bass note)','(hi-hat off)'],
  folk:      ['(acoustic strum)','(finger pick)','(gentle drum)','(bass pluck)','(fiddle note)','(harmonic ring)','(brush drum)','(chord bloom)','(banjo note)','(warm resonance)'],
  punk:      ['(power chord)','(snare crash)','(bass punch)','(cymbal smash)','(guitar stab)','(drum slam)','(riff cut)','(bass throb)','(crash hard)','(noise burst)'],
  kpop:      ['(synth layer)','(bass hit)','(percussive drop)','(vocal stack)','(chant hit)','(synth burst)','(dance cue)','(bass bounce)','(drum peak)','(synth sweep)'],
  drill:     ['(808 slide)','(hi-hat triple)','(bass tap)','(dark key hit)','(808 sustain)','(drum cold)','(bass drop)','(hi-hat open)','(eerie chord)','(bass hold)'],
  phonk:     ['(808 reverb)','(cowbell hit)','(bass slowed)','(synth drone)','(bass heavy)','(drum cold)','(808 tail)','(synth dark)','(bass wash)','(phonk stab)'],
  latin:     ['(bass hit)','(clave strike)','(percussion fill)','(timbale roll)','(bass bounce)','(congas hit)','(brass stab)','(bass accent)','(percussion peak)','(coro drop)'],
  default:   ['(beat hit)','(bass drop)','(drum fill)','(synth stab)','(crash hit)'],
};

// Bar count ranges per section type
const SECTION_BARS = {
  intro:    [2, 4],
  verse:    [8, 12],
  prechorus:[2, 4],
  chorus:   [6, 8],
  postchorus:[2, 4],
  bridge:   [4, 8],
  outro:    [4, 8],
  guitarsolo:[4, 16],
  instrumental:[8, 16],
  breakdown:[4, 8],
  drop:     [8, 16],
  build:    [4, 8],
  vamp:     [4, 8],
  tag:      [2, 4],
  default:  [4, 8],
};

function getSectionType(tagLower) {
  if (tagLower.includes('intro')) return 'intro';
  if (tagLower.includes('pre-chorus') || tagLower.includes('pre chorus') || tagLower.includes('pre-hook') || tagLower.includes('pre hook')) return 'prechorus';
  if (tagLower.includes('post-chorus') || tagLower.includes('post chorus')) return 'postchorus';
  if (tagLower.includes('chorus') || tagLower.includes('coro')) return 'chorus';
  if (tagLower.includes('hook') && !tagLower.includes('pre')) return 'hook';
  if (tagLower.includes('verse') || tagLower.includes('verso')) return 'verse';
  if (tagLower.includes('bridge') || tagLower.includes('puente')) return 'bridge';
  if (tagLower.includes('solo') || tagLower.includes('guitar')) return 'guitarsolo';
  if (tagLower.includes('drop')) return 'drop';
  if (tagLower.includes('build')) return 'build';
  if (tagLower.includes('breakdown')) return 'breakdown';
  if (tagLower.includes('vamp')) return 'vamp';
  if (tagLower.includes('tag')) return 'tag';
  if (tagLower.includes('outro')) return 'outro';
  if (tagLower.includes('instrumental') || tagLower.includes('interlude')) return 'instrumental';
  return 'default';
}

function getBarCount(sectionType, rng) {
  const range = SECTION_BARS[sectionType] || SECTION_BARS.default;
  // Pick a bar count from the range, biased toward standard values
  const val = range[0] + Math.floor(rng() * (range[1] - range[0] + 1));
  // Round to nearest even number for musical authenticity
  return Math.max(range[0], val % 2 === 0 ? val : val - 1);
}

function getInstrumentCue(genreKey, sectionType, rng) {
  const genreCues = SUNO_CUES[genreKey] || SUNO_CUES.default;
  // Latin uses verso/coro instead of verse/chorus
  const latinMap = { verse: 'verso', chorus: 'coro', bridge: 'puente' };
  const altType = genreKey === 'latin' ? (latinMap[sectionType] || sectionType) : sectionType;
  const pool = genreCues[altType] || genreCues[sectionType] || genreCues.verse || genreCues.default;
  if (!pool || pool.length === 0) return null;
  return rPick(rng, pool);
}

function buildEnrichedTag(rawTag, genreKey, rng) {
  const tagLower = rawTag.toLowerCase().replace(/[\[\]]/g, '').trim();
  const sectionType = getSectionType(tagLower);
  const bars = getBarCount(sectionType, rng);
  const cue = getInstrumentCue(genreKey, sectionType, rng);

  // Extract the clean display name from the raw tag
  const name = rawTag.replace(/[\[\]]/g, '').trim();

  if (cue) {
    return `[${name} | ${cue}]`;
  } else {
    return `[${name} | ${bars} bars]`;
  }
}

function maybeAddInlineCue(line, genreKey, rng, chance = 0.30) {
  // Don't add cues to blank lines, section tags, or [Instrumental] lines
  if (!line || line.startsWith('[') || line.trim() === '') return line;
  if (rng() > chance) return line;
  const pool = INLINE_CUES[genreKey] || INLINE_CUES.default;
  const cue = rPick(rng, pool);
  return `${line} ${cue}`;
}

function generateSongText(songObj) {
  // Use a seeded RNG for consistent annotation (same song = same cues)
  const rng = makePRNG({
    userId: 'annotation',
    sessionId: songObj.theme || 'default',
    nonce: songObj.sections ? songObj.sections.length * 7 : 0,
    genre: songObj.genre || 'default',
    songId: songObj.seedInfo ? songObj.seedInfo.songId || 0 : 0,
    timestamp: songObj.seedInfo ? songObj.seedInfo.timestamp || 0 : 0,
  });

  const genreKey = songObj.genre || 'default';

  return songObj.sections
    .map(s => {
      const enrichedTag = buildEnrichedTag(s.tag, genreKey, rng);

      // Instrument-only sections — just use buildEnrichedTag (no lyric lines)
      const tagLower = s.tag.toLowerCase();
      if (tagLower.includes('[instrumental]') || tagLower.includes('guitar solo') ||
          tagLower.includes('instrumental solo') || tagLower.includes('dub break') ||
          tagLower.includes('instrumental break') || tagLower.includes('dance break') ||
          tagLower.includes('ska break') || tagLower.includes('beat switch') ||
          tagLower.includes('montuno') || tagLower.includes('instrumental outro')) {
        return buildEnrichedTag(s.tag, genreKey, rng);
      }

      // Enrich each lyric line with probabilistic inline cues
      const enrichedLines = s.lines.map(line => {
        if (line === '[Instrumental]') return line;
        return maybeAddInlineCue(line, genreKey, rng, 0.28);
      });

      return `${enrichedTag}\n${enrichedLines.join('\n')}`;
    })
    .filter(s => s.trim())
    .join('\n\n');
}

// Global state
const _usedTitlesGlobal = new Set();
const _persistentSongHashes = new Set();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. CHROME STORAGE HOOKS + PER-INSTALL UUID
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const STORAGE_KEY_OPENERS  = 'lyricEngine_usedOpeners';
const STORAGE_KEY_NONCE    = 'lyricEngine_nonce';
const STORAGE_KEY_INSTALLID = 'lyricEngine_installId';

// Per-install random ID — generated once on first run, persisted forever.
// Ensures two users with the same prompt + genre get completely different songs.
let _installId = 'local';

function generateInstallId() {
  // crypto.randomUUID() is available in Chrome extensions (MV3)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: high-entropy random hex string
  const arr = new Uint32Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i=0;i<4;i++) arr[i] = Math.floor(Math.random()*0xFFFFFFFF);
  }
  return [...arr].map(n => n.toString(16).padStart(8,'0')).join('-');
}

async function loadOpenersFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_INSTALLID);
    if (stored) { _installId = JSON.parse(stored); }
    else { _installId = generateInstallId(); localStorage.setItem(STORAGE_KEY_INSTALLID, JSON.stringify(_installId)); }
    const openers = localStorage.getItem(STORAGE_KEY_OPENERS);
    if (openers) { JSON.parse(openers).forEach(o => _persistentOpeners.add(o)); }
    _persistentOpeners.forEach(o => _globalHistory.add(o));
    const nonce = localStorage.getItem(STORAGE_KEY_NONCE);
    return nonce ? JSON.parse(nonce) : 0;
  } catch(e) { return 0; }
}

async function saveOpenersToStorage(newOpeners, nonce) {
  try {
    newOpeners.forEach(o => _persistentOpeners.add(o));
    localStorage.setItem(STORAGE_KEY_OPENERS, JSON.stringify([..._persistentOpeners]));
    localStorage.setItem(STORAGE_KEY_NONCE, JSON.stringify(nonce));
  } catch(e) {}
}

function extractOpener(lyrics) {
  return (lyrics||'').split('\n').find(l => l && !l.startsWith('[')) || '';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. HIGH-LEVEL UI FUNCTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function generateSongsV2(stylePrompt, count, usedTitles=new Set(), sessionNonce=0) {
  const genreKey = detectGenreKey(stylePrompt);
  _batchUsedLines.clear(); // Reset batch-level dedup for each new batch
  // sessionId combines: install UUID + timestamp + random float
  // Result: two users generating at the exact same millisecond still diverge
  const sessionId = `${_installId}|${Date.now().toString(36)}|${Math.random().toString(36).slice(2)}`;
  const results = [];
  usedTitles.forEach(t => _usedTitlesGlobal.add(t));

  for (let i=0; i<count; i++) {
    let songObj, lyrics, attempts=0;
    do {
      const seedInfo = {
        userId: _installId,   // unique per install — not 'local' for everyone
        sessionId,
        nonce: sessionNonce+i+(attempts*1000),
        songId:i,
        timestamp: Date.now()+i*7+attempts*13,
        genre: genreKey,
      };
      songObj = generateSong({ genreKey, stylePrompt, seedInfo, options:{allowExplicit:false}, batchIndex:i, batchCount:count });
      lyrics = generateSongText(songObj);
      attempts++;
      const fp = songFingerprint(lyrics);
      if (_persistentSongHashes.has(fp)) continue;
      const tooSimilar = results.some(prev => songOverlap(prev.lyrics,lyrics)>0.40);
      if (tooSimilar && attempts<6) continue;
      break;
    } while(attempts<6);

    const fp = songFingerprint(lyrics);
    _persistentSongHashes.add(fp);
    results.push({ title:songObj.title, lyrics, style:stylePrompt, instrumental:false, theme:songObj.theme, register:songObj.register });
    usedTitles.add(songObj.title);
  }
  return results;
}



// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — HIP-HOP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_HIPHOP = {
  keywords: ['rap','trap','808','hip-hop','hip hop','boom bap','lyrical','g-funk','g funk','west coast rap','compton','g funk beat','laid-back rap','west coast groove','synth bass rap','california rap','g-funk groove','laid-back hip-hop','laid-back groove hop','flow','bars','verse','freestyle','kendrick','drake','travis scott','future','eminem','jay-z','kanye','nas','biggie','tupac','lil baby','j. cole','tyler the creator','metro boomin','auto-tune','autotune','punchline','gunna','lil uzi','young thug','lil wayne','a$ap rocky','megan thee stallion','jack harlow','polo g','rod wave','phonk','trap music','atlanta','new york rap','west coast rap','cloud rap','melodic rap','conscious rap','mumble rap','g-funk','gangsta rap','crunk','snap music','dirty south','chopped and screwed','houston rap','chicago drill','uk drill','boom bap hip hop','lo-fi hip hop','jazz rap','alternative hip hop','underground rap','freestyle','cypher','16 bars','diss track','gangsta','hustle','streets','flex','drip','sauce','racks','bands','gang','plug','opps','slatt','4pf','ovo sound','interscope','def jam','republic records','cash money'],
  cadenceTarget: [8,14],
  rhymeStyle: 'internal+end',
  rhymeSchemes: ['AAAA','AABB','ABAB','AAAB'],
  sectionTags: ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Bridge]','[Verse 3]','[Outro]'],
  structures: [
    // Classic 16-bar verse, 8-bar hook (Jay-Z / Eminem era)
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Bridge]','[Outro]'],
    // Verse-hook-verse, no intro (Kendrick TPAB style)
    ['[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Verse 3]','[Outro]'],
    // Pre-hook tension build (Post-Malone / Drake melodic trap)
    ['[Intro]','[Verse 1]','[Pre-Hook]','[Hook]','[Verse 2]','[Pre-Hook]','[Hook]','[Bridge]','[Outro]'],
    // Skit break mid-album (Kanye / Lil Wayne tape structure)
    ['[Skit]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Verse 3]','[Outro]'],
    // Interlude for concept albums (J. Cole / Nas)
    ['[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Interlude]','[Verse 3]','[Hook]'],
    // Bridge-before-final-hook (classic radio single)
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Bridge]','[Hook]','[Outro]'],
    // Ad-lib fadeout outro (Travis Scott / Future tape style)
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Ad-lib Outro]'],
    // Double verse opener, late hook (underground narrative rap)
    ['[Verse 1]','[Verse 2]','[Hook]','[Bridge]','[Hook]','[Outro]'],
    // Spoken word intro into story rap
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Bridge]','[Verse 3]','[Hook]'],
    // Trap banger: hook first, verse drops in (Billboard Hot 100 format)
    ['[Hook]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Bridge]','[Hook]'],
    // Cinematic: long intro / short songs (Childish Gambino / Frank Ocean)
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Outro]'],
    // Four-verse deep storytelling (Kendrick / Cole / Big K.R.I.T.)
    ['[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Verse 3]','[Hook]','[Verse 4]','[Outro]'],
    // Hook-bridge-hook finale structure (melodic trap radio hit)
    ['[Intro]','[Hook]','[Verse 1]','[Hook]','[Bridge]','[Hook]','[Outro]'],
    // Boom-bap classic: call-and-response hook (90s New York)
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Verse 3]','[Hook]','[Outro]'],
    // Minimal hook / three deep verses (Lupe Fiasco / Mos Def style)
    ['[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Verse 3]','[Hook]'],
    // Beat-switch mid-song (Travis Scott / Kanye 808s style)
    ['[Intro]','[Verse 1]','[Hook]','[Beat Switch]','[Verse 2]','[Hook]','[Outro]'],
    // Spoken word closing (Kendrick / Vince Staples concept)
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Spoken Outro]'],
    // All hook energy: party anthem trap
    ['[Hook]','[Verse 1]','[Hook]','[Verse 2]','[Bridge]','[Hook]','[Hook]'],
  ],
  adlibs: ['(yeah)','(uh)','(ayy)','(lets go)','(talk to em)','(real talk)','(no cap)','(facts)','(on God)','(woo)','(skrrt)','(mmh)','(period)','(sheesh)'],
  subjects: [
    'I','we','they','the city','my mind','the hustle','my pen','these hands','every bar',
    'the grind','my heart','the block','real ones','my past','the truth','my name',
    'these streets','my soul','the money','success','the pain','my roots','the game',
    'my people','the sacrifice','ambition','loyalty','the vision','hard work','my voice',
    'the code','this life','the culture','my journey','the crown','every verse',
    'late nights','the craft','my demons','the hunger','these walls','my legacy',
    'the foundation','this chapter','every scar','the mission','my city','the process',
    'determination','the climb','every step','the grind','this moment','my purpose',
    'the receipts','every move','the weight','this energy','my bloodline','the proof',
  ],
  verbPhrases: [
    // Origin / struggle
    'came from the bottom with nothing but a dream',
    'built this from scratch when no one believed',
    'survived what most people never see coming',
    'climbed out the dark with ink-stained hands',
    'started from less than zero and counted up',
    'turned every no into a stepping stone',
    'kept going when the whole world said stop',
    'rose from conditions that were built to hold me down',
    'made something out of what they threw away',
    'grew up watching others succeed from a distance',
    'learned the hard way what they never taught in school',
    'never had a safety net — just the will to move',
    'watched the door close and found the window open',
    'carried the weight of a neighborhood on my back',
    'wrote the first verse in the margin of a bill',
    // Grind / work
    'put in the hours when nobody was watching',
    'stayed consistent through every season of doubt',
    'sharpened every skill before the opportunity came',
    'showed up every single day without exception',
    'outworked every person in every room I entered',
    'sacrificed comfort for the vision long-term',
    'moved in silence and let the results announce themselves',
    'calculated every angle before making the move',
    'stacked every chip regardless of the size',
    'trusted the process when the process looked impossible',
    'converted every setback into a blueprint',
    'studied the craft until the craft became instinct',
    'kept the fire burning through the coldest stretches',
    'invested time where others invested excuses',
    'grinded in private to perform in public',
    // Street wisdom / mentorship
    'passed the knowledge down before anyone thought to ask for it',
    'showed the younger ones the path that nobody showed to me',
    'kept the blueprint visible so the ones behind could read it',
    'mentored without ego because the mission was bigger than credit',
    'opened the door and held it specifically for the next in line',
    // Spiritual / faith
    'prayed through the drought years when the harvest was not coming',
    'kept the faith when every visible sign said faith was foolish',
    'found the blessing hidden inside the thing that looked like punishment',
    'walked by faith through every corridor that sight could not illuminate',
    'credited the grace before claiming any of the outcome as solo',
    // Collaboration / community
    'built with the team knowing solo was faster but together was lasting',
    'lifted the whole crew because individual success alone felt hollow',
    'created spaces for others that nobody had created for me',
    'invested in the community that had invested everything in me first',
    'shared the platform before the platform was large enough to share',
    // Craft / artistry
    'rewrote the verse twenty times until the truth finally arrived correctly',
    'chose the harder word because the easier word was already everywhere',
    'listened to the silence between bars as carefully as the bars themselves',
    'made the melody carry what the lyrics could not carry alone',
    'treated every sixteen bars like a legal document for the permanent record',
    // Mental strength
    'managed the doubt without letting the doubt manage the direction',
    'separated the noise from the signal when both arrived at maximum volume',
    'protected the vision from everyone who loved me but could not see it',
    'stayed grounded when the elevation tried to change the fundamental character',
    'processed the loss forward into the work rather than away from the work',
    // Success / achievement
    'earned every dollar that has ever hit this account',
    'built the empire they said someone like me could not',
    'reached the level they said was reserved for others',
    'turned the dream into a verifiable reality',
    'stepped into rooms that once refused to open',
    'made the impossible look like the obvious path',
    'cashed every check that used to be just a thought',
    'delivered what was promised and then delivered more',
    'broke every ceiling they installed to contain me',
    'proved the doubters wrong with receipts and results',
    'achieved what ambition plus discipline actually buys',
    'collected wins in places they said held no opportunity',
    // Legacy / impact
    'carved a name into places that will outlast the body',
    'left a trail wide enough for the next generation',
    'built something that required no introduction',
    'wrote bars that found people in their lowest moments',
    'made music that outlived the trends that surrounded it',
    'carried generations forward in every lyric dropped',
    'planted seeds in soil that took years to bloom',
    'created a body of work that speaks without explanation',
    'honored the sacrifice of every ancestor by not stopping',
    'gave back to the city that made everything possible',
    // Loyalty / identity
    'kept the same energy regardless of the level',
    'stayed true to the source when the money changed the scenery',
    'protected the ones who protected me when I had nothing',
    'held the code firm when others folded for comfort',
    'chose loyalty over every more convenient alternative',
    'moved the same in the penthouse as on the block',
    'never forgot the faces that were there before the fame',
    'held my ground in every room at every pressure level',
    // Reflection / pain
    'sat with the weight of everything that almost broke me',
    'processed the grief through every verse I ever wrote',
    'turned the trauma into testimony one bar at a time',
    'found clarity in the moments when nothing made sense',
    'made peace with the parts of the story I cannot change',
    'looked back at the younger version and felt nothing but love',
    'carried the loss forward as fuel instead of anchor',
    'wrote what therapy could not quite reach alone',
    // Defiance / strength
    'refused every version of myself they tried to write for me',
    'outlasted the critics by simply continuing to exist',
    'stood in the truth when lying was the easier option',
    'pushed through pressure that would have ended others',
    'rose above circumstances that were designed to define me',
    'challenged every ceiling with consistent upward movement',
    'held the line when everything around it was collapsing',
    'came back louder every time the silence was supposed to win',
  ],
  images: [
    // Streets / origin
    'on the corner where the dreams first formed',
    'in the apartment where the heat stopped working',
    'from the block that built and broke in equal measure',
    'on the rooftop watching the city breathe at midnight',
    'in the parking lot after the session ran late',
    'through the hallway where the lights never came on',
    'at the bodega where I read the first rap magazine',
    'under the streetlight that witnessed everything',
    'in the bedroom where the first verse was ever written',
    'from the neighborhood that never made the news for good reasons',
    // Studio / craft
    'in the booth before the engineer even arrived',
    'at 3am with nothing but a notepad and a beat',
    'through every late-night session that the morning erased',
    'in the studio we built from a closet and a dream',
    'when the red light came on and the whole world got quiet',
    'with the pen moving faster than the thoughts could come',
    'in the rough mix before anyone heard the final version',
    'through the headphones where the world finally made sense',
    'when the sixteen bars became the song became the album',
    'in the session where everything clicked at the same time',
    // Struggle / pressure
    'when the money ran out and the rent was still due',
    'before the first check ever cleared the account',
    'through the winter that tested every ounce of resolve',
    'when the phone stopped ringing and the doubt got loud',
    'in the years when nothing seemed to be moving forward',
    'at the table I was never supposed to sit at',
    'through every door that had my name crossed off the list',
    'when the odds were not just against me but laughing at me',
    'before they knew the name and after they could not ignore it',
    'in the silence after every rejection letter arrived',
    // Success / arrival
    'from the basement to the stadium in the same lifetime',
    'in rooms they once said someone like me would never reach',
    'on the stage that used to exist only in imagination',
    'when the recognition finally matched the quality of the work',
    'in the moment the dream became a confirmed itinerary',
    'at the top of a climb that started from sea level',
    'when the city that raised me was watching the show',
    'in the spotlight that used to seem like someone elses',
    'past every checkpoint that was designed to stop the ascent',
    'with everything they said could not be done already done',
    // Emotion / depth
    'with the weight of every person who believed before the proof',
    'in every syllable carrying something too heavy for conversation',
    'through the verse where the tears were the punctuation',
    'when the writing said what the voice could not quite manage',
    'with the ancestors listening through every bar dropped',
    'in the legacy that lives beyond the physical',
    'at the intersection of gratitude and hunger',
    'carrying every sacrificed moment into every performed one',
    'through the grief that became the greatest motivator',
    'in the quiet between the bars where the real meaning lives',
    // Time / perspective
    'before the world attached a value to the name',
    'in the photograph from the years before the trajectory changed',
    'at the crossroads that determined the entire direction',
    'through the years that looked like failure from the outside',
    'in the chapter that almost got left out of the story',
    'when looking back required turning all the way around',
    'before the hindsight made the difficult parts make sense',
    'through every moment that seemed random but was preparation',
    'at the beginning of everything that looked like an ending',
    'in the version of this story that almost was not written',
    // New image additions
    'at the recording session where everything finally clicked into place',
    'in the tour bus at 3am somewhere between two cities on the map',
    'at the listening party where strangers knew every single word already',
    'when the engineer said that take was the one and everything confirmed it',
    'in the verse written on a napkin that became the title track',
    'at the award show thinking about the version of me that almost gave up',
    'through the crowd that waited hours just to be in the same room',
    'in the handshake that turned into the deal that turned into the album',
    'when the sample got cleared and the record finally made complete sense',
    'at the barbershop where the honest feedback was always free and accurate',
    'in the cipher where the best verse I ever wrote was never recorded',
    'when the feature call came through from the artist I grew up studying',
    'at the venue that felt too big until the crowd arrived and made it right',
    'through the catalog that tells the story more honestly than any interview',
    'in the gap between what the contract said and what the art required',
    'at the session where producer and artist both knew this was the one',
    'when the streaming numbers confirmed that the message had arrived somewhere',
    'in the DM that started the collaboration that became the defining record',
    'at the radio station that once refused to play the music that now defines them',
    'through every city on the tour where strangers sang every single word back',
  ],
  modifiers: [
    'no question','straight facts','on everything','word for word',
    'believe that','from day one','no exceptions','every single time',
    'without compromise','thats the truth','non-negotiable','period',
    'no debate','for real for real','trust that','undeniable',
    'raw and uncut','certified','and I would do it all again',
    'louder than anyone expected','without a single regret',
    'against every prediction','when nobody else believed',
    'all the way to the top','with receipts to back it up',
    'deeper than any surface reading','earned not given',
    'the hard way — no shortcuts','real as it gets',
    'documented','built to last','without apology',
    'the math checks out','front to back','no asterisk',
    'permanently','on the record','sealed','verified',
    'tested and proven','authenticated','unconditional',
    'without exception','at the highest level','full stop',
  ],
  hookFragments: [
    'never fold under pressure — the pressure made me',
    'built this from the ground up with nothing but will',
    'they counted me out — I counted every blessing instead',
    'from nothing to something the world has to acknowledge',
    'ride for my people always — that never changes',
    'the grind never stops because the dream never sleeps',
    'every obstacle was curriculum — I graduated with honors',
    'came too far to quit now — too much was paid for this',
    'I am the sum of everything I refused to let stop me',
    'the work is the proof — read every bar as evidence',
    'brick by brick — hand by hand — this is the foundation',
    'loyalty is the only currency that never devalues',
    'through the storm I found the purpose inside the pain',
    'my name in lights — earned by every dark hour before this',
    'this is more than music — this is the whole testimony',
    'let them watch the rise — every doubt fed the elevation',
    'they said it could not happen — watch the impossible daily',
    'I carry my city in every room I was never supposed to enter',
    'every scar is a line — every line is permanent',
    'the proof is in every bar ever written and meant',
    'I built the road while walking it — no map required',
    'they tried to write me off — I rewrote the entire story',
    'no one hands you the crown — you forge it from the struggle',
    'every late night was a down payment on this exact moment',
    'turned the struggle into the statement — read it carefully',
    'the receipt for every sacrifice is this right here',
    'they said wait your turn — I built my own schedule',
    'from the block to the biggest stage — every step was real',
    'I wrote my name in places they said I could not reach',
    'the hunger never left — it just got more disciplined',
    'consistency is the most underrated form of excellence',
    'I chose the difficult thing every time — that is the margin',
    'when nobody was watching I was still putting in the full work',
    'every verse is a monument to everything that tried to stop this',
    'the vision was always bigger than the current circumstances',
  ],
  bridgeLines: [
    'Look back at where I started — it is impossible to see this from there',
    'Every closed door redirected me to a better one — I understand that now',
    'The people who believed before the proof arrived — they are the real story',
    'I almost stopped once — the fact that I did not made everything else possible',
    'Some things cannot be explained — they only make sense after you survive them',
    'When the world got loud I returned to the pen — it always had the answer',
    'Every scar is a bar — every bar is a monument to something real',
    'The ones I lost never left — they ride in every verse I ever recorded',
    'I did not know what I was building — I just knew I could not stop building',
    'The critics kept score but the scoreboard was never mine to watch',
    'What I carry from the beginning is heavier and more valuable than anything earned',
    'This is not the end of the story — this is the part where it accelerates',
  ],
  outroLines: [
    'This is only the beginning — the blueprint has been laid for what comes next',
    'Everything said here was meant — that is the whole signature on this work',
    'To everyone who rode from day one — this entire journey belongs to you too',
    'The story does not end when the song does — the legacy continues forward',
    'Legacy does not stop when the lights go down — remember that always',
    'This chapter closes — the next one opens louder and more certain than ever',
    'Every word written here was earned — not a single bar was borrowed',
    'The foundation is set — what gets built on it will outlast everything',
  ],
  titles: [
    'The Blueprint','Real Talk','From Nothing','The Foundation','Testimony',
    'No Ceiling','Built Different','The Climb','My City','Every Scar',
    'Solid Ground','The Code','Legacy Lane','No Doubt','Proof of Work',
    'Still Standing','The Grind','Chapter One','Worth It','Own Lane',
    'Permanent','Currency','The Vision','Calculated','Elevate',
    'The Long Way','Standard','Earn It','Verified','The Weight',
    'Undeniable','The Process','Gold Standard','Full Circle','Architects',
    'Undefeated','Raw Material','The Receipts','Momentum','Daybreak',
    'The Mission','On Record','Foundation Work','The Ascent','Discipline',
    'No Shortcuts','All The Way','The Margin','Built to Last','Evidence',
    'First Principles','The Commitment','Hard Coded','The Standard','No Compromise',
    'The Proof','Earned','Signal and Noise','Full Send','The Investment',
    'Compound Interest','The Covenant','Honor Roll','The Ledger','Forward',
  ],
};



// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — POP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_POP = {
  keywords: ['pop','radio','hit','catchy','hook','chorus','taylor swift','dua lipa','billie eilish','olivia rodrigo','the weeknd','harry styles','ariana grande','justin bieber','ed sheeran','doja cat','lizzo','charlie puth','sabrina carpenter','beyonce','michael jackson','adele','bruno mars','selena gomez','rihanna','katy perry','lady gaga','shawn mendes','halsey','camila cabello','surfaces','conan gray','pop music','mainstream','top 40','billboard','streaming','max martin','jack antonoff','finneas','pop anthem','electropop','synth pop','dark pop','bedroom pop','indie pop','alt pop','dance pop','teen pop','bubblegum pop','power pop','sunshine pop','dreamy pop','melodic pop','radio pop'],
  cadenceTarget: [7,12],
  rhymeStyle: 'end',
  rhymeSchemes: ['ABAB','AABB'],
  sectionTags: ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
  structures: [
    // Max Martin classic: verse-prechorus-chorus machine
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Post-chorus drop structure (modern production house pop)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Post-Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Anthemic intro statement (Taylor Swift era)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Two-chorus run at the end (Dua Lipa / Olivia Rodrigo)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // Stripped-verse, explosive-chorus contrast (Adele / Lewis Capaldi)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Post-Chorus]','[Verse 2]','[Bridge]','[Chorus]'],
    // No intro: immediate verse hook tension
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Verse-chorus-verse with late pre-chorus (Ariana Grande style)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Outro breakdown instead of full chorus (Charlie Puth / Finneas)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Three-peat chorus ending (stadium pop anthem)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Chorus]','[Outro]'],
    // Confessional: verse-verse-chorus delayed reveal
    ['[Intro]','[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Double chorus at top (earworm radio format)
    ['[Intro]','[Chorus]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Call-and-response chorus (Beyoncé / Lizzo empowerment pop)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Post-Chorus]','[Verse 2]','[Bridge]','[Final Chorus]'],
    // Broken bridge structure (Billie Eilish / alternative pop)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Post-Bridge]','[Chorus]'],
    // Short-song punchy format (TikTok era pop)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Outro]'],
    // Full concept: intro sets up narrative
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Final Chorus]','[Outro]'],
    // Classic pop ballad (slow build, emotional peak)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // Stripped acoustic structure (Ed Sheeran / Shawn Mendes)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Tag]'],
    // Synth-pop banger: no bridge (ABBA / Carly Rae format)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Chorus]','[Outro]'],
  ],
  adlibs: ['(oh)','(yeah)','(hey)','(whoa)','(woo)','(come on)','(la la la)'],
  subjects: [
    'I','we','you','this feeling','the night','my heart','something','every time',
    'the light','this moment','our love','the music','these words','the world',
    'everything','my whole life','the dream','this fire','the stars','every part of me',
    'this song','the space between us','the truth','my voice','this energy',
    'every breath','the magic','something beautiful','the rhythm','the glow',
    'this rush','a feeling','the way it feels','this beat','every second',
    'something electric','the colors','the season','this frequency','the possibility',
  ],
  verbPhrases: [
    // Movement / emotion
    "can't stop thinking about this feeling everywhere I go",
    'shines brighter than every expectation they set',
    'breaks right through every ceiling above us',
    'dances until the morning comes without asking permission',
    'holds on to the feeling past the point of reason',
    'runs toward the light with everything available',
    'falls completely into the moment without reservation',
    'burns like the sun decided to live in this chest',
    'reaches up past the sky to touch whatever is above it',
    'floats above the noise and finds a different frequency',
    'chases the horizon until the horizon becomes the destination',
    'screams the whole truth to the world at maximum volume',
    'lives entirely inside this heartbeat and nowhere else',
    'spirals through the galaxy in the best possible way',
    'ignites like a star that was waiting for the match',
    // Connection
    'finds you in the middle of every crowd everywhere',
    'crashes into the feeling like it was always inevitable',
    'creates magic in the space where nothing was before',
    'turns every ordinary moment into something worth keeping',
    'makes the whole world smaller and more beautiful at once',
    'catches the light and holds it long past when it should fade',
    'builds a universe from a single look across the room',
    'connects across every distance like distance was never real',
    'makes silence sound like the best music ever written',
    'fills every empty room with something that was missing',
    // Power / confidence
    'rises past every version that existed before this one',
    'takes up space without apology or permission from anyone',
    'owns every room before setting a single foot inside it',
    'stands in the full brightness without shielding anything',
    'refuses every smaller version they tried to assign',
    'carries the crown like it was always the natural state',
    'moves through the world with the certainty of gravity',
    'claims every moment before someone else can name it',
    'shines specifically and without any need for audience',
    'becomes the frequency everyone else tunes to',
    // Joy / celebration
    'makes every heartbeat count for something unforgettable',
    'turns the volume up on living until the windows shake',
    'fills the whole sky with the specific sound of this feeling',
    'pushes past every limit that used to feel permanent',
    'runs toward everything worth having without looking back',
    'makes the music say what the words keep getting wrong',
    'carries the energy past midnight and into the next morning',
    'celebrates the fact of being alive in this specific moment',
    'finds the joy in every detail they taught me to overlook',
    'makes ordinary Tuesday feel like the best night of the year',
    // Longing / vulnerability
    'misses everything about the version of this that existed before',
    'wants this so much it becomes a physical location in the chest',
    'reaches for the feeling knowing it may not hold still',
    'holds this night inside every quiet moment that follows',
    'falls in love with being alive again without warning',
    'lets the feeling take over every carefully defended corner',
    'stays in the moment even when every instinct says protect',
    'gives everything to the song even the parts that hurt',
    'sings the part that words were invented to approach but never reach',
    'loves with the full volume regardless of the risk',
  ],
  images: [
    // SHORT FORM — 2-5 syllables (for fast BPM targeting)
    'right now','like this','tonight','right here',
    'in the light','all night','this way','so bright',
    'in the dark','like fire','right through',
    'under the city lights at full brightness',
    'when the bass drops and the whole room shifts',
    'in the middle of the crowd where everything disappears',
    'with your hand in mine like nothing outside this exists',
    'when the world falls completely quiet at the right moment',
    'in the best kind of way that requires no explanation',
    'like we own the entire night from now until dawn',
    'until the sun comes up on everything we promised',
    'beyond the horizon where the light just keeps going',
    'inside this electric dream that feels more real than waking',
    'when the melody hits the exact place it was always aimed',
    'under a million stars that all came out specifically for this',
    'on the edge of something real and terrifying and beautiful',
    'without a second thought because the thought would ruin it',
    'at the top of our lungs in the middle of wherever we are',
    'when everything finally aligns without being forced to',
    'into the golden hour before someone names it and it fades',
    'beyond what words have ever successfully said about this',
    'in a room full of people where only one direction matters',
    'until the feeling fades into something even better and calmer',
    'like nothing else in the entire universe currently exists',
    'in the neon glow of a city that never runs out of nights',
    'when the chorus drops and every defended wall comes down',
    'beside you in the chaos where calm somehow lives anyway',
    'in the eye of the storm where everything is surprisingly still',
    'at the exact moment when the song and the feeling sync',
    'through the car window at the part of the drive that matters',
    'on the dancefloor before anyone decided to be self-conscious',
    'in the last hour before dawn when honesty gets easier',
    'at the point where every good thing becomes inevitable',
    'when the room is full and somehow I find you immediately',
    'in the second after the song starts and before it has a name',
    'through every speaker in every room we have ever shared',
    'when the feeling lands before the explanation catches up',
    'at the intersection of right now and everything worth having',
  ],
  modifiers: [
    'every single night','just like that','in a flash','all at once',
    'higher than before','like never before','all the way','right now',
    'without a doubt','more than words can say','completely','endlessly',
    'forever and a day','again and again','deep inside','just like this',
    'louder every time','absolutely certain','without reservation',
    'past the point of explanation','permanently','in the best way',
    'beyond any previous understanding','exactly as it should be',
    'without any hesitation at all','purely and entirely',
    'in a way that changes the definition','unquestionably',
    'past the limit of what seemed possible','entirely',
  ],
  hookFragments: [
    "I feel it — can't you feel this too right now",
    'something in the way you move rearranges everything',
    'this is exactly where we were always supposed to be',
    "I don't want to come down from this — not ever",
    'we are completely alive and completely here',
    'nothing else matters after this moment tonight',
    'I would burn the whole careful world down to keep this feeling',
    "stay right here with me — just like this — don't move",
    'this feeling has decided it is never going to let go',
    'I am already gone — take me wherever this goes',
    'every moment with you is the definition of electric',
    'the world stops being the world when you are near',
    'I want to live inside this specific moment permanently',
    'this is everything I ever asked for and more than I knew to ask',
    'we are the ones we have been waiting for all along',
    'turn this up until it takes over everything completely',
    'there is absolutely nothing standing between us and this',
    'I want to feel exactly this way for the rest of everything',
    'you make the ordinary feel like the best song ever written',
    'I found the frequency I was searching for — it was you',
    'the night belongs to everyone brave enough to feel this',
    'I chase this feeling because nothing else has ever compared',
    'we built something that the daylight cannot touch or explain',
    "this is the part where I stop pretending I don't feel everything",
    'maybe this is what all the songs were always trying to say',
    'I would rewrite every day to arrive at this exact moment',
    'you are the reason the music sounds better than it ever did',
    'some moments become the ones you build an entire life around',
    'I would give up being careful for one more minute of this',
    'the whole world shrinks to exactly your size when you arrive',
  ],
  bridgeLines: [
    'And when the music fades I still feel something burning in the quiet',
    'I used to think moments like this only existed inside songs',
    'But here we are in the middle of the impossible made real',
    'The whole world outside can wait — I am choosing right here',
    'This is the part where I stop pretending the feeling is manageable',
    'Maybe love is simply the music we cannot stop choosing to play',
    'I do not need the forever — I just need the right now completely',
    'Turn the lights all the way down and let the feeling speak instead',
    'Every song I loved before this was pointing me in this direction',
    'I was always going to arrive here — I just did not know the name yet',
  ],
  outroLines: [
    'And just like that it is over — but I will carry this one forever',
    'The night is ending but the feeling has decided to stay permanently',
    'Some moments become the ones you build your whole life around quietly',
    'Stay just a little longer — exactly this way — please',
    'The music stops — the feeling it made never does',
    'I will spend the rest of every song trying to find this again',
  ],
  titles: [
    'Electric','Golden Hour','Alive','Something Real','The Feeling',
    'On Fire','Neon Dream','Ignite','The Rush','All Night',
    'Burnout','Gravity','Magnetic','Starlight','The Rise',
    'Euphoria','Wildfire','Signal','Radiant','The Drop',
    'Overflow','Frequency','Luminous','Momentum','Alive Again',
    'Ultraviolet','Sunrise','After Midnight','The Glow','Transcend',
    'Crystalline','Amplified','Bloom','Hurricane','Velocity',
    'Unreal','Infinite','Supernova','Breathless','Weightless',
    'Constellation','Spark','The Anthem','Pure','Drive',
    'Runaway','Wide Open','The Feeling of Being Free','Electric Love','Chemistry',
    'Golden','Night Like This','Higher','Better When','Stay Here',
    'Right Now','Inevitable','Permission','Fully','The Answer',
    'Dancefloor','Neon','Lit','Charged','Alive in Every Way',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — R&B
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_RNB = {
  keywords: ['r&b','rnb','soul','neo soul','sza','frank ocean','h.e.r.','bryson tiller','summer walker','jhene aiko','daniel caesar','brent faiyaz','alicia keys','usher','chris brown','kehlani','lucky daye','jazmine sullivan','6lack','khalid','victoria monet','teyana taylor','giveon','omar apollo','snoh aalegra','rhythm and blues','smooth','groove','sensual','bedroom','late night','slow jam','quiet storm','trap soul','alternative r&b','contemporary r&b','afro r&b','nu soul','soul music','motown','stax','atlantic','def jam r&b','island def jam','rca','epic records r&b','interlude','falsetoo','melisma','runs'],
  cadenceTarget: [7,13],
  rhymeStyle: 'end',
  rhymeSchemes: ['AABB','ABAB'],
  sectionTags: ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Outro]'],
  structures: [
    // Soul-pop crossover: prechorus tension (Drake / H.E.R.)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Intro-vamp then build (classic Usher / Beyoncé format)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Outro]'],
    // Interlude atmosphere (SZA / Frank Ocean alternative RnB)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Interlude]','[Bridge]','[Chorus]'],
    // Hook-first melodic trap RnB (6lack / Bryson Tiller)
    ['[Intro]','[Hook]','[Verse 1]','[Hook]','[Verse 2]','[Bridge]','[Hook]'],
    // Ad-lib fadeout (Ella Mai / Summer Walker)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Ad-lib Outro]'],
    // Stripped: verse-chorus, minimal sections (Jorja Smith / Sade)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Outro]'],
    // Late bridge pivot (classic neo-soul Mary J / Lauryn Hill)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Double bridge / emotional peak (SZA / Jhené Aiko)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Spoken intro into RnB groove
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // Concept interlude then vamp (Beyoncé Lemonade / D'Angelo Voodoo)
    ['[Verse 1]','[Chorus]','[Interlude]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Two-verse build before chorus (Alicia Keys / John Legend)
    ['[Intro]','[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Gospel-influenced: chorus first (Mariah / Whitney tradition)
    ['[Chorus]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Final Chorus]'],
    // Bedroom pop RnB (Brent Faiyaz / Daniel Caesar)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Tag ending with vocal run (classic soul tradition)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Tag]'],
    // Minimal: two verses wrap around single chorus
    ['[Verse 1]','[Chorus]','[Verse 2]','[Outro]'],
    // Full radio ballad (Toni Braxton / Ne-Yo era)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Final Chorus]','[Outro]'],
    // Trap soul hybrid (Khalid / Lucky Daye)
    ['[Intro]','[Hook]','[Verse 1]','[Hook]','[Bridge]','[Hook]','[Outro]'],
    // Minimalist slow jam (H.E.R. / Snoh Aalegra)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Outro]'],
  ],
  adlibs: ['(mmm)','(yeah)','(oh)','(baby)','(ooh)','(say it again)','(I know)','(tell me)','(stay)'],
  subjects: [
    'I','you','we','your touch','this silence','my heart','the night',
    'every kiss','your voice','something about you','this feeling','our story',
    'the space between us','your name','this love','every moment','the truth',
    'my whole world','something gentle','your eyes','the warmth','your presence',
    'this devotion','the ache','everything I feel','our connection','the distance',
    'your love','this longing','my soul','the warmth of you','every song',
    'what we have','this tenderness','your laugh','the morning after',
    'every breath','this patience','what you give','the quiet between us',
    'your hands','this safety','the version of us','every promise',
  ],
  verbPhrases: [
    // Devotion / depth
    'stays on my mind through every other thing that happens',
    'fills every quiet room with the specific sound of home',
    'carries me through the parts I cannot carry alone',
    'slows the whole world down to a pace I can actually live in',
    'takes me somewhere deeper than conversation ever reached',
    'makes everything finally make the kind of sense it should',
    'moves through me like a river that knows exactly where it goes',
    'heals the things that words alone could never quite reach',
    'wraps around me like a memory that decided to stay physical',
    'tells me without speaking that I am exactly enough as I am',
    // Intimacy
    'burns slow and beautiful like the best kind of devotion',
    'pulls me back every time I pretend I can move past this',
    'holds me in the dark without needing to explain the dark',
    'lights up the room by simply being present in the room',
    'spills over into everything I do when you are not nearby',
    'writes itself on my skin in a language only we can read',
    'runs through my veins whether I invite it or resist it',
    'lands soft and certain like it was always going to land here',
    'keeps me coming back regardless of every reason not to',
    'warms the coldest night by existing somewhere in the world',
    // Vulnerability
    'settles in my chest like something that belongs there permanently',
    'finds me in the quiet places I thought no one could reach',
    'draws me in so completely there is no direction back',
    'reminds me what I am worth when I have forgotten entirely',
    'threads through every hour whether I am paying attention',
    'reaches places that have never been reached before this',
    'undoes me every single time regardless of my preparation',
    'stays when everything else in the world decides to leave',
    'rises with the morning like it rested there all night',
    'answers every question I had about what love was supposed to feel like',
    // Trust / safety
    'knows me without having to ask a single question',
    'makes the silence between us feel like the most comfortable room',
    'moves in ways I do not have the vocabulary to describe yet',
    'catches me in the exact moment I stop guarding the honest part',
    'breaks down every wall I built to stay safe from exactly this',
    'fills the space between us with something neither of us named',
    'turns every ordinary moment into something I want to remember',
    'finds the part of me I keep hidden and treats it carefully',
    'loves me through the difficult seasons without requiring explanation',
    'waits without impatience — which is the realest definition of love',
    // Longing
    'shows up in the details I forgot I mentioned',
    'stays honest even when the honest thing creates discomfort',
    'sees the version I perform for everyone and looks past it',
    'holds space for everything I cannot say without pressure',
    'changes the temperature of every room by entering it',
    'makes 3am feel less like a threat and more like a conversation',
    'finds the frequency I was broadcasting but not acknowledging',
    'loves the rough draft version without waiting for the final',
    'makes the distance between two points feel negotiable',
    'gives me the specific peace I did not know had a name',
  ],
  images: [
    'in the low amber light of the room we made ours',
    'when the night breathes slow and everything else stops',
    'between the sheets and the silence that says everything',
    'underneath the city stars that are only for the awake',
    'in the hour before dawn when truth gets easier to speak',
    'with your head against my chest counting the same heartbeat',
    'in the warmth of the after when the world is reduced to this',
    'when the room is finally still and nothing is required of us',
    'in a voice that has learned to sound exactly like home',
    'through the thin walls and the dark that holds everything close',
    'in the weight of all we mean without ever saying it fully',
    'past the words we havent said because we havent had to',
    'in the smoke and the soft glow of a night with no agenda',
    'when your eyes say the exact thing your mouth has not yet chosen',
    'in every unfinished sentence that never needed the ending',
    'through the patience of a love that never needed to be loud',
    'in the way you look at 3am when defenses are not useful',
    'when everything outside this room completely dissolves',
    'in the gentleness between us that we built without blueprints',
    'through every long night we chose to be in together',
    'past the part where we pretend the feeling is casual',
    'in the warmth of your goodbye that promises the return',
    'in the language of your touch which is more precise than words',
    'when the music plays and fades and you are still the sound',
    'in the pause before you speak where everything is possible',
    'when the candle burns low and the conversation goes deeper',
    'in the way your hands feel when nothing needs to happen next',
    'before the alarm pulls us back into the world that waits',
    'when Sunday morning comes in slow and nothing is urgent',
    'in the half-remembered dream where you were there again',
    'past the point where I can hide the parts that are most real',
    'in the moment before the kiss when time selectively stops',
    'when the city noise fades out and this is all there is',
    'through the hours we forgot to count because it did not matter',
    'in the corner booth where nobody knows our names tonight',
    'when the playlist gets to the exact song and you look up',
    'past midnight when honesty stops requiring an invitation',
    'in the way your name sounds when I say it to myself slowly',
    'when the lights are all the way down and nothing is performing',
    'in every text I wrote and considered and did not send',
    'at the window while the rain decides everything is cleaner now',
    'when the room still smells like you long after you have left',
    'in the version of us that existed before it got complicated',
    'through everything we survived together that we do not name',
    'in the specific silence that only comfortable love produces',
  ],
  modifiers: [
    'so deep it scares me in the best way','like only you can do this',
    'without saying a single word','every single time without exception',
    'in ways I never knew were available','quietly and completely',
    'without asking anything in return','gently and for as long as it takes',
    'in the most honest way possible','beyond what I can translate',
    'softly and with complete certainty','like breathing in the right air',
    'naturally','inevitably','with your whole self',
    'in ways that make language feel insufficient',
    'without trying — which is the most powerful kind',
    'slowly — the good kind of slowly','past what I thought my capacity was',
    'specifically — not generally — specifically',
    'in the way that permanently changes the reference point',
    'more than I knew I needed','exactly how I needed it',
    'with a patience that teaches me what patience actually means',
    'always — not sometimes — always','in the long honest way',
    'tenderly','without condition','completely and in all directions',
  ],
  hookFragments: [
    'I was lost in ways I did not know until you found me',
    "you don't have to say a single word — I already feel all of it",
    'this is what I have been asking every song to say for years',
    'stay here — do not move — just stay exactly like this',
    'you heal the things I never showed another person ever',
    'I do not know how to love anyone else — only this',
    'we built something too real to walk away from and too good to question',
    'you are my quiet when everything is noise and my storm when I need movement',
    'nothing before this made the kind of sense that this makes',
    'the world is a gentler place when you are somewhere in it',
    'I would rather feel this specific pain than feel nothing at all',
    'this love is the slow kind — the kind that becomes the permanent fixture',
    'I never understood empty until you filled exactly that shape',
    'you found me in the place I had stopped leaving lights on in',
    'say my name like that — exactly that way — one more time',
    'just like this with nothing between us and nothing required',
    'you love the version I hide from everyone and it changes everything',
    'I have been looking for this frequency my entire life',
    'every song I loved was pointing me in your exact direction',
    'you are the reason I believe in the slow kind of everything',
    'I choose this every day — that is what love actually is',
    'you make the silence between us sound like the best music',
    'the distance between us is just geography — not reality',
    'I fell in love with who you are before I knew what to call it',
    'you are the answered question I did not know I was asking',
    'I want to deserve what you give — I am working on becoming worthy',
    'love me like you already know how this story ends happily',
    'I was not ready but you arrived anyway and I am grateful',
    'real love is quiet and certain and does not need an audience',
    'you are home — not a place — a person — and that is the whole discovery',
  ],
  bridgeLines: [
    'I have been trying to say this clearly but the words keep arriving wrong',
    'So I let the music reach the place the voice cannot get to alone',
    'You deserve more than the careful version of everything I give',
    'I loved you before I had the courage to say so — you should know that',
    'The bravest thing I ever did was let you see the complete version',
    'Not every love gets to be this tender — I am aware of that daily',
    'When I imagine the future you are already in every version of it',
    'I would choose this — I would choose you — without needing to think',
    'The thing about real love is it does not ask you to be finished first',
    'I never understood what home meant in a person until I met you',
  ],
  outroLines: [
    'This is the love I did not know I was waiting for — now I know',
    'I carry the specific warmth of you into every quiet room I enter',
    'There is no version of any world where I do not love you — I have looked',
    'Wherever we go from here — this was real — this was everything',
    'I will spend every song trying to adequately describe what this feels like',
    'This is what I was always trying to find — I am not letting go',
  ],
  titles: [
    'Slow Burn','Tender','The Low Light','Yours','Amber',
    'Present Tense','The Ache','Gravity','Still Here','Devotion',
    'After Hours','The Quiet','Just Like That','Stay','Belong',
    'Overflow','Gentle','The Way You','Soft','Undone',
    'The Weight of You','3am','Closer','Your Name','Always',
    'Warm','Honest','The Space','The Warmth','I Found You',
    'Real Love','Quiet Storm','Something Tender','All Of You','This',
    'The Forever Kind','No Distance','Patient','Gold','Holy',
    'Frequency','Worthy','The Answer','Chosen','Safe',
    'No Words','The Language','Specifically You','Come Home','The Version',
    'Unguarded','Permanent','The Discovery','Without Asking','Complete',
    'The Slow Kind','Certain','Exactly This','I Know','The Proof',
    'What Love Does','The Definition','Found','Home in You','Both',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — COUNTRY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_COUNTRY = {
  keywords: ['country','nashville','honky tonk','americana','western','acoustic','guitar','fiddle','pedal steel','banjo','twang','morgan wallen','luke combs','zach bryan','lainey wilson','chris stapleton','kacey musgraves','tyler childers','willie nelson','garth brooks','dolly parton','johnny cash','miranda lambert','zac brown band','luke bryan','outlaw country','country pop','country rock','bluegrass','appalachian','southern','red dirt country','texas country','new country','traditional country','country ballad','pickup truck','small town','heartland','back roads','front porch','bourbon','whiskey','beer','boots','hat act','classic country','alt country'],
  cadenceTarget: [7,13],
  rhymeStyle: 'end',
  rhymeSchemes: ['AABB','ABAB'],
  sectionTags: ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
  structures: [
    // Classic storytelling country (Johnny Cash / Dolly Parton)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Three-verse narrative structure (Chris Stapleton / Jason Isbell)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Chorus]'],
    // Intro-heavy: place/scene setting (Alan Jackson / Brad Paisley)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Pre-chorus build (modern country: Thomas Rhett / Sam Hunt)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Minimal: no bridge (Luke Combs / Morgan Wallen banger)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Outro]'],
    // Final chorus key change (classic Nashville tradition)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // Instrumental break mid-song (fiddle/steel showcase)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Instrumental Break]','[Chorus]'],
    // Four verses: full novel storytelling (Kris Kristofferson style)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Chorus]','[Verse 4]','[Outro]'],
    // Tag ending (classic country outro tradition)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Tag]'],
    // Spoken word verse (Kenny Rogers / Willie Nelson narrative)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Outro]'],
    // Double chorus at end (stadium country: Garth Brooks)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Chorus]'],
    // Two-verse build before first chorus (Vince Gill / Guy Clark)
    ['[Verse 1]','[Verse 2]','[Chorus]','[Verse 3]','[Bridge]','[Chorus]','[Outro]'],
    // Verse-heavy storytelling (Emmylou Harris / Townes Van Zandt)
    ['[Verse 1]','[Verse 2]','[Chorus]','[Verse 3]','[Chorus]','[Outro]'],
    // Modern country pop structure (Kacey Musgraves / Maren Morris)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Acoustic closer: stripped outro instead of outro
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // Honky-tonk: immediate chorus hook (Brooks & Dunn / ZZ Top country)
    ['[Chorus]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Final Chorus]'],
    // Short single format (modern streaming era)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Outro]'],
    // Gospel country: testimony structure (Johnny Cash / June Carter)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Tag]'],
  ],
  adlibs: [],
  subjects: [
    'I','we','daddy','mama','this old truck','the back road',
    'the porch light','Sunday morning','the gravel drive','that old house',
    'the county fair','the river bend','a small town','these boots',
    'the worn-out couch','a mason jar','the fireflies','the grain silo',
    'the corner church','harvest time','the dirt road','that rusted gate',
    'a cold beer','the pickup truck','the back forty','the creek',
    'grandmas recipe box','the tire swing','the cattle pen','that old guitar',
    'the family land','the front porch swing','a summer storm','the hollow',
    'the old barn','these callused hands','a wedding ring','the county seat',
    'Sunday dinner','the back pasture','an old photograph','the cemetery',
    'the woodstove','a handshake deal','the school bus route','the almanac',
    'the canning jars','the smokehouse','a dusty bible','the well',
  ],
  verbPhrases: [
    // Land / roots
    'raised me on red dirt and honest prayer',
    'holds the whole world together with nothing but character',
    'taught me everything worth knowing before school ever could',
    'never leaves when the seasons and the money get hard',
    'glows in the rearview mirror every time I drive away',
    'echoes through the hollow on a still September morning',
    'sits on the porch until the stars come out without being asked',
    'still smells like rain and pine and something permanent',
    'carries more history than it will ever announce to anyone',
    'makes you feel like Sunday even in the middle of the week',
    'knows every scar on these hands and never asked the reason',
    'calls me back no matter how far the road has gone',
    'built stronger than any flood that ever came through here',
    "hums through the old floorboards like a memory you can't name",
    'stands exactly where it has always stood without complaint',
    // Work / character
    'never needed much to shine — just showed up every morning',
    'taught me everything about being a man without one speech',
    'sits quiet in the dawn before the day gets complicated',
    'knows the truth I cannot quite say and holds it without pressure',
    'runs deeper than this river and truer than any contract',
    'holds more memories than any four walls could reasonably contain',
    'wears every hard season like it was always part of the plan',
    'never once asked me to be anything other than exactly this',
    'stayed through every drought and flood and doubt and harvest',
    'worked the land from before sunrise until after the dark came',
    'prayed every single morning before the coffee was finished',
    'drove three hours for the county fair without calling it a sacrifice',
    'mended the same fence line every spring without resentment',
    'planted the same seeds in the same ground season after season',
    'kept the lights on through the lean years without asking credit',
    // Community / faith
    'never sold the family land when the offers came in generous',
    'hand-wrote every letter home from wherever the road went',
    'fixed every broken thing with borrowed tools and given time',
    'waved from every front porch along the whole county route',
    'kept the old recipes in a tin box behind the everyday dishes',
    'saved the first dollar in the same coffee can for thirty years',
    'loved the same person through forty seasons without condition',
    'told the truth when lying was the considerably easier choice',
    'chose the slow road every single time the fast one was available',
    'passed the tools down without making a ceremony of the moment',
    'remembered every neighbor by name and every birthday by heart',
    'sat in the same pew for forty years beside the same people',
    // Loss / time
    'rose early every morning even when there was less to rise for',
    'prayed for rain through every drought year with stubborn faith',
    'learned to love the hard way when the easy way was not offered',
    'buried her faith like a seed and waited without impatience',
    'watched the children leave for cities and kept the lights on',
    'carried the grief forward as compost rather than anchor',
    'held the land through the years when holding was all there was',
    'walked the fence line at sundown every evening regardless',
    'worked through the pain because the work did not wait on feelings',
    'stayed when others left because some things are worth staying for',
  ],
  images: [
    // SHORT FORM — 2-5 syllables
    'back home','down the road','by the creek','at sundown',
    'in the field','come harvest','on the porch','all the same',
    'where the blacktop ends and the gravel begins the real thing',
    'past the old water tower that every local uses for directions',
    'on a Saturday in August when the whole county comes out',
    'before the first frost hits and the beauty is still visible',
    'at the end of a long honest week with nothing left to prove',
    'with the windows down the whole way regardless of the weather',
    'by the creek where we swam before we knew life got complicated',
    'when the fireflies come out so thick you could read by them',
    'on a two-lane road at sundown with nowhere to be tomorrow',
    'in the field behind the church where the real conversations happen',
    'when the wheat turns gold in August and the whole world smells right',
    'at the tailgate after dark when everyone has earned the sitting',
    'by the woodstove in November when outside is serious business',
    'on the front porch with sweet tea that nobody taught you to love',
    'when the thunder rolls in early and the sky turns that specific green',
    'with my boots still wet with dew from the morning that started it all',
    'down by the swimming hole before anyone put a name on the land',
    'on the last night of summer before school and work reclaimed everything',
    'before the rooster makes the announcement that the day is starting',
    'with the smell of hay and engine oil that means everything is fine',
    'when the mountains turn that specific purple in October at dusk',
    'at the edge of the county line where your people end and adventure begins',
    'in the shadow of the water tower where everybody meets on Friday',
    'at the bend in the dirt road where my grandfather taught me to drive',
    'when the dog days finally break and the whole county exhales together',
    'in the bed of the old pickup watching the stars take their positions',
    'past the mailbox at the end of the farm road we all know by heart',
    'when the choir sings the old hymns that everyone already knows',
    'at the end of the harvest season before the ground gets hard',
    'by the barn in the hour before dark when the animals settle',
    'in the kitchen when the biscuits are done and everything is right',
    'when the first snow covers everything and makes the world start over',
    'before the kids got old enough to want something beyond all this',
    'at the crossroads near the county seat where decisions get made',
    'in the diner on the main square where the coffee is always there',
    'when the peaches are still warm from the branch and summer is real',
    'before the interstate came through and changed the whole geometry',
    'at the cemetery on the day the whole county comes to remember',
    'in the cedar chest at the foot of the bed where the serious things live',
    'when the preacher speaks plain and true without any ornamentation',
    'at the river where every generation in this family got baptized',
    'before the family started scattering to cities with their reasons',
    'when September light falls long and gold across the whole county',
    'in the photograph from the year before everything was different',
    'on the drive that takes you past everything that made you who you are',
  ],
  modifiers: [
    'just like daddy always said without ever making it a lesson',
    "lord willing and the creek don't rise like we always understood",
    'same as it ever was and probably always will be',
    'plain as a Georgia day in the middle of July',
    'as honest as these hands that never learned a different way',
    'straight from the heart with nothing in the way of it',
    'deep as the Tennessee River in the spring when its serious',
    'right down to the bone where the real character lives',
    'every single summer without fail or reservation',
    'God willing and we keep showing up the way we always have',
    'sure as sunrise on the morning after every difficult night',
    'till the day I die and probably after if the old stories are right',
    'as sure as the seasons turn whether we are ready or not',
    'without fanfare — just quietly and with complete commitment',
    'the way good people have always done the necessary things',
    'by the grace of everything that came before and made this possible',
    'without complaint — which is the whole character right there',
    'together — the way this county has always understood that word',
    'earned — never handed — which is the only way it lasts',
    'real — not polished — real in the way that actually matters',
  ],
  hookFragments: [
    'there aint no place in the world like where you actually come from',
    "some things don't change and they absolutely should not change",
    'I would trade everything modern for one more of those days',
    'home is the only word that means exactly what it means',
    'I was born with dirt under my nails and I am proud of every bit',
    'the simple things are the ones that actually deserve keeping',
    'I do not need much — just this land and the people on it',
    'small town raised me right and I will say so in any room I enter',
    'if you know you know — and if you do not you are missing something',
    'the river always brings me back to where I belong',
    'you can leave but you cannot make the place stop being home',
    'these roads do not release the people who truly love them',
    'God and family and the land — in that order — always',
    'I would rather be honest than impressive in any room',
    'slow down — this is the part of the story worth remembering',
    'this is the life I chose and I would choose it again today',
    'some roots grow deep enough to hold through any storm that arrives',
    'a good name is worth more than any number in any account',
    'the land remembers every single thing you do to it',
    'nobody ever fully left here — they just moved the body',
    'we do not come from much but we are rich in the ways that count',
    'you learn who you are by what you keep coming back to',
    'the hard work was never for the money — it was for the standing',
    'faith and neighbors and a note thats paid — thats the whole dream',
    'some places shape you in ways you cannot understand until you are far away',
    'I would rather sit on this specific porch than anywhere else on earth',
    'the beauty of a simple life is that it is not simple at all',
    'we were raised on handshakes and the word being the bond',
    'the best things here do not appear on any map or any list',
    'every season teaches something to the ones paying attention',
    'this land fed us and shaped us and we owe it everything',
    'I have been to the city and I always come back to this',
    'what they call simple I call fundamental — there is a difference',
    'the creek does not care about your schedule — only the rain',
    'generations of people loved this ground before I got here',
  ],
  bridgeLines: [
    'Mama always said the land will outlast every one of us — she was right',
    'There is a kind of rich that no paycheck can measure — I grew up on it',
    'I left once thinking I would find something better — I found something different',
    'Every time the road brought me back I swore I would stop leaving',
    'These scars on my hands are a better autobiography than any book could be',
    'The people who built this place never asked for recognition — that is the character',
    'I would give anything in the world to sit at that table one more time',
    'Some places raise you — this one made me who I actually am',
    'My grandfather never said much but what he did with his hands said everything',
    'I understand now what I could not understand when I was in the middle of it',
    'The church bell on Sunday morning is the most honest sound I know',
    'Some people spend a lifetime searching for what was here the whole time',
  ],
  outroLines: [
    'This is where I come from — I would not trade a callus for any comfort',
    'Long after I am gone these roads will still be here — that means something',
    'Take care of the land and the land takes care of you — thats the whole sermon',
    'I will see you down the road — same time same place same heart',
    'Everything I need was here before I knew I needed anything',
    'The county line is just a line — home is a feeling that travels with you',
    'Whatever the world offers I know what I would come back to every time',
    'This is the inheritance that matters — the rest is just paperwork',
  ],
  titles: [
    'Red Dirt Road','Back Home','Porch Light','Gravel and Grace',
    'Tobacco and Prayer','The Creek','Honest Work','Small Town Summer',
    'Before the Frost','Dirt Under My Nails','The River Remembers',
    'County Line','Homecoming','The Long Way Back','Old Truck',
    'Every Season','The Farm','Hard Seasons','Sunday Morning',
    'Good Bones','The Flood','What We Built','Plain Honest',
    'Fireflies','Simple Things','Raised Right','The Hollow',
    'Down the Road','One More Summer','Wild Plum','Gods Country',
    'The Land','Breadwinner','Front Porch','Gravel Road',
    'September Rain','The Well','Better Days','Two-Lane','Harvest',
    'The Old Way','Before the Interstate','Family Land','The Almanac',
    'Good People','The Commitment','Handshake Deal','Country Miles',
    'Deep Roots','The Ceremony','What We Kept','Soil and Seed',
    'The Pew','Calloused','Staying Power','The Promise','Known',
    'Before the Scatter','The Inheritance','Fixed','Still Standing Here','Home',
  ],
};



// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — ROCK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_ROCK = {
  keywords: ['rock','guitar','riff','distortion','amplifier','grunge','alternative','indie rock','tame impala','cage the elephant','coldplay','the 1975','imagine dragons','twenty one pilots','foo fighters','arctic monkeys','nirvana','red hot chili peppers','jack white','the strokes','queens of the stone age','muse','the black keys','paramore','led zeppelin','pink floyd','the beatles','rolling stones','bob dylan','david bowie','classic rock','psychedelic rock','shoegaze','post-punk','garage rock','art rock','progressive rock','hard rock','soft rock','stoner rock','desert rock','math rock','emo','post-rock','arena rock','stadium rock','power pop','jangle pop','post rock','blues rock'],
  cadenceTarget: [7,13],
  rhymeStyle: 'end',
  rhymeSchemes: ['ABAB','AABB'],
  sectionTags: ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
  structures: [
    // Classic rock radio single (Foo Fighters / Green Day)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Guitar solo showcase (classic rock tradition: Zeppelin / Queen)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Guitar Solo]','[Chorus]'],
    // Full arrangement with solo and bridge (AC/DC / Aerosmith)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Guitar Solo]','[Chorus]'],
    // Pre-chorus tension build (Linkin Park / Breaking Benjamin)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Two-verse setup before chorus drop (Muse / Radiohead)
    ['[Verse 1]','[Verse 2]','[Chorus]','[Guitar Solo]','[Bridge]','[Chorus]','[Outro]'],
    // Riff-forward: intro riff sets the tone (Black Sabbath / Metallica)
    ['[Intro]','[Verse 1]','[Chorus]','[Bridge]','[Guitar Solo]','[Chorus]','[Outro]'],
    // Stadium closer: final chorus repeat (U2 / Bruce Springsteen)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Guitar Solo]','[Bridge]','[Final Chorus]'],
    // Breakdown then rebuild (heavy rock: Tool / Audioslave)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Breakdown]','[Chorus]'],
    // Tag ending (classic rock coda tradition)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Tag]'],
    // Stripped acoustic then full band (acoustic-electric contrast)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Outro]'],
    // Verse-heavy: three verses with late solo (storytelling rock)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Guitar Solo]','[Chorus]'],
    // Modern rock: post-chorus hook (Imagine Dragons / Twenty One Pilots)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Post-Chorus]','[Verse 2]','[Bridge]','[Chorus]'],
    // No solo, bridge-heavy (alternative rock: The National / Interpol)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Hard rock opener: chorus first (Guns N Roses / Van Halen)
    ['[Chorus]','[Verse 1]','[Chorus]','[Verse 2]','[Guitar Solo]','[Bridge]','[Final Chorus]'],
    // Double guitar solo (progressive rock / classic metal crossover)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Guitar Solo]','[Bridge]','[Guitar Solo]','[Final Chorus]'],
    // Minimal rock: verse-chorus-verse (Nirvana / Pixies influence)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // Slow build: long verse before first chorus (Porcupine Tree / Pink Floyd)
    ['[Intro]','[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Outro jam: extended instrumental ending (Allman Brothers / Dead style)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Instrumental Outro]'],
  ],
  adlibs: [],
  subjects: [
    'I','we','the noise','the machine','the static','this rage',
    'the signal','something broken','the current','this wreckage',
    'the feedback','a restless thing','the voltage','this engine',
    'the pressure','every nerve','the circuit','this hunger',
    'the drive','something raw','the distortion','this night',
    'the weight','every flaw','the crack','this fire',
    'the edge','something true','the storm','this voice',
    'the road','every scar','the wire','this body',
    'the pulse','something wrong','the static','this fury',
    'the truth','every wall','the amplifier','this city',
    'the wreckage','something real','the threshold','this beat',
  ],
  verbPhrases: [
    // Defiance / rebellion
    "won't be silenced by anything they build to contain it",
    'burns straight through every wall they installed as permanent',
    'cuts right to the bone without stopping for permission',
    'screams through every speaker until something finally gives',
    'tears the entire comfortable structure down from the inside',
    'breaks before it bends — that is the only honest physics',
    'runs against every current in every direction they defined',
    'crashes through every ceiling they guaranteed was permanent',
    'refuses every cage regardless of how elegant the design',
    'bleeds out completely into the open rather than concealing',
    'collides with the truth at the speed they said was reckless',
    'will not apologize for existing at this specific volume',
    'drives straight through the night without slowing for comfort',
    'ignites without warning from the smallest available spark',
    'overloads the circuit they said had sufficient capacity',
    // Energy / velocity
    'rises from every wreckage they were sure was permanent',
    'shakes every foundation they assumed was beyond question',
    'lives inside the feedback loop they tried to eliminate',
    'splits the sky in two with what was always inside it',
    'reverberates through every wall they said would not carry',
    'outlasts every system built specifically to outlast it',
    'holds its shape in the chaos when everything else dissolves',
    'makes the silence louder when it finally stops for one breath',
    'strips away everything comfortable that covered the actual thing',
    'turns the volume up on everything until the honest truth emerges',
    // Identity / truth
    'refuses to dissolve into anything more manageable than this',
    'finds every fault line and breaks along the genuine fracture',
    'leans into every distortion rather than correcting for it',
    'runs on pure adrenaline and something that looks like spite',
    'swallows every noise and produces something more honest back',
    'plays louder than any emptiness that surrounded it before',
    'builds momentum past the clear point of comfortable stopping',
    'draws blood from the instrument with what was always inside',
    'howls at every frequency they said could not carry a message',
    'outlives every attempt to package it into something manageable',
    // Catharsis / rawness
    'makes the ordinary feel like a declaration when played correctly',
    'converts every frustration into something with a proper melody',
    'wears every piece of damage like the badge it actually earned',
    'thrives in every uncomfortable key they said should be avoided',
    'turns the frustration into the riff rather than away from it',
    'defies every suggestion to bring the volume to a reasonable level',
    'finds every nerve and contacts it at the correct pressure',
    'refuses to resolve neatly because neat was never the point',
    'burns the entire careful script and starts over from the real thing',
    'comes back louder every single time the silence tried to win',
    // Searching / restlessness
    'lives between every crack they forgot to seal completely',
    'drives at full speed into the dark without needing the destination',
    'pushes through every pressure that would have finished others',
    'outlasts every critic by the simple act of continuing to exist',
    'holds the line when everything surrounding it is in collapse',
    'comes alive at the exact volume they said was unnecessary',
    'stands in the truth even when the lie was the easier physics',
    'moves through every wall they assured would not give',
    'speaks in the decibels they specifically asked to reduce',
    'finds the frequency they tried to filter out as noise',
  ],
  images: [
    'in the feedback and the beautiful fire it produces',
    'when the distortion finally kicks in and honesty arrives',
    'on the underside of everything that looked clean from above',
    'in the amplified dark where the real sounds actually live',
    'through the noise and the signal and the space between them',
    'in the pressure building behind both eyes at the same time',
    'on the edge of something important that is about to break open',
    'at the junction of want and rage where the best music lives',
    'through the static of every airwave they said carried nothing',
    'in the crack of the overdrive when the feeling gets honest',
    'when the snare hits like an argument that was always coming',
    'in the gut of every crowd that ever needed this specific sound',
    'at the center of every spiral before the resolution arrives',
    'through every blown speaker that gave everything it had',
    'in the open wound of the present before the scab arrives',
    'when the whole sky shakes from something too large to contain',
    'at the end of every long highway that leads somewhere honest',
    'in the grain of every riff that carries something unsaid',
    'where the melody meets the wreckage and something new forms',
    'under the fluorescent lights where real life actually happens',
    'in the space the echo leaves when the sound finally stops',
    'through the dark at the speed they said was not survivable',
    'when the marshall stack finally speaks after the long silence',
    'in the van on the long drive to the next honest performance',
    'at the back of every venue before the doors are opened',
    'when the crowd stops being strangers and becomes the single thing',
    'through the floor monitor shaking everything including the bones',
    'in the last song of the set when everything is already spent',
    'when the pick contacts the string at complete velocity',
    'at 2am after every piece of equipment has been loaded out',
    'in the rehearsal space with the door closed and nothing performed',
    'when the bridge finally resolves after the tension that earned it',
    'through every mile of every tour highway at every hour',
    'at the point of no return in the build that cannot stop now',
    'in the ringing after everything finally goes quiet enough',
  ],
  modifiers: [
    'without apology or any request for permission',
    'at the correct volume for what this actually is',
    'raw and unfiltered the way it was always supposed to arrive',
    'louder than every comfortable expectation they had',
    'completely and without any deference to the manageable version',
    'honest in the way that polite things cannot afford to be',
    'past every limit they installed and called permanent',
    'with the full force of everything that was held back before',
    'no holding back — that was never the agreement here',
    'stripped of everything they added to make it acceptable',
    'at full velocity — the only speed this was ever built for',
    'refusing every softening they offered as improvement',
    'exactly as loud as the feeling that produced it demands',
    'in the key that makes everything else feel insufficient',
    'forward — the only direction this was ever going to move',
    'permanently — not just for the duration of the comfortable part',
    'until the walls understand what was always being said',
    'for real this time — not the performance of it',
    'with everything left — holding nothing in reserve',
    'undiluted — the way original things insist on being',
  ],
  hookFragments: [
    'we were never going to be quiet — that was never the option',
    'this is the sound of something that refused to be managed',
    'I am still here and louder than the version you tried to silence',
    'we built this from nothing but voltage and genuine frustration',
    'the noise is the message — listen to what it is actually saying',
    'I would rather break than bend into a shape I was not built for',
    'everything they tried to filter out became the whole frequency',
    'this is what real sounds like when it stops performing real',
    'the walls were always going to come down — this was inevitable',
    'we are the static in every signal they said was clean',
    'I gave up being careful and everything finally got honest',
    'turn this up until the feeling is the same size as the truth',
    'the guitar says what the voice was too afraid to commit to',
    'we were always too loud for the room — we chose the right room',
    'I am done asking permission to exist at this specific volume',
    'the distortion is not the problem — it is the whole point',
    'nothing about this was ever supposed to be comfortable',
    'we drove all night to play for everyone who needed this sound',
    'the riff is the argument — the solo is the proof',
    'I found the frequency they called noise and made it home',
    'this is the part where we stop pretending we can be contained',
    'every scar on this guitar has a story worth the whole set',
    'the louder we play the more clearly the true thing is said',
    'we are not done until the silence after means something',
    'I would rather burn honest than shine performed',
  ],
  bridgeLines: [
    'There is a version of this that is quieter and it is not the true version',
    'We drove three thousand miles to say this to anyone who needed it',
    'The instrument knows what I mean even when the words come out wrong',
    'Some things can only be said at this specific volume — that is the whole point',
    'I would not trade a single blown speaker for a comfortable compromise',
    'The crowd knew the words before we played them — that means something real',
    'Every rehearsal was for this moment and this moment keeps being worth it',
    'The noise was always information — you just needed the right ears for it',
    'We are not performing anger — this is what honesty sounds like amplified',
    'After the show the silence is the loudest thing we ever produced',
  ],
  outroLines: [
    'We said everything we came to say and the speakers carry the rest',
    'The ringing in your ears means something was transmitted correctly tonight',
    'Turn it up on the drive home — let it say the thing you cannot',
    'This was never supposed to be comfortable — I hope it was not',
    'The honest thing was always the loud thing — that has not changed',
    'We will be back when we have something else this important to say',
  ],
  titles: [
    'Signal and Noise','Voltage','The Riff','Alive in the Static',
    'Blown Speaker','Full Volume','The Current','Against the Grain',
    'Distortion','The Wire','Raw','Everything Loud',
    'Overdrive','The Edge','Frequency','Honest Noise',
    'The Amplifier','Full Speed','Circuit Breaker','The Feedback',
    'Threshold','Wide Open','The Fault Line','No Filter',
    'All The Way Down','The Velocity','Uncontained','Live Wire',
    'The Wreckage','Full Blast','The Break','Unmanaged',
    'The Honest Thing','Loud','Everything Left','No Ceiling',
    'The Last Set','Permanent Damage','The Resolution','Stripped',
    'Aftershock','The Argument','Drive','What We Built',
    'The Truth At Volume','Unfiltered','The Road','Still Standing',
    'The Rehearsal','After the Show','The Agreement','At Full Speed',
    'No Compromise','The Static','Voltage Check','The Real Thing',
    'Last Call','The Whole Point','Earned','The Frequency',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — ELECTRONIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_ELECTRONIC = {
  keywords: ['edm','electronic','house','techno','trance','dubstep','dj','bass','daft punk','flume','four tet','skrillex','bonobo','moderat','jamie xx','calvin harris','the chainsmokers','marshmello','diplo','fisher','fred again','disclosure','kaytranada','burial','synth','synthesizer music','synthesizer lead','808 bass','samples','loop','drop','build up','festival','club','rave','dance music','ambient','trip hop','downtempo','drum and bass','jungle','footwork','juke','garage','uk garage','2-step','deep house','tech house','progressive house','big room','future bass','future house','lo-fi beats','lo-fi hip hop','chillwave','vaporwave','synthwave','retrowave','hyperpop','glitch hop','bass music','hardstyle','psytrance'],
  cadenceTarget: [6,11],
  rhymeStyle: 'end',
  rhymeSchemes: ['AABB','ABAB'],
  sectionTags: ['[Intro]','[Verse 1]','[Build]','[Drop]','[Verse 2]','[Build]','[Drop]','[Breakdown]','[Outro]'],
  structures: [
    // Classic drop structure (EDM festival: Avicii / Swedish House Mafia)
    ['[Intro]','[Verse 1]','[Build]','[Drop]','[Verse 2]','[Drop]','[Breakdown]','[Outro]'],
    // Build-first: no intro (techno / house opening)
    ['[Build]','[Drop]','[Verse 1]','[Build]','[Drop]','[Outro]'],
    // Breakdown showcase (progressive house: Eric Prydz / Deadmau5)
    ['[Intro]','[Verse 1]','[Drop]','[Verse 2]','[Drop]','[Breakdown]','[Outro]'],
    // Verse-build-drop with atmospheric breakdown (Flume / Bonobo)
    ['[Verse 1]','[Build]','[Drop]','[Breakdown]','[Drop]','[Outro]'],
    // Double drop: two different drop variants (Martin Garrix style)
    ['[Intro]','[Build]','[Drop 1]','[Breakdown]','[Build]','[Drop 2]','[Outro]'],
    // Vocal-forward electronic (Banks / BANKS / Ellie Goulding EDM)
    ['[Intro]','[Verse 1]','[Pre-Drop]','[Drop]','[Verse 2]','[Bridge]','[Drop]','[Outro]'],
    // Ambient intro into banger (Deadmau5 / Four Tet)
    ['[Intro]','[Verse 1]','[Drop]','[Breakdown]','[Verse 2]','[Drop]','[Outro]'],
    // Minimal techno: no vocals, pure drop energy
    ['[Intro]','[Build]','[Drop]','[Break]','[Drop]','[Outro]'],
    // Future bass: melodic drop structure (Illenium / Said The Sky)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Build]','[Drop]','[Outro]'],
    // House groove: no big drop, just groove build (Todd Terry / Larry Heard)
    ['[Intro]','[Groove 1]','[Build]','[Peak]','[Groove 2]','[Break]','[Outro]'],
    // DnB: breakbeat structure (Goldie / LTJ Bukem / Chase & Status)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Breakdown]','[Outro]'],
    // Trance: extended build (Above & Beyond / Tiesto)
    ['[Intro]','[Verse 1]','[Build]','[Drop]','[Breakdown]','[Build]','[Drop]','[Outro]'],
    // Post-drop verse (surprise lyric after the drop)
    ['[Build]','[Drop]','[Verse 1]','[Build]','[Drop]','[Breakdown]','[Drop]','[Outro]'],
    // Trip-hop / downtempo (Massive Attack / Portishead)
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Bridge]','[Outro]'],
    // Cinematic: long build no drop (Jon Hopkins / Brian Eno)
    ['[Intro]','[Verse 1]','[Build]','[Peak]','[Breakdown]','[Outro]'],
    // Festival main stage anthem (Calvin Harris / Daft Punk)
    ['[Intro]','[Verse 1]','[Pre-Drop]','[Drop]','[Verse 2]','[Drop]','[Bridge]','[Final Drop]','[Outro]'],
    // Bass music: half-time drop (Skrillex / Zeds Dead dubstep)
    ['[Intro]','[Build]','[Drop]','[Verse 1]','[Build]','[Drop]','[Outro]'],
    // Deep house: no big moment, pure vibe (Kerri Chandler / Larry Heard)
    ['[Intro]','[Groove]','[Verse 1]','[Groove]','[Break]','[Groove]','[Outro]'],
  ],
  adlibs: ['(yes)','(feel it)','(go)','(drop it)','(lets go)','(higher)','(again)'],
  subjects: [
    'the beat','the frequency','the pulse','this moment','the current',
    'something electric','the signal','this feeling','the wave','the bass',
    'the rhythm','this energy','the drop','the circuit','something infinite',
    'the grid','this night','the loop','the resonance','every particle',
    'the synthesis','this vibration','the algorithm','the flow','something pure',
    'the pattern','this release','the sequence','the voltage','every heartbeat',
    'the system','this frequency','the current','the oscillation','something vast',
    'the architecture','this descent','the modulation','the movement','everything',
    'the collective','this moment','the transmission','the signal','the field',
  ],
  verbPhrases: [
    // Movement / dance
    'moves through every body in the room simultaneously',
    'drops at exactly the moment the tension becomes unbearable',
    'builds until the pressure has nowhere left to go but release',
    'pulses through the floor and up into every waiting spine',
    'lifts the entire room to a frequency above the ordinary',
    'resonates in the chest long after the speaker has gone quiet',
    'syncs every heartbeat in the space into a single shared rhythm',
    'carries the crowd somewhere beyond the venue and the night',
    'locks into the groove that the body recognized before the mind',
    'transforms the room into something none of them planned to enter',
    // Transcendence / space
    'dissolves every boundary between the bodies in the dark',
    'transcends every category they put around it for safety',
    'opens a frequency in the chest that had been waiting for this',
    'expands past every horizon they drew around the possible',
    'releases something that was coiled and waiting for the right signal',
    'connects every separate point into a single vibrating field',
    'reaches beyond the physical into the purely sensed',
    'folds time into a loop that none of them want to exit',
    'elevates the ordinary night into something with a different gravity',
    'makes the dark feel like the most honest available brightness',
    // Synthesis / technology
    'synthesizes everything lost into something newly found',
    'processes the grief through the architecture of the beat',
    'encodes the feeling in a sequence only the body can read',
    'transmits something beyond the range of ordinary language',
    'oscillates between what was and what the music insists is possible',
    'loops the best moment until it becomes the permanent state',
    'modulates the frequency until the right thing is achieved',
    'programs the emotion into the structure of the sound itself',
    'samples the best of what existed and builds forward from there',
    'layers every texture until depth has a physical address',
    // Energy
    'surges through the circuitry of everything connected to it',
    'charges the atmosphere with a current the skin detects first',
    'powers everything in range with something that asks nothing back',
    'ignites without the friction that ordinary things require',
    'amplifies what was barely audible into the central frequency',
    'accelerates past comfortable into the excellent and terrifying',
    'drives the rhythm past the clock into something timeless',
    'fills the space between every note with something worth hearing',
    'pushes the ceiling up to where it was always supposed to be',
    'converts silence into the most specific kind of possibility',
    // Unity / collective
    'unifies every separate room into a single breathing organism',
    'makes strangers into something temporary and beautiful and real',
    'creates the collective moment that no one arrived planning for',
    'gives the crowd something larger than any individual inside it',
    'dissolves the distance between everyone present in the frequency',
    'makes the whole room move as one thing with one intention',
    'returns each person to a frequency they recognized from before',
    'turns the night into evidence that connection is still available',
    'makes everyone present feel specifically and exactly less alone',
    'builds community in the space of a single honest drop',
  ],
  images: [
    'when the bass finally drops and everything that was tense releases',
    'in the dark before the drop when the anticipation is the music',
    'through the strobe that slows the night into individual frames',
    'at the moment the crowd becomes a single organism with shared rhythm',
    'in the frequency between the notes where the real feeling lives',
    'under the lights that make every face the same beautiful blur',
    'when the build reaches the point of no return and everyone knows',
    'in the 4am hour when the city outside means absolutely nothing',
    'at the center of the dancefloor where the bass is most physical',
    'through the headphones at the volume that bypasses explanation',
    'in the space between the kick and the snare where time stretches',
    'when the whole room lifts at exactly the moment the drop arrives',
    'at the rave where everyone came looking for the same frequency',
    'in the breakdown where everything stops except what matters most',
    'when the synth opens like a door into somewhere better than here',
    'through every speaker in a line from the stage into the dark',
    'in the moment when the music and the motion become the same',
    'under the open sky at the festival before the sun rises again',
    'when the loop finally resolves after the tension it required',
    'in the collective exhale when the drop arrives and confirms it',
    'through the fog machine at the hour the inhibitions lifted',
    'at the point where the body stops deciding and starts responding',
    'in the shared silence between tracks when everyone is breathing',
    'when the DJ reads the room and plays the exact necessary thing',
    'through the circuit of energy that runs from speaker to spine',
    'at the border between the ordinary night and the extraordinary one',
    'in the frequency that only this specific crowd was tuned to receive',
    'when the music slows and the feeling does not slow with it',
    'through the architecture of the sound that the body understood first',
    'in the moment of pure release when the build finally delivers',
  ],
  modifiers: [
    'endlessly and without resolution','again and again as needed',
    'past the limits of the ordinary night','higher than before',
    'until the body and the beat are indistinguishable','purely',
    'at the correct frequency for what this actually is',
    'beyond the physical into the purely experienced',
    'in loops that feel like the natural state of things',
    'together — the only way this frequency works',
    'without end — the way good music argues for eternity',
    'dissolved completely into the moment',
    'at the volume the feeling requires not the room allows',
    'synchronized — every cell in contact with the same pulse',
    'transcendent — the body is just the delivery system',
    'infinite — the beat has no memory of a beginning',
    'electric — the way everything becomes when the drop lands',
    'released — finally and completely and without reservation',
    'unified — a single organism with a shared heartbeat tonight',
    'weightless — the way good music argues against gravity',
    'present — only this moment and this frequency and this room',
    'alive — more than before the music started this',
  ],
  hookFragments: [
    'feel this — let it take every carefully defended boundary down',
    'we are all the same frequency in this room right now',
    'the beat knows what you need before you can name the need',
    'surrender to the sound — it was built for exactly this',
    'this is what pure connection feels like in its native state',
    'the drop is the answer to the question the build was asking',
    'every body in this room is proof that the frequency works',
    'we came for the music and stayed for the thing it made us',
    'the bass lives in the chest not the ear — that is the whole point',
    'turn this up and let the room become what it was meant to be',
    'we are the circuit — the music is just the current running through',
    'this frequency existed before the song and will continue after',
    'the dancefloor is the only honest place left in the city tonight',
    'let the beat carry what the day was too heavy to hold anymore',
    'we are not separate in here — the music proved that already',
    'this is the sound that makes the ordinary night extraordinary',
    'the drop arrives like an answer everyone already knew was coming',
    'feel the bass in your bones — that is the truest communication',
    'we built something in this room that none of us could build alone',
    'the frequency is the message — everything else is just translation',
    'this is the moment the night stops being a night and becomes a memory',
    'we are all tuned to the same station right now — feel that',
    'the music does not ask for anything — it just gives and gives',
    'let go of everything the day decided you had to carry',
    'the beat is the permission slip the body has been waiting for',
  ],
  bridgeLines: [
    'In the breakdown everything non-essential falls away and what remains is real',
    'We came as strangers and the music turned us into something briefly necessary',
    'The silence between tracks is not silence — it is the crowd breathing as one',
    'At 4am the world outside is the abstract and this room is the actual',
    'The frequency does not care who you were when you arrived — only who you are now',
    'Every good night ends and every good night lives in the body longer than it ran',
    'We were all looking for the same thing and the music knew before we did',
    'The drop is not the climax — the anticipation was — the drop is the confirmation',
    'Some rooms transform everyone who enters them — this is one of those rooms',
    'The beat remembered what we forgot we were all searching for',
  ],
  outroLines: [
    'The music fades — the frequency remains in the body for days afterward',
    'This is what we came for and this is what we are carrying back out',
    'The night is over and something has permanently shifted in the frequency',
    'We leave but the beat continues somewhere else for someone else tonight',
    'The dancefloor empties — the connection it made does not empty with it',
    'Turn it up one last time and let it say the thing the day never could',
  ],
  titles: [
    'Frequency','The Drop','Pulse','Synthesis','Collective',
    'The Build','Resonance','Signal','Infinite Loop','The Release',
    'Vibration','Circuit','Transcend','The Descent','Unified',
    'The Architecture','Modulation','The Field','Oscillate','Pure Signal',
    'The Grid','Dissolve','Amplitude','The Current','Emergence',
    'Temporal','The Sequence','Elevation','Transmission','The Pattern',
    'Voltage','Phase','The Frequency','Drift','Weightless',
    'The System','Convergence','Bloom','The Moment','Ascend',
    'Harmonic','The Night','Static Free','Flow State','The Algorithm',
    'Present','Collective Memory','The Organism','First Light','Expansion',
    'The Breath','Synchronized','After Hours','The Collective','Open Circuit',
    'Deep Field','The Resonance','Zero Gravity','Continuous','Alive',
  ],
};



// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — INDIE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_INDIE = {
  keywords: ['indie','lo-fi','bedroom pop','folk pop','singer songwriter','phoebe bridgers','boygenius','the national','weyes blood','sufjan stevens','fleet foxes','mac demarco','soccer mommy','big thief','alvvays','hozier','vance joy','vampire weekend','clairo','mitski','bon iver','modest mouse','death cab for cutie','the shins','bright eyes','neutral milk hotel','of montreal','animal collective','grizzly bear','the antlers','iron and wine','gregory alan isakov','caamp','noah kahan','julien baker','lucy dacus','the war on drugs','built to spill','pavement','yo la tengo','wilco','indie rock','indie folk','dream pop','shoegaze','slowcore','art pop','baroque pop','chamber pop','freak folk'],
  cadenceTarget: [6,12],
  rhymeStyle: 'slant',
  rhymeSchemes: ['ABAB','AABB','ABCB'],
  sectionTags: ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
  structures: [
    // Indie pop radio single (The National / Vampire Weekend)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Outro]'],
    // Verse-heavy before late chorus (Bon Iver / Iron & Wine)
    ['[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // No bridge: pure indie folk simplicity (Fleet Foxes / Sufjan)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]'],
    // Double verse-chorus build (The War on Drugs / Arcade Fire)
    ['[Verse 1]','[Verse 2]','[Chorus]','[Chorus]','[Outro]'],
    // Slow opener with late payoff (Phoebe Bridgers / Julien Baker)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Instrumental intro sets mood (Radiohead / Sigur Rós adjacent)
    ['[Intro]','[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Outro]'],
    // Three verses with minimal chorus (Bob Dylan / Leonard Cohen influence)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Outro]'],
    // Art rock: no chorus, just sections (Talking Heads / LCD Soundsystem)
    ['[Intro]','[Verse 1]','[Verse 2]','[Bridge]','[Verse 3]','[Outro]'],
    // Indie rock: classic chorus-first structure
    ['[Chorus]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]'],
    // Quiet-loud-quiet (Pixies / Nirvana dynamic)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Breakdown]','[Final Chorus]'],
    // Extended outro (Mogwai / Explosions in the Sky post-rock)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Extended Outro]'],
    // Hook before verse (catchy indie pop: Tame Impala / MGMT)
    ['[Intro]','[Chorus]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]'],
    // Ambient-leaning: two verses, late chorus (Beach House / Cocteau Twins)
    ['[Intro]','[Verse 1]','[Verse 2]','[Chorus]','[Outro]'],
    // Modern indie folk-pop (Hozier / James Bay)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // No-bridge format (simple 3-chord indie)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Outro]'],
    // Concept indie: spoken / ambient interlude (Sufjan Stevens)
    ['[Intro]','[Verse 1]','[Chorus]','[Interlude]','[Verse 2]','[Chorus]','[Outro]'],
    // Guitar-pop verse-heavy (The Strokes / Arctic Monkeys)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Guitar Break]','[Chorus]'],
    // Folk indie narrative (Mountain Goats / Decemberists)
    ['[Verse 1]','[Verse 2]','[Chorus]','[Verse 3]','[Bridge]','[Chorus]','[Outro]'],
  ],
  adlibs: [],
  subjects: [
    'I','you','we','something small','the light','a Tuesday',
    'this apartment','that feeling','the photograph','an old song',
    'something quiet','the season','your voice','a specific memory',
    'the space between us','October','the ordinary','something soft',
    'the version of you','a detail','the afternoon','something honest',
    'the year','a door','the window','something I keep',
    'the version of me','a letter','the drive','something left',
    'the particular light','a Tuesday in autumn','the corner booth',
    'this specific ache','your handwriting','the way you said it',
    'a Thursday','the mixtape','something unnamed','the gap',
    'the morning','a smell','the three seconds before','the habit',
    'something I noticed','the silence between tracks','a photograph I still have',
  ],
  verbPhrases: [
    // Observation / detail
    'shows up in the details I forgot I even mentioned to you',
    'lives in the particular quality of light on that specific day',
    'exists in the gap between what happened and what I say happened',
    'arrives in the half-second before I know what the feeling is',
    'finds me in the middle of the grocery store without warning',
    'lands in the way October does — specific and unannounced',
    'settles into ordinary Tuesdays like it belongs there by right',
    'surfaces in the song I forgot was connected to anything',
    'appears in the smell that has no name beyond the memory it carries',
    'returns in the light at 4pm in November in a specific way',
    // Memory / time
    'sits somewhere between the memory and the version I prefer',
    'lives in the photograph from the year before everything shifted',
    'stays in the voicemail I know better than to listen to again',
    'waits in the old apartment that someone else is living in now',
    'exists in the gap between what we said and what we both meant',
    'returns with every song from that specific playlist from that year',
    'lives in the handwriting I would recognize anywhere even now',
    'arrives in the smell of whatever we were cooking on that evening',
    'stays in the corner booth that probably has different regulars now',
    'sits in the last message I sent and the response that never came',
    // Feeling / emotion
    'aches in the way only specific things can — quietly and precisely',
    'breaks open in the way only honest songs manage to do right',
    'makes the ordinary feel luminous without needing an occasion',
    'carries everything I could not manage to say into the verse instead',
    'knows me in the version I do not show in most conversations',
    'tells the truth sideways the way only good songs learn to do',
    'finds the unnamed feeling and gives it an address in the melody',
    'holds the bittersweet thing without trying to resolve it cleanly',
    'says what therapy has been approaching for the last six months',
    'reaches the place that direct conversation cannot always access',
    // Relationship / distance
    'loves the rough draft of me that predates every revision',
    'misses the version of this that existed before it got complicated',
    'moves through me the way a song does the first time it gets it right',
    'knows the difference between the performed version and the real one',
    'holds the space where the relationship used to take up its volume',
    'returns to the version of us that existed before the context shifted',
    'carries what was said and also everything that was carefully not said',
    'grows heavier in the silence than it ever was in the conversation',
    'stays in the last night of that apartment before I handed back the keys',
    'lives in the version of the city that belonged to that specific year',
    // Growth / honesty
    'becomes the thing I could not articulate until the song did it',
    'changes the shape of the memory slightly every time I return to it',
    'makes me softer and more honest than I was before it arrived',
    'turns the ordinary Tuesday into the moment that mattered most',
    'teaches me something I already knew but had not confirmed yet',
    'arrives quietly and permanently the way only real things do',
    'finds the frequency of the true thing beneath the performed version',
    'becomes the melody the feeling was always trying to resolve into',
    'names the unnamed thing and makes the carrying of it possible',
    'holds what was good without pretending the difficult parts were not',
  ],
  images: [
    'in the half-light of a specific Tuesday that I did not see coming',
    'through the windshield of your car in the rain on the long way home',
    'in the empty apartment before the boxes were finished being packed',
    'when the summer finally broke and the air changed completely overnight',
    'in the voicemail I kept for a year before I let it go',
    'through the gap in the curtains at the particular hour of afternoon',
    'in the middle of the grocery store in the cereal aisle of all places',
    'on the Thursday before everything was different from the Thursday after',
    'in the handwriting on the envelope I kept in the book I lent you',
    'through the album I played too many times that year to hear correctly',
    'when the light hits the wall at the angle only that apartment had',
    'in the static between radio stations on the drive that mattered',
    'in the last photograph taken before the thing that changed the series',
    'at the table where we used to sit before we both got too busy',
    'through the version of me you knew that I am still on friendly terms with',
    'in the ordinary made luminous by nothing more than being over',
    'when the song comes on randomly in a public place and lands wrong',
    'through the trees at the angle only that specific October had',
    'in the coffee cup left on the windowsill from the morning of something',
    'at the end of the longest ordinary week that still somehow meant something',
    'in the particular quality of autumn light through those specific windows',
    'through the crack in the ceiling I knew better than anyone else in the building',
    'when I find it mentioned somewhere I had forgotten it had touched',
    'in the year we lived near the tracks and could set the clock by the sound',
    'on the drive home that took the long way because neither of us was ready',
    'in the box of things I never unpacked from the move that happened anyway',
    'when October arrives earlier than usual and the whole city shifts at once',
    'through the passenger window at the specific quality of dusk in September',
    'in the playlist named after a year and played only in the appropriate weather',
    'when I find your handwriting somewhere I forgot you had ever written',
    'in the last apartment before everything changed its entire shape and direction',
    'through the window I no longer own looking onto the street I still recognize',
    'when the city gets quiet in the specific way it does before the first snow',
    'in the silence between the notes in the song that we made ours by playing it',
    'in the margin of the book I lent you that you never brought back to me',
    'at the cafe we went to exactly once but that I think about specifically',
    'through the phone call I almost did not make but ultimately made correctly',
    'in the particular smell of that October that I cannot reproduce or explain',
    'when the familiar song sounds like a completely different song years later',
    'in the gap between what happened and the version I tell when it comes up',
    'during the years I was in the middle of learning to be honest with myself',
    'in the version of myself I left behind with the apartment and the routine',
    'when the song I associated with you plays in a context you are not part of',
    'in the ordinary Tuesday that revealed itself as the one that actually mattered',
  ],
  modifiers: [
    'quietly and completely without any announcement',
    'in the specific way that only certain things manage to do',
    'like breathing — which is to say necessary and unnoticed',
    'in a way I could have predicted but did not',
    'softly and with a precision I cannot account for',
    'the way only honest things persist across the seasons',
    'specific and unshakeable in the way of real things',
    'without asking whether the timing was right for it',
    'in the half-light version of the feeling rather than the whole',
    'the way a song does when it gets the specific thing exactly right',
    'quietly — the word I keep returning to — quietly',
    'in a way that required no audience and offered no explanation',
    'still — after everything — still in the same configuration',
    'gently and without resolution because some things resist that',
    'in the bittersweet register where the best songs live',
    'with the weight of everything that went unsaid in that room',
    'the way important things arrive — without announcement or ceremony',
    'completely — which surprised me given how small the moment was',
    'in the version that admits the difficult parts were also beautiful',
    'persistently — which is the most honest compliment I can pay it',
  ],
  hookFragments: [
    'I keep finding you in places you were not actually present in',
    'some things only make sense when they are already over and gone',
    'I did not know what I had until the version of it that ended',
    'the song knows what I mean even when I do not have the word for it',
    'ordinary things have a way of becoming the important ones later',
    'I wrote this down so the feeling would have somewhere to live',
    'you were the Tuesday that turned into the month that turned into the year',
    'I am still learning the full vocabulary of what this meant',
    'the light in that apartment had a quality I have not found since',
    'I keep the photograph because I am still working out what it is of',
    'some feelings resist the name and I have stopped trying to force one',
    'this is the song for the thing that does not have a category yet',
    'I am more honest in a verse than I ever managed in a conversation',
    'the ending was sad in the specific way that good things ending are',
    'I learned more from the leaving than from the arriving — that tracks',
    'something about that year keeps returning at the right kind of wrong moment',
    'the details I remember are not the ones I would have predicted keeping',
    'I made a home out of a feeling that was never meant to be permanent',
    'you were the song I played until I could no longer hear it correctly',
    'what I carry from that time is lighter and more specific than I expected',
    'the version of me that existed then knew something I keep relearning',
    'I gave you the version I reserve for people I trust completely — you know',
    'some songs become the feeling rather than describing it — this was one',
    'I was learning to be honest and you were patient about the delay',
    'the city looks different from the life I have now than it did from inside that one',
  ],
  bridgeLines: [
    'I do not know what to call what I am still carrying from that time',
    'The specific detail I cannot let go of is not the one I expected to keep',
    'I wrote the song because the feeling needed somewhere honest to live',
    'It ended quietly and completely in the way that only true things do',
    'I still find you in songs I was listening to before you were a reference',
    'The version of me you knew was real — I want you to know that',
    'Some things you carry without knowing they have a weight until you set them down',
    'I was not ready for any of it and then I was and then it was different',
    'The honest version of this is harder to say than the song makes it look',
    'I am grateful for what it was even for the parts I could not hold onto',
  ],
  outroLines: [
    'I still have the photograph and I still do not know what to do with it',
    'This is the version I keep coming back to because it is the honest one',
    'I hope you are somewhere that has better light than we had then',
    'Whatever it was it was real and the real things last differently than the rest',
    'I kept what mattered and let the rest go the way rivers let things go',
    'This is what I have from that time — a song and a specific quality of light',
  ],
  titles: [
    'Half-Light','October','The Apartment','Something Quiet',
    'Before You Left','A Tuesday','Specific','The Light That Year',
    'What I Keep','The Version','Still','Ordinary',
    'The Photograph','Already Gone','Quietly','The Long Way',
    'In the Gap','Something Real','The Year','Almost',
    'What Remains','The Handwriting','Tender','Found',
    'The Song I Played','Soft Landing','What I Learned','The Carrying',
    'Present Tense','The Detail','Before Winter','Enough',
    'The Feeling','November','What Holds','The Ending',
    'Close','The Walk Home','Simple Things','Known',
    'Without Words','The Afternoon','What Was Good','The Return',
    'Small Hours','The Season','What We Said','The Gap Year',
    'Before','Undone','The Slow Kind','Something Like This',
    'Good Bones','The Corner Booth','Honest','The Last Night',
    'Carrying','The Version of You','What Comes After','Together Apart',
    'The Small Things','Return','What I Meant','Specific and Unshakeable',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — LATIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_LATIN = {
  keywords: ['latin','reggaeton','salsa','cumbia','bachata','merengue','bad bunny','j balvin','maluma','ozuna','daddy yankee','karol g','rosalia','sech','rauw alejandro','shakira','marc anthony','spanish','latino','dembow','perreo','urbano'],
  cadenceTarget: [7,13],
  rhymeStyle: 'end',
  rhymeSchemes: ['AABB','ABAB'],
  sectionTags: ['[Intro]','[Verso 1]','[Coro]','[Verso 2]','[Coro]','[Puente]','[Coro]','[Outro]'],
  structures: [
    // Classic reggaeton: verso-coro (Daddy Yankee / Don Omar)
    ['[Verso 1]','[Coro]','[Verso 2]','[Coro]','[Puente]','[Coro]'],
    // Intro cumbia/salsa feel then verse
    ['[Intro]','[Verso 1]','[Coro]','[Verso 2]','[Coro]','[Outro]'],
    // Double verse before coro revelation
    ['[Verso 1]','[Verso 2]','[Coro]','[Puente]','[Coro]','[Outro]'],
    // Short single streaming format (Bad Bunny / J Balvin era)
    ['[Intro]','[Verso 1]','[Coro]','[Puente]','[Coro]','[Outro]'],
    // Trap latino hybrid (Anuel AA / Myke Towers)
    ['[Intro]','[Hook]','[Verso 1]','[Hook]','[Verso 2]','[Bridge]','[Hook]'],
    // Salsa structure: coro-first (Marc Anthony / La India)
    ['[Coro]','[Verso 1]','[Coro]','[Verso 2]','[Montuno]','[Coro]'],
    // Bachata: slow build (Romeo Santos / Prince Royce)
    ['[Intro]','[Verso 1]','[Coro]','[Verso 2]','[Coro]','[Bridge]','[Final Coro]'],
    // Pop urbano: Max Martin meets reggaeton (Shakira / Maluma)
    ['[Verso 1]','[Pre-Coro]','[Coro]','[Verso 2]','[Pre-Coro]','[Coro]','[Puente]','[Coro]'],
    // Three verse Latin ballad (Alejandro Fernandez / Luis Miguel)
    ['[Verso 1]','[Coro]','[Verso 2]','[Coro]','[Verso 3]','[Coro]'],
    // Cumbia: verse-heavy with instrumental break
    ['[Intro]','[Verso 1]','[Coro]','[Verse 2]','[Coro]','[Instrumental Break]','[Outro]'],
    // Dembow party: hook first, verses wrap it
    ['[Hook]','[Verso 1]','[Hook]','[Verso 2]','[Puente]','[Hook]'],
    // Latin pop radio: full structure (Ricky Martin / Enrique Iglesias)
    ['[Intro]','[Verso 1]','[Pre-Coro]','[Coro]','[Verso 2]','[Coro]','[Puente]','[Final Coro]','[Outro]'],
    // Merengue: fast, short sections, circular
    ['[Intro]','[Verso 1]','[Coro]','[Coro]','[Verso 2]','[Outro]'],
    // Balada ranchera (Vicente Fernandez / Juan Gabriel)
    ['[Intro]','[Verso 1]','[Coro]','[Verso 2]','[Coro]','[Puente]','[Coro]','[Outro]'],
    // Afrobeats-Latin crossover (Karol G / Rauw Alejandro)
    ['[Intro]','[Verso 1]','[Coro]','[Verso 2]','[Bridge]','[Coro]','[Outro]'],
    // Heartbreak ballad: late coro reveal
    ['[Verso 1]','[Verso 2]','[Coro]','[Puente]','[Final Coro]'],
    // Urban Latin minimal (Sech / Jhay Cortez)
    ['[Intro]','[Hook]','[Verso 1]','[Hook]','[Verse 2]','[Hook]','[Outro]'],
    // Full session: extended montuno ending
    ['[Intro]','[Verso 1]','[Coro]','[Verso 2]','[Coro]','[Montuno]','[Outro]'],
  ],
  adlibs: ['(dale)','(fuego)','(venga)','(pa lante)','(wepa)','(eh eh)','(si si)','(ay)','(boom)','(real talk)'],
  subjects: [
    'I','tu','nosotros','mi corazon','el ritmo','esta noche',
    'mi gente','el fuego','la musica','mi alma','este amor',
    'la calle','el barrio','mi sangre','la vida','este momento',
    'mi cultura','el beat','la pasion','mis raices','el sabor',
    'la noche','mi orgullo','el cielo','esta energia','mi destino',
    'el mundo','la libertad','mi nombre','el camino','esta cancion',
    'la belleza','mi fe','el poder','esta fuerza','mi historia',
    'el corazon','la verdad','mi familia','el fuego dentro','esta tierra',
    'la esperanza','mi voz','el sueño','esta conexion','mi pueblo',
  ],
  verbPhrases: [
    // Love / passion
    'te busca en cada cancion que suena en la noche',
    'arde como el sol cuando finalmente te encuentro',
    'late mas fuerte cuando escucho tu nombre en el viento',
    'vive en el calor de tus manos en la oscuridad',
    'baila sin parar hasta que el amanecer nos encuentra',
    'siente el fuego que ninguna distancia puede apagar',
    'lleva tu recuerdo a cada lugar donde voy',
    'te ama con la intensidad de todo lo que soy',
    'finds you in the music that plays when I need it most',
    'burns with a fire that no distance has been able to cool',
    'beats louder in my chest when your name comes into it',
    'dances without stopping until the morning finds us here',
    'carries the memory of you into every room I enter',
    'loves with the full intensity of everything I am made of',
    // Pride / identity
    'lleva mi cultura como una corona que nadie puede quitar',
    'viene de una tierra que forjo todo lo que soy hoy',
    'honra a los que vinieron antes con cada paso que doy',
    'canta la historia de mi gente en cada nota que sale',
    'carries the culture like a crown that was earned not given',
    'comes from a place that shaped everything I am today',
    'honors those who came before with every step I take forward',
    'sings the story of my people in every note I release',
    'wears the roots like the truest ornament available to me',
    'represents the neighborhood in every room the music reaches',
    // Celebration / energy
    'goza la vida sin pedir permiso a nadie en esta tierra',
    'celebra cada momento como si fuera el ultimo que tenemos',
    'vive con la intensidad que la musica siempre nos enseño',
    'mueve el cuerpo al ritmo que el corazon siempre supo',
    'celebrates without asking permission from anyone anywhere',
    'lives with the full intensity the music always modeled',
    'moves to the rhythm the body knew before being taught',
    'finds joy in every moment that could hold the weight of it',
    'dances because the feet understood before the mind agreed',
    'fills every room with the energy that will not be quieted',
    // Street / barrio
    'viene del barrio pero el barrio nunca se va de mi',
    'conoce las calles que me hicieron quien soy hoy',
    'vive con el orgullo de todo lo que vencimos juntos',
    'lleva la historia del bloque en cada letra que escribo',
    'comes from the street but the street never leaves the person',
    'knows every corner that shaped the character completely',
    'lives with the pride of everything that was overcome together',
    'carries the history of the block in every lyric written',
    'built something here that the neighborhood can point to proudly',
    'never forgot where the path started regardless of where it went',
    // Freedom / movement
    'vuela mas alto que los limites que pusieron para mi',
    'rompe cada cadena que intentaron ponerle al destino',
    'sigue adelante sin mirar atras lo que quedo antes',
    'alcanza los sueños que nadie creia que eran posibles',
    'flies higher than every limit they designed for this path',
    'breaks every chain they tried to attach to the destiny',
    'keeps moving forward without looking back at what was left',
    'reaches the dreams that nobody believed were achievable',
    'crosses every border they drew around the possible future',
    'builds the dream that was called impossible and makes it daily',
  ],
  images: [
    'en la noche que nunca termina cuando el ritmo nos lleva',
    'con el sabor de la musica que heredamos de antes',
    'bajo las estrellas del barrio que nos vio crecer juntos',
    'en el calor del verano cuando la vida sabe mejor',
    'cuando la calle se convierte en la pista de baile perfecta',
    'con el fuego de mi tierra corriendo por las venas',
    'en la fiesta donde todos somos uno solo bailando',
    'bajo la luna que ilumina el camino de regreso a casa',
    'when the night stretches out and the rhythm takes over everything',
    'with the flavor of the music that was inherited from before',
    'under the stars of the neighborhood that watched us grow',
    'in the heat of the summer when life tastes its absolute best',
    'when the street becomes the perfect dancefloor for one night',
    'with the fire of my homeland running through every vein',
    'at the party where everyone becomes one thing together',
    'under the moon that lights the road back to where we belong',
    'when the bass drops and the whole block moves at once',
    'in the song that the grandparents danced to before we existed',
    'at the corner where the music always came from the window',
    'when the language of the body says what words cannot carry',
    'in the heat of every summer that belonged to this neighborhood',
    'at the quinceañera where every generation danced together',
    'when the trumpets start and the feet know what to do first',
    'in the calle where the rhythm was always the native language',
    'at the family gathering where everyone knows every word',
    'when the old song comes on and everyone who knows it stands up',
    'in the market on Saturday morning before the city fully wakes',
    'at the border between here and there that lives in the chest',
    'when the music connects everyone present across every difference',
    'in the specific heat that only this summer in this place produces',
  ],
  modifiers: [
    'con todo el fuego que llevo dentro siempre',
    'sin parar — eso es lo que prometimos desde el principio',
    'dale — as hard and as honest as everything that came before',
    'con la fuerza de todo lo que soy y de donde vengo',
    'para siempre — the way real things decide to last',
    'sin filtro — without anything between the truth and the saying',
    'wepa — louder than the doubt and cleaner than the fear',
    'with everything — con todo lo que soy y lo que seré',
    'completely and without apology for the size of the feeling',
    'en el alma — in the deepest and most honest available place',
    'pa lante — forward — always and only forward from here',
    'with the full force of everything this culture gave to me',
    'naturally — the way music and movement were always one thing',
    'sin miedo — without the fear that the smaller version requires',
    'real — not performed — real in the way that blood is real',
    'forever — which in music means as long as someone plays it',
    'loud and proud and impossible to mistake for anything quieter',
    'with the rhythm that was in the bones before it was in the song',
    'entirely — holding back is not available in this language',
    'deep — where the culture lives and the music was always born',
  ],
  hookFragments: [
    'el ritmo no miente cuando el corazon ya sabe la verdad',
    'vengo de lejos pero nunca olvido de donde soy yo',
    'esta musica lleva el alma de todo lo que somos',
    'bailamos juntos porque el ritmo es el idioma que compartimos',
    'the rhythm does not lie when the heart already knows the answer',
    'I come from far but never forget exactly where I am from',
    'this music carries the soul of everything we are together',
    'we dance together because the rhythm is the shared language',
    'dale — the music is the culture and the culture never stops',
    'mi gente — everywhere the music reaches is home to me now',
    'the beat connects what the distance tried to separate',
    'I carry the barrio into every room the music reaches',
    'the feeling is the same in every language the song touches',
    'fuego — the kind that warms without burning anything down',
    'we are all one thing when the rhythm decides for us',
    'the music remembers what the years tried to make us forget',
    'every song is a letter home to the place that made this possible',
    'the dance is the prayer and the floor is the cathedral',
    'louder — until the music reaches everyone it was built for',
    'this is the sound of where I come from arriving where I am',
    'we goza because life is too short for any other available option',
    'the culture lives in the beat — listen and you will find it',
    'mi corazon speaks Latin even when the words come out in English',
    'the rhythm was there before the language and will outlast it',
    'this song is for everyone who knows what home sounds like',
  ],
  bridgeLines: [
    'Vengo de una tierra que me dio todo lo que soy hoy en dia',
    'La musica es el puente entre quien fui y quien soy ahora',
    'I carry the culture in every city the music takes me to',
    'The rhythm is the inheritance that no distance can reduce',
    'No matter where the road goes the barrio travels in the chest',
    'The language changes but the feeling underneath never does',
    'This is the sound of every person who came before and made this possible',
    'We celebrate because they survived so that we could arrive here',
    'The music is the memory of a place alive in the present moment',
    'Every beat is a conversation between where I come from and where I am going',
  ],
  outroLines: [
    'La musica nunca muere — vive en todo lo que somos siempre',
    'This is where I come from and where I am always going back to',
    'The rhythm carries forward everything the years tried to leave behind',
    'Wherever the music plays a piece of home is already present there',
    'Dale — the song ends but the culture never stops singing itself',
    'We danced together and that is the whole truth of everything tonight',
  ],
  titles: [
    'Fuego','La Noche','Ritmo','Mi Gente','Calor',
    'Sin Parar','El Sabor','Dale','La Cultura','Orgullo',
    'Corazon','La Calle','Todo','El Ritmo','Libre',
    'La Fiesta','Siempre','El Barrio','Pasion','Verano',
    'La Verdad','Sin Miedo','El Alma','Baila','La Fuerza',
    'Destino','La Musica','Todo Lo Que Soy','El Camino','Vivir',
    'La Noche Larga','Sin Fronteras','El Fuego Dentro','Para Siempre','Raices',
    'La Historia','Con Todo','El Sueño','Adelante','La Tierra',
    'Mi Nombre','El Amor','Juntos','La Esperanza','Poder',
    'Identidad','El Comienzo','La Promesa','Ahora','El Todo',
    'Conectados','La Voz','Mi Mundo','El Legado','Celebrar',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — K-POP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — K-POP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_KPOP = {
  keywords: ['k-pop','kpop','k pop','idol','idol group','korean pop','bts','blackpink','twice','aespa','stray kids','newjeans','nct','exo','seventeen','txt','enhypen','monsta x','idol','hallyu','korean pop','oppa','unnie','fighting','hwaiting','daebak','saranghae','noona','sunbae','jungkook','jennie','lisa','rose','jisoo','suga','rm','j-hope','jimin','v','jin','bang chan','hyunjin','felix','yeji','itzy'],
  cadenceTarget: [5, 12],
  rhymeStyle: 'end',
  rhymeSchemes: ['AABB','ABAB'],
  sectionTags: ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
  structures: [
    // Classic K-pop: verse-pre-chorus-chorus machine (SM / YG format)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Concept intro then stadium chorus (BTS / TWICE structure)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Bridge-to-outro breakdown (aespa / NewJeans minimalist)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Outro]'],
    // Pre-chorus builds (BLACKPINK / ITZY energetic pop)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Rap verse into melodic chorus hybrid (K-pop rap line showcase)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Dance break section (iconic K-pop element)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Dance Break]','[Bridge]','[Final Chorus]'],
    // Trap-influenced: hook-first (Stray Kids / ATEEZ dark concept)
    ['[Hook]','[Verse 1]','[Pre-Chorus]','[Hook]','[Verse 2]','[Bridge]','[Final Hook]'],
    // Full concept: intro monologue into performance
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Dance Break]','[Chorus]','[Outro]'],
    // Short single format (streaming era K-pop)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Outro]'],
    // Ballad K-pop: slow build (EXO / Super Junior ballad tradition)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // Hip-hop K-pop fusion (G-Dragon / Jay Park style)
    ['[Intro]','[Hook]','[Verse 1]','[Hook]','[Verse 2]','[Bridge]','[Hook]','[Outro]'],
    // Cheerful: immediate chorus then verse (Red Velvet / SNSD bubblegum)
    ['[Chorus]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Bridge]','[Final Chorus]'],
    // Late bridge revelation (EXO / SHINee emotional concept)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Final Chorus]','[Outro]'],
    // Chant hook breakdown (NCT / MONSTA X performance-focused)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Breakdown]','[Chorus]'],
    // Unit focus: split verse sections (full-group formats)
    ['[Intro]','[Verse 1]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Summer hit: no bridge, pure catchy energy
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Post-Chorus]','[Outro]'],
    // EDM-K-pop hybrid: build into drop (K-pop x EDM collab style)
    ['[Intro]','[Verse 1]','[Build]','[Drop]','[Verse 2]','[Bridge]','[Drop]','[Outro]'],
    // Solo spotlight structure (soloist or debut single format)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Bridge]','[Final Chorus]'],
  ],
  adlibs: ['(yeah)','(hey)','(let\'s go)','(uh)','(come on)','(oh yeah)'],
  subjects: [
    'we','you','I','this feeling','the night','my heart','this moment','us',
    'the stars','your smile','this beat','the light','our dream','the stage',
    'this fire','you and I','the music','this love','our time','the world',
    'every heartbeat','the glow','this spark','your eyes','the rhythm',
    'every step','this path','the way you shine','the crowd','our story',
    'this energy','the feeling','my soul','the promise','this journey',
    'every note','the harmony','this dream','your voice','the stage lights',
    'this power','we together','the moment','your name','everything',
    'I and you','the dance','this night sky','the melody','forever',
  ],
  verbPhrases: [
    // Connection / together
    'shine together under the same night sky',
    'rise above everything holding you back',
    'run toward the light and never stop',
    'stand together stronger than before',
    'burn like stars across the universe',
    'fall for you every single time',
    'reach the top and never look down',
    'light up the whole world tonight',
    'fly higher than I ever thought possible',
    'glow in the dark when everything fades',
    // Longing / love
    'can\'t stop thinking about you now',
    'want to hold you close forever',
    'keep your name in every song I write',
    'miss you in every quiet moment',
    'find you in every crowd I\'m in',
    'chase this dream until I reach you',
    'never let you go after tonight',
    'call your name when nobody answers',
    'search for you in every city',
    'dream of you every night without fail',
    // Empowerment / performance
    'own the stage like I was born for it',
    'break every record set before today',
    'take the world and hold it in my hands',
    'move like the music lives inside me',
    'push through the dark to find the dawn',
    'prove them wrong with every single move',
    'rise up louder when they try to stop me',
    'fight for everything that matters most',
    'come alive when the spotlight hits',
    'show them everything I have inside',
    // Dreams / destiny
    'believe this path will lead me there',
    'see the future written in your eyes',
    'follow the stars wherever they lead',
    'trust the feeling pulling me forward',
    'never give up on what I know is real',
    'keep the faith when nothing makes sense',
    'hold the dream even when it feels far',
    'find my purpose in every beat',
    'write my name across the sky tonight',
    'make history with everyone I love',
    // Performance energy
    'turn it up until they feel alive',
    'give everything I have to every show',
    'leave it all out on the stage tonight',
    'make them feel what I can\'t explain',
    'take it further than they thought we could',
    'bring the energy that changes everything',
    'fill the room with something they can\'t name',
    'make them remember this night forever',
    'create a moment nobody can forget',
    'deliver everything we promised them',
  ],
  images: [
    'when the drop hits and the crowd erupts',
    'under the stage lights burning bright',
    'in the moment before the chorus lands',
    'when our voices rise together into one',
    'at the concert where everything felt real',
    'when the world goes quiet and the music starts',
    'in the silence between the last note and the roar',
    'when the dance break breaks every expectation',
    'at the comeback that nobody was ready for',
    'when the harmony hits and everything aligns',
    'in the practice room at 3am grinding',
    'when the fans sing every word back to us',
    'at the award show holding what we earned',
    'when the lights go down and we walk out',
    'in the music video with every frame perfect',
    'when the pre-chorus builds to something bigger',
    'at the sold-out show in every time zone',
    'when everything we worked for finally lands',
    'in the recording booth finding the perfect take',
    'when the world stops and the song fills everything',
    'at the showcase where it all began',
    'when the bridge breaks and the chorus hits harder',
    'in the trailer revealing the comeback concept',
    'when the fandom sings along without prompting',
    'at the world tour closing night',
    'when the formation locks in and every beat falls',
    'in the moment right before we step on stage',
    'when the melody finally says what words can\'t',
    'at the fan meeting where eyes speak everything',
    'when we performed this and nothing else existed',
  ],
  modifiers: [
    'together and unstoppable',
    'for everyone who believed in us',
    'louder than anything before this',
    'all the way to the top',
    'with every beat of my heart',
    'forever and always',
    'until the whole world hears',
    'brighter than we ever imagined',
    'now and every night after',
    'without a single doubt',
    'completely and without apology',
    'for every fan who stayed',
    'all night and into tomorrow',
    'with fire in every single step',
    'never stopping never settling',
    'with everything we have inside',
    'beyond every limit they set',
    'beautifully and without holding back',
    'for the ones who see us clearly',
    'until the stars fall down',
  ],
  hookFragments: [
    'we shine we rise we never come down',
    'you and me against the whole wide world tonight',
    'I can\'t stop this feeling burning in my chest',
    'we were made to light up every single stage',
    'together we are everything they said we couldn\'t be',
    'your name is the only song I know by heart',
    'we burn we glow we\'re never letting go',
    'this moment this beat this feeling is all I need',
    'I will find you in every city every night',
    'we rise together or we don\'t rise at all',
    'no one else can make me feel like you do',
    'this love is louder than any crowd I\'ve faced',
    'we were born to break every record made',
    'I give you everything every show every night',
    'the world is watching and we shine anyway',
    'nothing can stop what we already started',
    'I fall for you in every single city on this tour',
    'together forever that\'s the only promise I know',
    'we turn the stage into the whole universe',
    'this is our time and we are ready for it',
    'you make every song I write about you real',
    'I keep your name in every hook I sing',
    'when the lights go down I still see your face',
    'we came from nothing and we built all of this',
    'louder every night until the whole world knows',
  ],
  bridgeLines: [
    'When everything was hard you stayed — that is the whole story',
    'We trained for this moment and now the moment is here',
    'The road was long but I would walk it again',
    'I never knew a feeling like this was even possible',
    'You saw something in me before I saw it myself',
    'Every stage every city every night was worth it for this',
    'We came so far and we are not done yet',
    'Through every doubt you were the only certain thing',
    'I would choose this dream again in every life',
    'The music was the map and you were home',
  ],
  outroLines: [
    'Thank you for every night every song every moment',
    'We shine because you believed before we did',
    'This is just the beginning of everything we planned',
    'The night ends but the feeling never leaves',
    'We carry every fan with us wherever we go',
    'Until next time — we love you more than music can say',
  ],
  titles: [
    'Starlight','Together Tonight','Feel It','The Promise','Dynamite',
    'Forever Us','Shine On','Dream High','Fire Within','Run With Me',
    'Golden Hour','Idol','My World','Limitless','Universe',
    'Love Maze','Answer','Magic','Electric','Butterfly',
    'Blue Hour','Crown','Shadow','Stay','Miroh',
    'God\'s Menu','Awkward Silence','Ditto','Hype','Super',
    'After School','Eleven','Love Dive','Antifragile','Kitsch',
    'Pink Venom','Shut Down','How You Like That','Kill This Love','Lovesick',
    'FANCY','What is Love','Likey','Signal','Cheer Up',
    'Black Mamba','Next Level','Savage','Girls','Spicy',
    'Growl','Power','Tempo','Ko Ko Bop','Obsession',
    'God\'s Plan for Us','Ultra','Neon','Sunrise','Encore',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — GOSPEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_GOSPEL = {
  keywords: ['gospel','worship','praise','church','spiritual','hymn','christian','faith','holy','amen','hallelujah','jesus','lord','god','choir','sanctuary','revival','anointed','blessed','grace','salvation','redemption','kirk franklin','aretha franklin','cece winans','tasha cobbs','maverick city','elevation','bethel','hillsong','contemporary gospel','traditional gospel'],
  cadenceTarget: [6, 14],
  rhymeStyle: 'end',
  rhymeSchemes: ['AABB','ABAB'],
  sectionTags: ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Tag]','[Outro]'],
  structures: [
    // Traditional gospel: verse-chorus-bridge testimony
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Tag]'],
    // Contemporary gospel single (Kirk Franklin era)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Vamp-to-praise structure (worship experience format)
    ['[Verse 1]','[Chorus]','[Bridge]','[Chorus]','[Vamp]','[Tag]','[Outro]'],
    // Pre-chorus build (Tasha Cobbs / Maverick City Music)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Altar call: extended vamp at end
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]','[Tag]'],
    // Contemporary worship: intro worship set
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // Classic black gospel: call and response 
    ['[Intro]','[Verse 1]','[Chorus]','[Bridge]','[Chorus]','[Tag]','[Outro]'],
    // Long testimony verse with late chorus (James Cleveland style)
    ['[Intro]','[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Shouting song: minimal verse, all chorus energy
    ['[Chorus]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Final Chorus]'],
    // Contemporary CCM gospel (Elevation Worship / Hillsong style)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Revival: three verse testimony structure
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Bridge]','[Chorus]'],
    // Radio gospel single (CeCe Winans / Yolanda Adams)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]','[Outro]'],
    // Choir showcase: full choir bridge (mass choir tradition)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Vamp]','[Bridge]','[Final Chorus]'],
    // Slow worship: long verses, intimate chorus
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Prophetic proclamation: spoken bridge
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Spoken Bridge]','[Final Chorus]','[Tag]'],
    // Urban gospel: trap-influenced modern worship
    ['[Intro]','[Hook]','[Verse 1]','[Hook]','[Verse 2]','[Bridge]','[Hook]','[Outro]'],
    // Medley format: three sections, extended praise
    ['[Verse 1]','[Chorus]','[Bridge]','[Chorus]','[Tag]','[Outro]'],
    // Traditional spiritual: verse-chorus circular form
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Chorus]','[Tag]'],
  ],
  adlibs: ['(yes Lord)','(glory)','(hallelujah)','(amen)','(come on)','(sing it)','(praise Him)'],
  subjects: [
    'His grace','the Lord','I','my soul','this praise','His love',
    'the Spirit','your mercy','this joy','His name','the blood',
    'my faith','His presence','this worship','the cross','His light',
    'every chain','this blessing','His power','the choir','my voice',
    'His promise','this moment','the glory','my testimony','His hand',
    'every prayer','this healing','the fire','His word','my life',
    'His faithfulness','this freedom','the anointing','my heart',
    'every trial','His grace alone','the congregation','my praise',
    'His goodness','this surrender','the altar','my trust',
    'every burden','His peace','the sanctuary','we together',
  ],
  verbPhrases: [
    // Praise and worship
    'fills every room with overwhelming praise',
    'lifts every voice in holy adoration',
    'breaks every chain in the mighty name',
    'covers every wound with healing grace',
    'rains down on every searching soul',
    'moves through the congregation like fire',
    'lifts me higher than I\'ve ever been',
    'fills the temple with unending song',
    'calls us all by name and by grace',
    'pours out over everything we brought',
    // Faith and trust
    'never fails though everything else does',
    'holds me when I cannot hold myself',
    'carries me through every valley floor',
    'sustains me when my strength gives out',
    'remains the same through every season',
    'meets me every morning without fail',
    'makes a way where there was no way',
    'turns every trial into testimony',
    'brings me through what tried to break me',
    'never leaves me never forsakes me',
    // Victory and breakthrough
    'breaks every yoke that held me bound',
    'sets the captive free and calls them out',
    'opens doors that should have stayed closed',
    'lifts the burden no man could remove',
    'gives the victory over every fear',
    'restores what years of loss had taken',
    'transforms the mourning into dancing now',
    'exchanges ashes for the crown of grace',
    'redeems the time that seemed so wasted',
    'turns the test into the testimony',
    // Surrender and devotion
    'surrenders everything at the altar',
    'lays it all down at the feet of grace',
    'worships in the middle of the trial',
    'trusts the plan beyond my understanding',
    'praises through the pain until it lifts',
    'finds the peace that passes comprehension',
    'rests in arms that hold without condition',
    'returns to where the healing always starts',
    'releases every worry at the cross',
    'chooses faith when every feeling fails',
    // Community and testimony
    'testifies to what the Lord has done',
    'gathers every heart in one accord',
    'builds an altar in the broken place',
    'sings the goodness from the highest hill',
    'calls on every voice to join the praise',
    'declares the victory before it comes',
    'stands on every promise ever made',
    'carries hope for every hopeless one',
    'shouts the name that changed everything',
    'holds the line until the morning breaks',
  ],
  images: [
    'when the choir lifts and the whole room shakes',
    'at the altar where the healing started',
    'in the moment His presence filled the room',
    'when the praise broke every chain that bound',
    'at the revival where the fire fell',
    'when tears became the language of thanksgiving',
    'in the valley He met me at the lowest point',
    'when the congregation rose as one voice',
    'at the place where surrender became freedom',
    'when the song said everything the heart could not',
    'in the trial that became the turning point',
    'when the midnight prayer brought morning light',
    'at the moment faith replaced every fear',
    'when the testimony came through another Sunday',
    'in the place where broken things get made whole',
    'when the spirit moved and nobody could stay still',
    'at the crossing point where grace met need',
    'when the heaviness lifted in the middle of the song',
    'in the room where praise became the weapon',
    'when the breakthrough came after years of prayer',
    'at the altar where I left what I had carried',
    'when every voice found the same note at once',
    'in the darkness just before the dawn arrived',
    'when His love made sense of everything confusing',
    'at the place where His glory filled the gap',
    'when the church became the safest place on earth',
    'in the moment that no sermon could have reached',
    'when the song became a prayer and prayer became real',
    'at the end of the road where grace was waiting',
    'when the ordinary Sunday changed everything after',
  ],
  modifiers: [
    'by grace alone and nothing else',
    'through every storm and every season',
    'with a thankful heart that overflows',
    'in the presence of the Most High',
    'forever and for every generation',
    'with every breath and every beat',
    'beyond what I deserve or understand',
    'louder than the doubt that tried to stay',
    'completely surrendered and completely free',
    'for every soul that needs to hear this',
    'until the whole earth knows His name',
    'with hands raised and eyes wide open',
    'through the fire and out the other side',
    'in faith not by what I can see',
    'to the glory of the one who saves',
    'with joy that is not tied to circumstance',
    'deeper than the deepest pit could reach',
    'faithful to the end and then beyond',
    'trusting what I cannot hold or prove',
    'for every broken thing He makes complete',
  ],
  hookFragments: [
    'He is faithful faithful faithful to the end',
    'my chains are gone I\'ve been set free',
    'through every valley His hand never left me',
    'I will praise Him in the middle of the storm',
    'His grace is more than I could ever repay',
    'the same God who brought me here will carry me through',
    'every breakthrough begins where the praise begins',
    'I surrender all and I find everything',
    'you are the reason every morning I rise',
    'no weapon formed against me ever prospers here',
    'His love is strong enough to reach this far',
    'I will not be moved by what I see today',
    'He turned my mourning into dancing overnight',
    'worthy is the name above every other name',
    'the victory was won before the battle started',
    'I have seen the hand of God in every hard thing',
    'He makes a way when there is nothing left to say',
    'my testimony is the goodness of His grace',
    'every prayer reaches the throne and does not return empty',
    'I will sing His praise until my final day',
    'the joy of the Lord is every strength I have',
    'greater is He who lives in me than anything outside',
    'He was there in every room I thought was empty',
    'the peace He gives surpasses everything I understand',
    'I am covered by a grace I did not earn',
  ],
  bridgeLines: [
    'In my weakness He is the only strength that holds',
    'What He started in me He will finish in His time',
    'The evidence of His goodness is the life I\'m living',
    'Every scar became a story of what grace can do',
    'He saw worth in me before I saw it in myself',
    'The darkest night I faced He was already in',
    'I am not who I was — the change is undeniable',
    'He does not need my perfection — only my surrender',
    'The praise goes up before the answer comes — that is faith',
    'I found my freedom kneeling at the altar',
  ],
  outroLines: [
    'He is faithful and that is the whole testimony',
    'The praise does not stop when the service ends',
    'Take this joy into every room you enter next',
    'His goodness follows us out every door we leave through',
    'The song ends but His grace never does',
    'We go out different from how we came in',
  ],
  titles: [
    'Faithful','Break Every Chain','Amazing Grace','Way Maker','Glory',
    'Overflow','Testimony','Alabaster Box','For Your Glory','Jireh',
    'Promises','This Is a Move','Man of Your Word','Build My Life','Holy',
    'Goodness of God','Battle Belongs','Graves Into Gardens','Raise a Hallelujah','Worthy',
    'What a Beautiful Name','King of Kings','Who You Say I Am','Cornerstone','Oceans',
    'Great Are You Lord','How Great Is Our God','Here I Am to Worship','Glorious','Throne Room',
    'You Know My Name','I Smile','Smile','Never Lost','Winning',
    'Brighter Day','I Need You Now','He\'s Concerned','Still','Grateful',
    'Total Praise','His Eye Is on the Sparrow','Blessed Assurance','Great Is Thy Faithfulness','How He Loves',
    'It Is Well','Come Thou Fount','Be Thou My Vision','This Is Amazing Grace','Nothing But the Blood',
    'Deliverer','In the Room','Set Apart','Covered','Overcoming',
    'Fire Fall Down','Let It Rain','Open the Eyes of My Heart','Breathe','Draw Me Close',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — JAZZ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_JAZZ = {
  keywords: ['jazz','bebop','swing','blues jazz','improvisation','saxophone','trumpet','piano trio','upright bass','brushed snare','late night jazz','jazz club','smoky','cool jazz','modal jazz','hard bop','jazz ballad','coltrane','miles davis','bill evans','herbie hancock','thelonious monk','ella fitzgerald','nina simone','stan getz','duke ellington','billie holiday','jazz standard','chord changes','ii-v-i','blue note','blues','late night','jazz fusion','smooth jazz','trumpet jazz'],
  cadenceTarget: [5, 12],
  rhymeStyle: 'end',
  rhymeSchemes: ['ABAB','AABB','ABCB'],
  sectionTags: ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Instrumental]','[Chorus]','[Outro]'],
  structures: [
    // AABA 32-bar standard form (Great American Songbook tradition)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Instrumental]','[Chorus]'],
    // Through-composed with solo (John Coltrane / Miles Davis approach)
    ['[Verse 1]','[Verse 2]','[Chorus]','[Instrumental]','[Bridge]','[Chorus]','[Outro]'],
    // Intro vamp into head (jazz standard performance format)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Instrumental]','[Outro]'],
    // Extended improvisation section (modal jazz: Kind of Blue approach)
    ['[Intro]','[Verse 1]','[Verse 2]','[Chorus]','[Instrumental Solo]','[Bridge]','[Chorus]','[Outro]'],
    // Tag ending with vamp (classic jazz club performance)
    ['[Intro]','[Verse 1]','[Chorus]','[Bridge]','[Instrumental Solo]','[Chorus]','[Tag]'],
    // Ballad: slow intro, late solo (Chet Baker / Bill Evans)
    ['[Intro]','[Verse 1]','[Chorus]','[Bridge]','[Instrumental]','[Verse 2]','[Chorus]','[Outro]'],
    // Head-solo-head (classic jazz performance structure)
    ['[Verse 1]','[Chorus]','[Instrumental Solo]','[Bridge]','[Chorus]','[Outro]'],
    // Contemporary jazz-pop (Norah Jones / Diana Krall)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Instrumental]','[Outro]'],
    // Neo-soul jazz fusion (Robert Glasper / Esperanza Spalding)
    ['[Verse 1]','[Chorus]','[Bridge]','[Chorus]','[Instrumental]','[Outro]'],
    // No solo: pure vocal jazz (early Ella Fitzgerald / Sarah Vaughan)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Latin jazz: montuno break section
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Montuno]','[Outro]'],
    // Bebop: fast head then long solos (Charlie Parker / Dizzy Gillespie)
    ['[Head]','[Instrumental Solo]','[Instrumental Solo 2]','[Head]','[Outro]'],
    // Slow ballad: two verses wrap solo
    ['[Intro]','[Verse 1]','[Verse 2]','[Instrumental Solo]','[Chorus]','[Outro]'],
    // Cool jazz: minimal, atmospheric (Miles Ahead / Kind of Blue)
    ['[Intro]','[Verse 1]','[Bridge]','[Instrumental]','[Outro]'],
    // Vocal showcase: no extended solos (Frank Sinatra / Tony Bennett)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Tag]'],
    // Fusion: rock-jazz hybrid structure (Weather Report / Pat Metheny)
    ['[Intro]','[Groove]','[Verse 1]','[Chorus]','[Instrumental]','[Chorus]','[Outro]'],
    // Swing era: short verses, repeating chorus (Count Basie / Duke Ellington)
    ['[Intro]','[Verse 1]','[Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Outro]'],
    // Gospel-jazz: testimony with instrumental (Kirk Whalum / Wynton style)
    ['[Intro]','[Verse 1]','[Chorus]','[Bridge]','[Instrumental Solo]','[Chorus]','[Tag]'],
  ],
  adlibs: [],
  subjects: [
    'I','the night','this melody','your smile','the moon','this feeling',
    'the rain','my heart','the piano','this love','the street lamp',
    'your voice','the silence','this tune','the smoke','my soul',
    'the last note','this bar stool','the city','your eyes','the dark',
    'this longing','the morning','my memories','the old songs','this hour',
    'the bridge','your absence','the standard','this winter','the horn',
    'the changes','this room','the after-hours','your laughter','the verse',
    'this late night','the groove','my blues','the trio','this tempo',
    'the distance','your name','the melody','this city at 2am','the session',
  ],
  verbPhrases: [
    // Longing and atmosphere
    'lingers like smoke in a room nobody left',
    'finds the note that holds the whole night',
    'waits at the bar until the last song ends',
    'knows this tune but plays it like it\'s new',
    'bends the note until it says the unsaid thing',
    'stays a little longer than was planned',
    'hears the melody in every passing cab',
    'walks through the city with the chorus in mind',
    'returns to this corner at the end of every night',
    'keeps the blue note low and lets it breathe',
    // Romance and loss
    'misses you in every minor key tonight',
    'finds your face in every song I love',
    'remembers the last dance before the lights came up',
    'carries the ballad home in a quiet pocket',
    'loves you best in this key at this hour',
    'calls your name in the spaces between notes',
    'plays the whole arrangement just to reach the bridge',
    'hears your voice when the trumpet holds the phrase',
    'keeps the memory pressed between the chord sheets',
    'stays on the last note longer than required',
    // Late night and city
    'walks the long way home through neon and shadow',
    'sits at the window while the city does not sleep',
    'watches the avenue from the third floor up',
    'nurses the last drink while the piano continues',
    'stays until the bartender turns the last light down',
    'finds the whole story in a two-bar break',
    'listens to the rain on glass and hears a groove',
    'orders another round and lets the standard play',
    'reads the night like changes on a chart',
    'arrives late stays late and leaves something behind',
    // Improvisation and music
    'improvises over changes nobody else can hear',
    'swings the phrase until it finds its weight',
    'comps behind the melody like it was breathing',
    'takes the solo somewhere nobody expected',
    'resolves the tension on the very last bar',
    'turns the standard inside out and makes it new',
    'finds the pocket and lives there for a while',
    'walks the bass line all the way to dawn',
    'plays the wrong note right and makes it mean something',
    'voices the chord so every note can speak',
    // Bittersweet wisdom
    'learns the lesson at the end of every set',
    'knows the price of beauty is the blues',
    'understands the best things happen after midnight',
    'holds the moment before the whole thing fades',
    'forgives the night for everything it took',
    'accepts the minor key with something like relief',
    'finds the grace note in the saddest phrase',
    'loves the music more than anything it costs',
    'keeps the faith in every key and every room',
    'makes peace with what the changes never resolved',
  ],
  images: [
    'at the corner table where the light is low',
    'when the piano trio starts the last set of the night',
    'in the blue hour between the music and the morning',
    'when the saxophone holds the note and nobody breathes',
    'at the after-hours club where the real music starts',
    'when the chord resolves and everything relaxes',
    'in the smoke above the stage on a Thursday night',
    'when the brushed snare swings and everything clicks',
    'at the bar where regulars know the standards cold',
    'when the trumpet plays the phrase that breaks your heart',
    'in the quiet between two songs that belong together',
    'when the bassist walks the line and everything follows',
    'at the session where nobody checked the time',
    'when the improvisation found what the melody missed',
    'in the city after rain with neon on the pavement',
    'when the bridge arrived and changed everything before it',
    'at the table for one with the whole night ahead',
    'when the minor seventh landed and stayed too long',
    'in the apartment where the record was always playing',
    'when the last note faded and the room held still',
    'at the club on the corner that closed years ago',
    'when the song caught the feeling words had missed',
    'in the back of the cab after the show ended',
    'when the pianist found the voicing and nodded once',
    'at 2am when the night finally tells the truth',
    'when the changes moved through every key they knew',
    'in the moment before the head returns from the solo',
    'when the whole band locked in and nobody led',
    'at the recording where the take was never better',
    'when the music was the only honest language left',
  ],
  modifiers: [
    'low and slow and true',
    'after midnight when the real things come out',
    'in the key of blue',
    'tenderly and without apology',
    'one more time before the night is over',
    'with the weight of everything unsaid',
    'quietly and with complete conviction',
    'in the way that only music understands',
    'softly like a secret between the notes',
    'deep into the changes where the feeling lives',
    'sweetly and a little brokenhearted',
    'from the gut — from the very root of it',
    'the way the old recordings knew how to',
    'in the blue light of a room nobody found',
    'simply and without needing to explain',
    'with feeling — that has always been the whole instruction',
    'as the night comes apart at the seams',
    'in tempo and in truth and in the pocket',
    'slowly so the beauty has room to breathe',
    'like the last time was always the best time',
  ],
  hookFragments: [
    'this feeling has a melody I cannot get out of my head',
    'the night is long and blue and perfect for this song',
    'I keep coming back to this table and this tune',
    'you were the standard I was never done learning',
    'the music knows what words could never hold',
    'low light late night the piano plays what I can\'t say',
    'one more round one more song before we say goodnight',
    'I loved you best somewhere between the bridge and the last chorus',
    'the changes keep returning to the same sweet place',
    'swing it easy let the night do all the heavy work',
    'this is the song that plays when everything is clear',
    'I hear you in the melody I cannot name',
    'the trumpet said it better than I ever could',
    'some loves live in the minor key forever',
    'we were a standard that nobody else could play',
    'the after-hours version is the only honest one',
    'I will find you at the end of every song I know',
    'the blue note is the one that holds the whole thing together',
    'nobody plays the changes quite the way you did',
    'everything true happens after midnight in a minor key',
  ],
  bridgeLines: [
    'There are songs that know you better than you know yourself',
    'The blues is not sadness — it is sadness made beautiful',
    'Some nights the music is the only thing that makes sense',
    'The best jazz happens when nobody tries to control it',
    'Love is a standard everyone covers but nobody owns',
    'The bridge is the part where the song tells the truth',
    'What the saxophone says cannot be said another way',
    'I have been coming to this room for years to hear this',
    'The night does not end — it just changes key',
    'You learn more from one good take than from a hundred rehearsals',
  ],
  outroLines: [
    'The set ends but the melody does not leave the room',
    'Last call for the music and the feeling it delivers',
    'We were here and the night heard every note of it',
    'Tomorrow starts but tonight was worth every hour',
    'The piano holds the last chord until the room is ready',
    'Good night — the tune will still be here next time',
  ],
  titles: [
    'After Midnight','Blue Hour','Late Night Standard','Smoke and Keys','The Changes',
    'In a Minor Key','Last Set','Corner Table','The Bridge','Neon Rain',
    'Tenderly','After Hours','The Real Thing','One More Round','Blue Note',
    'Almost Blue','Night Sessions','The Standard','Long Way Home','Impressions',
    'Autumn Leaves','All the Things','Round Midnight','My Funny Valentine','So What',
    'Blue in Green','Naima','Maiden Voyage','Watermelon Man','Footprints',
    'Inner Urge','Speak No Evil','Infant Eyes','Witch Hunt','The Night Has a Thousand Eyes',
    'Take Five','Summertime','Misty','Body and Soul','How High the Moon',
    'Moonlight in Vermont','Stardust','What a Wonderful World','Someone to Watch Over Me','Fly Me to the Moon',
    'The Look of Love','Satin Doll','Lush Life','Stompin at the Savoy','Round About Midnight',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — METAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_METAL = {
  keywords: ['metal','heavy metal','thrash','death metal','black metal','doom','power metal','metalcore','deathcore','djent','slayer','metallica','pantera','iron maiden','black sabbath','tool','mastodon','gojira','lamb of god','trivium','parkway drive','bring me the horizon','system of a down','riff','breakdown','shred','mosh','double kick','drop tuned','distortion','palm mute','blast beat','growl','scream','down tuned','seven string','chug','progressive metal','prog metal','progressive','djent metal','stoner metal','sludge metal','post-metal','nu-metal','nu metal','symphonic metal','folk metal','viking metal'],
  cadenceTarget: [5, 13],
  rhymeStyle: 'end',
  rhymeSchemes: ['ABAB','AABB'],
  sectionTags: ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Guitar Solo]','[Chorus]','[Outro]'],
  structures: [
    // Classic metal: intro riff, verse-chorus-solo (Metallica / Megadeth)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Guitar Solo]','[Chorus]'],
    // Full arrangement with outro (Iron Maiden / Judas Priest)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Pre-chorus build to explosion (Disturbed / Hatebreed)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Late solo: solo replaces bridge (early Slayer / Pantera)
    ['[Intro]','[Verse 1]','[Chorus]','[Bridge]','[Guitar Solo]','[Chorus]','[Outro]'],
    // Breakdown showcase (metalcore: Killswitch / As I Lay Dying)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Breakdown]','[Guitar Solo]','[Chorus]'],
    // Epic closer: double solo (classic prog-metal: Dream Theater)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Breakdown]','[Guitar Solo]','[Final Chorus]'],
    // Speed intro (thrash tradition: Testament / Exodus)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Guitar Solo]','[Outro]'],
    // Two-solo structure (progressive metal: Opeth / Mastodon)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Guitar Solo]','[Bridge]','[Final Chorus]'],
    // Riff-heavy: minimal vocals, maximum riff (Riff + breakdown)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Guitar Solo]','[Final Chorus]'],
    // Pure aggression: no solo (hardcore-influenced metal)
    ['[Verse 1]','[Chorus]','[Guitar Solo]','[Bridge]','[Breakdown]','[Chorus]','[Outro]'],
    // Doom metal: long sections, no solo (Black Sabbath / Candlemass)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Death metal: blast beat structure (Cannibal Corpse / Morbid Angel)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Breakdown]','[Outro]'],
    // Power metal: full epic structure (Blind Guardian / Helloween)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Guitar Solo]','[Final Chorus]','[Outro]'],
    // Nu-metal: verses with rap delivery, screamed chorus (Linkin Park era)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Breakdown]','[Final Chorus]'],
    // Alternative metal single (Soundgarden / Tool radio cut)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Symphonic: long intro and outro (Nightwish / Epica)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Guitar Solo]','[Chorus]','[Outro]'],
    // Modern metalcore: breakdown heavy
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Breakdown]','[Chorus]','[Outro]'],
    // Classic British heavy metal (Sabbath/Purple blueprint)
    ['[Intro]','[Verse 1]','[Chorus]','[Guitar Solo]','[Verse 2]','[Chorus]','[Outro]'],
  ],
  adlibs: [],
  subjects: [
    'I','we','the darkness','this rage','the beast','chaos','the void',
    'this fury','the machine','blood','the storm','fire','the abyss',
    'iron','the fallen','ash','the blade','thunder','vengeance',
    'the forge','the warrior','the damned','steel','the throne',
    'this war','the siege','wrath','the ruins','the grave',
    'the horde','plague','the last stand','the resistance','the defiant',
    'every wall','the unbroken','the survivor','the ancient ones','the force',
    'every chain','the inferno','the earth','the tide','the line',
  ],
  verbPhrases: [
    // SHORT FORM — 2-5 syllables (for fast BPM targeting)
    'rises','burns','tears down','strikes hard',
    'crushes through','descends','unleashes','hammers',
    'detonates','screams','forges on','will not fall',
    'stands firm','rages','will not bend',
    // Power and destruction (SHORT - these are metal lyrics, not essays)
    'rises from the ashes one more time',
    'burns through every wall they built',
    'tears down everything that tried to hold me',
    'strikes with everything I have left',
    'crushes what was standing in the way',
    'descends with the weight of all the fury',
    'unleashes what was coiled inside',
    'hammers through the lies until they break',
    'detonates in the space before the drop',
    'obliterates every comfortable pretense',
    // Defiance and war
    'stands when everything else fell down',
    'refuses every version of surrender',
    'fights through the dark until the dawn',
    'wages war on everything that holds me back',
    'charges the line they said I could not cross',
    'breaks the chain they welded just for me',
    'marches when every voice said stop',
    'battles through what should have ended this',
    'conquers every doubt with nothing but my will',
    'resists until there\'s nothing left to resist',
    // Darkness and mythology
    'walks through fire like it recognizes me',
    'calls from the abyss in the oldest tongue',
    'emerges from the dark with something forged there',
    'commands the storm because I survived it',
    'rises from the grave they dug too shallow',
    'was forged in fire and came out harder',
    'carries every fallen one who came before',
    'awakens what was sleeping in the deep',
    'holds the darkness up to what it means',
    'descends into the void and claims it all',
    // Raw anger
    'screams what the polite mouth swallowed whole',
    'releases what was caged for way too long',
    'speaks in the only language big enough',
    'turns the anger into something they can feel',
    'gives the fury the shape it always deserved',
    'channels everything they took and throws it back',
    'makes the darkness loud enough to hear',
    'plays until the walls understand the volume',
    'earns every single decibel of this',
    'expresses what the daylight never allows',
    // Survival and strength
    'survives what was the final blow they planned',
    'endures beyond the limits they predicted',
    'outlasts every attempt to break the will',
    'emerges stronger from the fire they set',
    'remains when everything around it burned',
    'holds the line through everything they sent',
    'returns from the edge with what the edge contains',
    'builds on rubble what the rubble could not stop',
    'proves through existence that the end was wrong',
    'stands at zero and rebuilds from here',
  ],
  images: [
    'in the pit where honesty has no filter',
    'when the riff drops and every guard goes down',
    'through the breakdown that strips away the fake',
    'at the show where the music said the real thing',
    'when the double kick locks in and everyone moves',
    'through the solo that said it all in eight bars',
    'at the drop that confirmed every tension',
    'in the mosh where the violence means something',
    'when the chorus hit and the whole room became one',
    'through the distortion making the feeling the right size',
    'at the venue too small too hot exactly right',
    'in the riff that lived inside for years before this',
    'when the guitar found the note that said everything',
    'through the night that needed this specific volume',
    'at the breakdown where only the real remained',
    'in the lyrics finally saying the forbidden thing',
    'when the blast beats synchronized with the heartbeat',
    'through the crowd moving as a single breathing thing',
    'at the point where music and emotion became the same',
    'in the room where the song was built from nothing',
    'when the final chord rang into the right silence',
    'through the late nights building the riff the album needs',
    'at the crossing point between the melody and the fury',
    'in the verse where myth and personal truth merge',
    'when the pyro confirmed what the music already proved',
    'through the tour that tested everything except the will',
    'at the festival where the music finally reached everyone',
    'in the song that found the people before they found it',
    'when the whole band locked in simultaneously',
    'at the moment everything they built was worth the cost',
  ],
  modifiers: [
    'without mercy — the only honest approach',
    'with everything the years compressed into this',
    'loud and without apology for the volume',
    'forged in fire and harder for the making',
    'through the darkness and out the other side',
    'without surrender — it was never an option',
    'at maximum volume because the truth requires it',
    'with the intensity of everything held back too long',
    'relentlessly — because stopping was never in the plan',
    'down to the bone where only the real lives',
    'from the abyss where all honest things begin',
    'with the weight of every year behind the note',
    'unbroken — they built something that cannot break this way',
    'raw and without the polish that would cost too much',
    'permanent — this cannot be unsaid or softened now',
    'with total commitment to what the darkness holds',
    'at full power — the only appropriate setting',
    'through every resistance arranged to prevent this',
    'true to the tradition that demands everything',
    'magnificently and terribly — which is power being itself',
  ],
  hookFragments: [
    'we rise from the ashes and they never expected us to rise',
    'the rage is real and the music holds it all',
    'I will not break — this is not what I was built for',
    'the fire takes what isn\'t worth the keeping',
    'we refused every version of the surrender they offered',
    'the darkness made me — it does not scare what it made',
    'I carried the weight until the weight became the ground',
    'we will not be silenced — we will be louder',
    'the storm forged what the calm could never make',
    'I am the thing that survived the ending they planned',
    'the riff is the argument the solo is the proof',
    'we stand at the edge and we do not step back',
    'born in the fire and we return willingly',
    'the machine tried to contain this — the machine was wrong',
    'we rise together or we fall apart and alone',
    'the fury is focused — it knows exactly what it aims at',
    'I went to the darkness and came back with the knowledge',
    'the music says what words alone could never carry',
    'we are the resistance to everything small and soft',
    'the breakdown is the honest part — everything before was intro',
  ],
  bridgeLines: [
    'The strength you need is only found when you are emptied out',
    'The music is not angry — it is honest at full volume',
    'We were made from everything they used to try unmake us',
    'The guitar says what civilization asked us to swallow',
    'Every trial designed to end us became the building material',
    'This is not destruction — this is the clearing before the build',
    'The darkness is not the enemy — real things form in darkness',
    'We are the survivors of every ending they called final',
    'The fury was never the point — the truth under it was always',
    'We stand here forged by what was supposed to reduce us',
  ],
  outroLines: [
    'The music ends — the force it expressed does not',
    'We were here and we were loud and we meant it all',
    'This is honesty when it stops asking permission to be loud',
    'The darkness made something the light alone could never build',
    'We remain — in spite of every prediction — that is the statement',
    'The fury found its form and the form outlasts the silence',
  ],
  titles: [
    'The Forge','Iron Will','From the Ashes','The Reckoning','Unbroken',
    'Blood and Thunder','The Descent','War Machine','Obliterate','The Siege',
    'Forged in Darkness','The Uprising','Infernal','Reign of Fire','The Void',
    'Warlord','Catastrophe','The Endurance','Devastation','Black Iron',
    'The Resistance','Crucible','Leviathan','The Survivors','Dominion',
    'Rage Form','Breaking Point','Monolith','Into the Fray','Battleground',
    'Steel and Fire','The Collapse','Behemoth','War Cry','The Last Stand',
    'Unyielding','Thunder God','Colossus','The Storm','Dark Forge',
    'Mass Extinction','The Charge','Iron Throne','Death March','The Wake',
    'Destroyer','Requiem','Sovereign','Hellfire','Eternal Flame',
    'Ground Zero','Heavy Machinery','The Force','The Ancient Ones','Inferno',
    'Dead Weight','The Burning','No Quarter','Iron Cross','Siege Engine',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — REGGAE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_REGGAE = {
  keywords: ['reggae','dancehall','dub','roots reggae','one-drop','skank','riddim','rasta','rastafari','jah','babylon','irie','patois','jamaican','kingston','trenchtown','bob marley','peter tosh','bunny wailer','damian marley','chronixx','protoje','one love','ska','rocksteady','roots','culture','conscious','spiritual','reggaeton'],
  cadenceTarget: [5, 12],
  rhymeStyle: 'end',
  rhymeSchemes: ['AABB','ABAB'],
  sectionTags: ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
  structures: [
    // Roots reggae: verse-chorus-bridge (Bob Marley / Burning Spear)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Intro riddim then three verses (classic Studio One format)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Outro]'],
    // Dub break showcase (Lee Scratch Perry / King Tubby influence)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Dub Break]','[Bridge]','[Chorus]'],
    // Extended dub outro (Sound system culture format)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Dub Break]','[Outro]'],
    // Two verse setup before chorus (Dennis Brown / Gregory Isaacs)
    ['[Intro]','[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Dancehall: hook-first format (Shabba / Sean Paul)
    ['[Hook]','[Verse 1]','[Hook]','[Verse 2]','[Bridge]','[Hook]','[Outro]'],
    // Contemporary: pop reggae structure (Omi / MAGIC! crossover)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // Instrumental break mid-song (nyahbinghi drum showcase)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Tag ending: repeated chorus fade (Sound system sendoff)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Tag]','[Outro]'],
    // Ska-reggae hybrid: short punchy sections
    ['[Intro]','[Verse 1]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Three-verse consciousness (Bunny Wailer / Peter Tosh)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Bridge]','[Chorus]'],
    // Lovers rock: smooth ballad structure (Janet Kay / Carroll Thompson)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // Rockers: militant roots (Culture / Steel Pulse)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Modern reggae fusion (Chronixx / Protoje)
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Bridge]','[Outro]'],
    // Afrobeats-reggae crossover (Damian Marley / Popcaan)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Classic riddim structure: verse-heavy
    ['[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // One drop: meditative long form
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Dub Break]','[Outro]'],
    // Dancehall riddim: rapid verse delivery
    ['[Intro]','[Hook]','[Verse 1]','[Verse 2]','[Hook]','[Bridge]','[Hook]'],
  ],
  adlibs: ['(irie)','(one love)','(jah bless)','(yeah)','(give thanks)','(roots)','(selah)'],
  subjects: [
    'I','we','jah','the people','this love','the truth','my soul',
    'the roots','this message','the earth','one love','the riddim',
    'this road','my heart','the fire','the light','every brother',
    'the song','this movement','the rain','my people','the drum',
    'every sister','the river','this vibes','the ancient ways',
    'my faith','the resistance','this blessing','the morning',
    'every warrior','the harvest','this prayer','the ancestors',
    'my voice','the struggle','this peace','the unity','jah love',
    'every rasta','the herb','this freedom','the culture','the youth',
  ],
  verbPhrases: [
    // Consciousness and justice
    'chants down babylon with the morning prayer',
    'stands firm on the rock of ages',
    'speaks truth to power without a filter',
    'rises above the system and its chains',
    'holds the light for every one who searches',
    'knows that jah will make the pathway straight',
    'carries the message to the furthest corner',
    'calls the people home across the water',
    'burns the wickedness and plants the seed',
    'walks in righteousness on the old roads',
    // Love and unity
    'loves like the river loves the sea — without condition',
    'holds you close through every storm that comes',
    'finds the beauty in the struggle we all share',
    'builds the bridge between every tribe and nation',
    'feels the one love pulse through all creation',
    'keeps the faith that brought us through before',
    'shares the bread and water with the brethren',
    'gathers every scattered child back home',
    'sings the song that heals the broken heart',
    'gives thanks for every morning jah provides',
    // Rootsical / nature
    'grows deep like the roots in the red earth',
    'flows like the river heading to the sea',
    'rises with the sun over the eastern hills',
    'stands like the ceiba in the tropical storm',
    'seeds the ground with every word of truth',
    'reads the herbs and knows what each one heals',
    'feels the earth beneath the feet and understands',
    'follows where the drumbeat always leads',
    'rests beneath the mango tree at evening time',
    'plants today what generations will be blessed by',
    // Resistance and freedom
    'will not bow to babylon and never will',
    'fights with love because love is the stronger force',
    'overcomes what every generation faced before',
    'refuses every chain they try to put on',
    'breaks the mental slavery that the system builds',
    'sings the freedom song in every mother tongue',
    'marches to the one-drop until every wall falls',
    'liberates the mind before the body follows',
    'stands on every promise that was made before',
    'trusts the path that jah has always lit',
    // Peace and joy
    'dances in the rain because the rain is jah\'s gift',
    'finds the irie in the ordinary day',
    'brings the positive vibration everywhere',
    'lights the way with every smile and step',
    'creates the peace this world has always needed',
    'sings the joy that no oppression takes away',
    'keeps the rhythm going through the hard times too',
    'celebrates the life that jah ordained',
    'moves with the riddim that was here before all this',
    'carries peace like water in cupped hands',
  ],
  images: [
    'when the one-drop locks in and the whole room opens',
    'in the yard at evening while the fire burns low',
    'where the river meets the sea and both become one',
    'when the bass line moves through the body like a prayer',
    'at the dance where everybody came in peace',
    'in the hills where the drumming started long before us',
    'when the natural mystic flows through the air',
    'at the crossroads where jah placed the sign we needed',
    'when the riddim rises like the sun and warms everything',
    'in the tenement yard where the music was born hungry',
    'when the roots and culture speak louder than the system',
    'at the beach at sunrise with the whole ocean answering',
    'when the herb and the truth produced the same clear sight',
    'in the place where every color danced the same dance',
    'when the elders sang the song we were just learning',
    'at the sound system where the bass shook the street',
    'when the one love found a room and filled it floor to ceiling',
    'in the season between the rains when everything grows',
    'when the children heard the music and already knew it',
    'at the ceremony where the ancestors were present',
    'when the babylon fell and nobody mourned the falling',
    'in the community that built itself from next to nothing',
    'when the spiritual fire could be felt but not explained',
    'at the concert where every hand was raised for peace',
    'when the harmony between the voices meant something permanent',
    'in the morning when the dew was still on every leaf',
    'when the message in the music outlasted every messenger',
    'at the river of baptism where the old self stayed behind',
    'when the positive vibration arrived before the singer did',
    'in the space between the skank and the bass note — that is home',
  ],
  modifiers: [
    'irie — in the highest and the deepest sense',
    'for the people and by the people always',
    'in jah\'s time which is always the right time',
    'with roots that go deeper than the system reaches',
    'one love — that is the whole philosophy in two words',
    'standing firm on the rock that will not move',
    'give thanks and praise for every given day',
    'in the natural way that jah intended',
    'through the struggle knowing freedom always comes',
    'with the positive vibration in every note',
    'on the righteous path that the ancestors walked',
    'together because apart we never reach the place',
    'with the drumbeat that was here before and stays after',
    'in the consciousness that the music always brings',
    'steady and sure like the tide that always returns',
    'from the roots of everything that truly matters',
    'jah bless — and the blessing spreads from here',
    'without violence — love is always the louder weapon',
    'for every daughter and every son of the earth',
    'in the melody that crosses every border built',
  ],
  hookFragments: [
    'one love one heart we meet and feel all right',
    'jah is our light and our salvation — whom shall we fear',
    'rise up rise up the sun is high and jah is here',
    'chant down babylon with the power of the song',
    'every little thing is gonna be all right tonight',
    'I and I stand firm on the rock of Zion',
    'the roots run deep and the music runs deeper still',
    'love is the only answer love is the only way',
    'we shall overcome because the truth is on our side',
    'the riddim carries every heart across the water',
    'give thanks and praise for every morning that arrives',
    'no weapon formed against the righteous will prevail',
    'the drum speaks truth in every tongue and time',
    'stand up for your rights jah is watching every move',
    'from the mountains to the valley one people one song',
    'the fire burns for justice and it will not be put out',
    'we carry africa in the music and the heartbeat',
    'natural mystic flowing through the early air',
    'the message in the music is older than the singer',
    'peace and love and unity — that is always the reply',
  ],
  bridgeLines: [
    'The music was the map and the roots were always home',
    'Jah put the song in us before we even knew the words',
    'What babylon built with fear love always dismantles',
    'The one-drop is a heartbeat and a heartbeat is a prayer',
    'We suffer what we suffer but the song outlasts the suffering',
    'Every chain they place is made to fall — jah said so',
    'The river runs regardless of what stands against it',
    'Roots mean you cannot be removed — you only grow from this',
    'The positive vibration is not a style — it is a choice',
    'We dance because the body knows what the mind is still learning',
  ],
  outroLines: [
    'One love — carry it wherever you are going next',
    'Jah bless and keep every one on this righteous road',
    'The riddim does not stop — it only changes form',
    'Give thanks for the music and the truth inside it',
    'The roots hold — through everything they held',
    'Irie is the last word and the first word — always has been',
  ],
  titles: [
    'One Love','Natural Mystic','Roots and Culture','Jah Is Here','Righteous Road',
    'Rise Up','Chant Down','The Riddim','Give Thanks','Irie Vibes',
    'Positive Vibration','Roots Run Deep','Stand Firm','One Heart','Zion Gate',
    'Freedom Song','Burning Spear','Jah Provision','The Drumbeat','Kingston Morning',
    'Trenchtown','Exodus Spirit','Roots Rock','One Drop','Conscious',
    'African Queen','Warrior Charge','Love and Unity','Natty Dread','Red Gold Green',
    'Babylon System','Liberation','Three Little Birds','No Weapon','Overstanding',
    'The Harvest','Rain Come Down','River of Life','Climb Mountains','The Journey Home',
    'Rastafari Lives','Solar System','Earth and Stars','Ancient Ways','The Crossing',
    'Motherland','Sacred Fire','The Message','Unbreakable','Culture Roots',
    'Duppy Conqueror','No Woman No Cry Reprise','Simmer Down','Pressure Drop','Rivers of Babylon',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — FOLK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_FOLK = {
  keywords: ['folk','singer-songwriter','acoustic','americana','indie folk','folk rock','bluegrass','appalachian','mountain','fingerpicking','banjo','fiddle','mandolin','harmonica','bob dylan','joni mitchell','neil young','fleet foxes','bon iver','phoebe bridgers','noah kahan','iron and wine','gregory alan isakov','caamp','big thief','weyes blood','sufjan stevens','storytelling folk','confessional','pastoral'],
  cadenceTarget: [5, 12],
  rhymeStyle: 'end',
  rhymeSchemes: ['AABB','ABCB','ABAB'],
  sectionTags: ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Verse 3]','[Chorus]','[Outro]'],
  structures: [
    // Classic folk: verse-chorus storytelling (Joni Mitchell / Bob Dylan)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Three-verse narrative with late chorus reveal
    ['[Verse 1]','[Verse 2]','[Chorus]','[Verse 3]','[Bridge]','[Chorus]','[Outro]'],
    // Simple verse-chorus-verse (Gordon Lightfoot / John Denver)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Ballad: four verses, minimal chorus (Leonard Cohen / Tom Waits)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Chorus]','[Verse 4]','[Outro]'],
    // Instrumental intro sets pastoral mood (Pentangle / Fairport Convention)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Outro]'],
    // Through-composed: no repeating chorus (Townes Van Zandt style)
    ['[Verse 1]','[Verse 2]','[Verse 3]','[Chorus]','[Verse 4]','[Outro]'],
    // Folk rock: chorus-forward structure (The Lumineers / Mumford & Sons)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // Banjo/fiddle instrumental break (Appalachian tradition)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Instrumental Break]','[Chorus]'],
    // Narrative arc: three acts in verse (Simon & Garfunkel)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Instrumental Break]','[Outro]'],
    // Late chorus revelation (Gillian Welch / Iris DeMent)
    ['[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Verse 3]','[Outro]'],
    // Tag ending: repeated refrain (traditional song structure)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Tag]'],
    // Modern folk pop (First Aid Kit / The Civil Wars)
    ['[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Pre-Chorus]','[Chorus]','[Bridge]','[Chorus]'],
    // No bridge: pure simplicity (early Cat Stevens / James Taylor)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Outro]'],
    // Short contemporary folk (Iron & Wine / Jose Gonzalez minimalism)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Outro]'],
    // Double verse before chorus build (Nick Drake / Elliott Smith)
    ['[Intro]','[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Closing song of set: longer form, bigger finish
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Chorus]'],
    // Anti-folk: chorus first, deconstructed (Regina Spektor / Jonathan Richman)
    ['[Chorus]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Spoken word middle (Woody Guthrie / Pete Seeger tradition)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Spoken Bridge]','[Verse 3]','[Chorus]'],
  ],
  adlibs: [],
  subjects: [
    'I','you','we','this road','the old house','my father','the river',
    'the fields','this autumn','my grandmother','the town','the years',
    'this morning','the light','your hands','the front porch','the frost',
    'my mother','the neighbor','this place','the season','the miles',
    'this winter','the harvest','your voice','the hollow','the creek',
    'this letter','the old song','the photograph','the mountain','my name',
    'the kitchen','this leaving','the garden','the grave','your smile',
    'the storm','this homecoming','the ridge','the hearth','the candle',
    'this truth','the memory','your absence','the silence','the faith',
  ],
  verbPhrases: [
    // Memory and place
    'remembers every corner of the house I left',
    'walks the same road I walked when I was young',
    'keeps the old ways even when the world forgets',
    'carries the name of every one who came before',
    'knows the turning of the seasons like a prayer',
    'finds the light in the familiar everyday',
    'holds the story like the creek holds stones',
    'reads the years in every line upon the face',
    'returns to the same hillside every time',
    'misses what was simple and cannot be retrieved',
    // Love and relationship
    'loves you more on quiet mornings than the rest',
    'waits at the window when the winter comes again',
    'finds you in the song I wrote before I knew you',
    'keeps every letter in the drawer beside the bed',
    'builds the life we planned one ordinary day at a time',
    'holds your hand through every difficult and plain thing',
    'watches you sleep and finds the words still missing',
    'stays when staying was the harder thing to do',
    'follows you into the uncertain and the good',
    'loves the life we made from what we had',
    // Journey and longing
    'wanders far before the hunger turns to home',
    'drives the long way just to see the stars from here',
    'leaves again and carries everything I took last time',
    'walks out in November when the grief is heavy',
    'searches for the town I carry everywhere I go',
    'misses places that exist now only in the remembering',
    'comes back changed and finds the place unchanged',
    'crosses into unfamiliar country with a familiar song',
    'finds the home I never had in every place I pass',
    'travels toward the version of myself I left behind',
    // Truth and simplicity
    'tells the honest story without dressing it up',
    'says the simple thing and trusts that it is enough',
    'finds the whole truth in a single ordinary morning',
    'sees the beauty in what nobody photographs',
    'speaks plainly and trusts the plainness to carry',
    'knows that kindness is the only useful currency',
    'learns the lesson slowly and does not forget it',
    'builds from what is given not what was imagined',
    'believes in ordinary grace and nothing else',
    'understands that most of life is just this — small and whole',
    // Nature and seasons
    'watches winter turn to spring and knows what this means',
    'hears the birds before the morning opens',
    'smells the first frost and understands the year is ending',
    'plants the seeds in faith that something comes from planting',
    'walks barefoot in the grass and remembers childhood',
    'harvests what the season and the labor earned',
    'sits outside through every kind of weather anyway',
    'reads the river for the story of the hill above',
    'loves the mountains more the longer I am from them',
    'welcomes the returning season like a long-missed friend',
  ],
  images: [
    'on the porch at dusk when the light goes gold and slow',
    'in the kitchen when the coffee was still hot',
    'at the crossroads where I stood and could not choose',
    'when the first frost came and covered everything in quiet',
    'in the old photograph where everyone was younger',
    'at the funeral where the hymns were the only honest thing',
    'when the harvest came in and the whole town gathered',
    'in the letter written and not sent for fifteen years',
    'at the gate of the town I left and came back changed',
    'when the fiddle started and my grandmother began to cry',
    'in the field behind the house where the creek runs cold',
    'at the campfire where the old songs got remembered',
    'when the snow fell on the first night of the new year',
    'in the last summer before everything was different',
    'at the kitchen table with the newspaper and the silence',
    'when the seeds came up and the work was justified',
    'in the room where my parents sat and I pretended to sleep',
    'at the window of the train watching the country change',
    'when the song my father hummed became my whole childhood',
    'in the church where nobody had to explain the feeling',
    'at the border of familiar and the world I didn\'t know',
    'when autumn came and I understood the year was honest',
    'in the garden where the things that mattered grew slowly',
    'at the bedside at the end where words were not required',
    'when the maple turned and the whole hill caught fire briefly',
    'in the truck on the county road with nothing but the radio',
    'at the table where four generations once sat together',
    'when the simple life looked complicated from the outside',
    'in the season between green and gone — that precise moment',
    'at the creek where we grew up and never fully left',
  ],
  modifiers: [
    'plain and honest — the only way I know',
    'simply because that is always enough',
    'like the old ways — slowly and with meaning',
    'as the crow flies — straight to what matters',
    'quiet and true and not asking for more than that',
    'in the manner of people who built this from nothing',
    'with everything still in the hands of the seasons',
    'the way a river carries everything and asks for nothing',
    'without fanfare — the real things rarely need it',
    'in the years before everything got complicated',
    'steady as the tide that has no opinion on the shore',
    'with the patience that the good things always demand',
    'gently and specifically — the way real love works',
    'in the language of people who know what hard means',
    'deeply rooted in what cannot be moved or purchased',
    'as the light does — without asking to be noticed',
    'with calloused hands and something clear in the eyes',
    'on the long road that eventually arrives somewhere worth being',
    'in the key of ordinary which is the most honest key',
    'without explanation because some things explain themselves',
  ],
  hookFragments: [
    'I will find my way back to the old familiar place',
    'the years were long but the love was longer still',
    'home is not a place — it is the people in the song',
    'I carry you in every mile between the leaving and return',
    'the truth is simple and the simple truth is all I need',
    'some things stay with you every mile of every road',
    'the old house stands and everyone who loved it is elsewhere',
    'I plant the seeds and trust the season to the rest',
    'we were young and true and the years have not changed that',
    'the song I wrote for you still sings itself at three am',
    'I walked away from everything and found myself in it',
    'the river keeps on moving but the mountains never leave',
    'tell me where you are going and I will meet you there',
    'I have loved this life imperfectly and completely',
    'the ordinary day contains the whole extraordinary thing',
    'the front porch and the coffee and the morning — that is enough',
    'I learned the hard way and the hard way taught me good',
    'you are the north that every lost direction finds',
    'the roots go down as far as everything I come from',
    'I will keep this song until there is no one left to hear it',
  ],
  bridgeLines: [
    'The distance from where you started is not the same as progress',
    'Some things only make sense after you have left them',
    'The song my father sang I only learned the words to recently',
    'What the land remembers the people eventually forget',
    'Home is the feeling — the address always changes',
    'The simplest things held up the longest in the end',
    'I understand my parents now in ways I could not then',
    'The old songs carry freight that the new songs are still loading',
    'What looked like nothing from the road was everything inside',
    'The miles between us measure love as much as anything',
  ],
  outroLines: [
    'The road goes on but home is where I am pointing now',
    'Carry this wherever you go — the simple part is true',
    'The song ends but the story it came from does not',
    'Plant something here and leave the growing to the season',
    'Thank you for the ordinary days which were the best ones',
    'I will be back — I am always coming back in the end',
  ],
  titles: [
    'The Long Road','Home Again','Stick Season','Old House','The River',
    'Harvest Moon','Before the Frost','The Hollow','Appalachian','All The Miles',
    'Plain Truth','Homecoming','The Old Ways','Four Seasons','Simple Grace',
    'The Turning','November','First Frost','The Porch Light','Where We Come From',
    'By and By','Peach Fuzz','The Stable Song','Big Black Car','Tailspin',
    'Motion Sickness','Garden Song','Savior Complex','Funeral','Moon Guitar',
    'Flightless Bird','Naked As We Came','Our Endless Days','Skinny Love','Holocene',
    'White Winter Hymnal','Helplessness Blues','Shore','Both Sides Now','Blue',
    'Landslide','Gold Dust Woman','A Case of You','River','California',
    'Heart of Gold','Old Man','Harvest','After the Gold Rush','The Needle',
    'What We Have','Small Town','County Road','The Letter','Your Name',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — PUNK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_PUNK = {
  keywords: ['punk','punk rock','pop punk','pop-punk','hardcore','post-punk','emo','skate punk','green day','blink-182','the clash','ramones','sex pistols','bad religion','nofx','misfits','dead kennedys','descendents','social distortion','the offspring','pennywise','rancid','minor threat','black flag','fugazi','jawbreaker','antioch arrow','power chord','fast','loud','diy','cbgb','gilman street','mohawk','safety pin','anarchy'],
  cadenceTarget: [4, 9],
  rhymeStyle: 'end',
  rhymeSchemes: ['AABB','ABAB'],
  sectionTags: ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
  structures: [
    // Classic punk: short and fast (Ramones / Sex Pistols)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // No bridge: pure energy (Minor Threat / Black Flag hardcore)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Outro]'],
    // Double verse before chorus (The Clash / Bad Religion)
    ['[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Short bridge into final chorus (Buzzcocks / Wire)
    ['[Intro]','[Verse 1]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Guitar solo in punk (The Descendents / NOFX)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Guitar Solo]','[Chorus]'],
    // Final chorus key shift (Green Day pop-punk)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // Three verses, tight chorus (The Misfits / Stiff Little Fingers)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]'],
    // Breakdown into chaos (hardcore / Youth of Today)
    ['[Verse 1]','[Verse 2]','[Chorus]','[Breakdown]','[Chorus]','[Outro]'],
    // Tag repetition ending (Johnny Rotten / Sid era style)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Tag]'],
    // Double chorus at end (Blink-182 / Sum 41 pop punk)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Final Chorus]'],
    // Anthem punk: no solo, pure shout (Anti-Flag / Propagandhi)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Chorus-forward anthem (Against Me! / Bouncing Souls)
    ['[Chorus]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Final Chorus]'],
    // Minimal: two verses wrap single chorus
    ['[Verse 1]','[Chorus]','[Verse 2]','[Outro]'],
    // Post-punk: longer, atmospheric sections (Joy Division / The Cure)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]','[Outro]'],
    // Ska-punk: upstroke section as bridge (Less Than Jake / Reel Big Fish)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Ska Break]','[Chorus]'],
    // Street punk: four verse oral history
    ['[Verse 1]','[Verse 2]','[Chorus]','[Verse 3]','[Chorus]','[Outro]'],
    // Psychobilly / rockabilly punk: no bridge, raw energy
    ['[Intro]','[Verse 1]','[Chorus]','[Guitar Solo]','[Verse 2]','[Chorus]','[Outro]'],
    // Emo-punk: confessional verse, anthemic chorus (My Chemical Romance)
    ['[Intro]','[Verse 1]','[Pre-Chorus]','[Chorus]','[Verse 2]','[Bridge]','[Final Chorus]'],
  ],
  adlibs: ['(hey)','(oi oi oi)','(go)','(yeah)','(let\'s go)','(woah)'],
  subjects: [
    'I','we','the system','this town','the government','you','the rules',
    'this scene','the machine','my generation','the cops','the boss',
    'this life','the norm','the bullshit','my voice','the crowd',
    'this fist','the stage','the kids','this night','the street',
    'the revolution','my anger','the flag','this band','the noise',
    'every wall','the lie','this moment','the boredom','the suburbs',
    'my body','the future','this weekend','the mainstream','the show',
    'every expectation','the corporate','this feeling','the adults','punk',
  ],
  verbPhrases: [
    // SHORT FORM — 3-6 syllables (for fast BPM targeting)
    'won\'t stop','won\'t comply','fights back','screams loud',
    'breaks free','runs fast','hits hard','stands up',
    'pushes back','says no','tears down','burns it',
    'takes the stage','starts the pit','plays faster',
    'shouts back','won\'t bow','goes harder',
    // Anti-establishment short punchy lines
    'won\'t do what they tell me anymore',
    'tears down every sign they posted',
    'screams what the polite kids swallow',
    'runs faster than the rules can catch',
    'breaks the thing they told me not to touch',
    'shouts from every roof they said to leave',
    'refuses every version of their normal',
    'smashes through the comfortable and the fake',
    'turns it up until the neighbors call the cops',
    'says the word they told me not to say',
    // Energy and defiance
    'lives loud because quiet was already killing',
    'moves like the music is on fire inside',
    'fights back with the only weapon I was given',
    'crashes every gate that was not meant for me',
    'plays three chords and changes everything tonight',
    'makes the noise the suburbs tried to silence',
    'runs the whole show from the back of the room',
    'starts the circle pit and does not stop',
    'owns the street for two and a half minutes',
    'takes the stage like every stage belongs to me',
    // Boredom and restlessness
    'cannot sit still in the city of the comfortable',
    'burns the boredom out with speed and volume',
    'escapes the gray routine they called a life plan',
    'rejects the nine-to-five before the nine',
    'leaves the suburb in the rearview permanently',
    'finds the whole world in a two-minute song',
    'trades the safe thing for the real and faster one',
    'skips the part where I pretend to be content',
    'finds the exit sign and takes it seriously',
    'refuses to participate in the orderly decline',
    // Youth and identity
    'knows this moment is the only one that\'s real',
    'builds the identity they tried to hand me ready-made',
    'finds the family in the room that smells like sweat',
    'belongs to this and nothing that comes after',
    'understands more from three chords than from twelve years',
    'lives the whole manifesto in a three-minute set',
    'sees through every surface they presented as the truth',
    'chooses the noise over the silence they were offering',
    'makes the scene because there was no scene until we did',
    'grows up wrong and right and glad about the difference',
    // Community and show
    'sings along because the song says what I couldn\'t',
    'finds the real church in the sweaty basement show',
    'holds up the friend in the middle of the circle',
    'shows up early and stays until the last song ends',
    'builds the scene with everyone who showed up tonight',
    'remembers every show the way some people remember prayers',
    'carries the band\'s name like a mark that means something',
    'drives four hours for a show that lasts forty minutes',
    'gives everything that being young and furious contains',
    'leaves the venue changed the way nothing else manages',
  ],
  images: [
    'in the basement where the PA barely holds together',
    'when the first chord hit and everything else fell away',
    'at the show where nobody was watching from the outside',
    'when the whole room sang and nobody had to be asked',
    'in the city where the cheap rent bought us time to mean it',
    'when the set list was wrong but the energy was everything',
    'at the DIY venue that closed three months after this',
    'when the guitar feedback announced what language we spoke',
    'in the van between the cities at three in the morning',
    'when the stage was a step up from the floor — barely',
    'at the show where I finally found the people I was looking for',
    'when the chorus hit and thirty people moved as one dumb body',
    'in the record store where the whole education was free',
    'when the zine described exactly what was happening to us',
    'at the practice space that smelled like cigarettes and effort',
    'when the breakdown came and the pit opened like a door',
    'in the parking lot after the show still ringing',
    'when the band played the song I had not heard them play',
    'at the border of eighteen with everything ahead and fast',
    'when the music said the thing I had been choking on',
    'in the photo where everyone looks young and does not know it',
    'when the safety pin and the leather jacket found their owner',
    'at the hall where the adults said nothing good would happen',
    'when the anger finally had a form and the form was music',
    'in the summer that was purely noise and motion and enough',
    'when the line for the show went around the block in rain',
    'at the end of the last song before the lights came on',
    'when the scene was small enough that everyone knew everyone',
    'in the song that was three chords and the only truth we had',
    'when the kids in the back became the band we needed next',
  ],
  modifiers: [
    'no permission needed — that was never the agreement',
    'loud — because quiet was complicit',
    'now — there is no version of this that waits',
    'straight up — no packaging and no apology',
    'fast and true and not stopping for anyone',
    'raw because polish was the thing we were against',
    'with everything a twenty-year-old has — which is everything',
    'in spite of everything they told us about ourselves',
    'no compromise — that was the original founding principle',
    'exactly as intended — which was never the tidy version',
    'all the way through without checking if it\'s appropriate',
    'at volume — the only honest measurement',
    'by any means necessary and several means unnecessary',
    'together — the only way anything actually gets done',
    'from the gut — which is always more trustworthy',
    'without a net — the whole point was the without-a-net',
    'against every advice offered by every sensible adult',
    'full speed — the speedometer was never relevant',
    'DIY — because otherwise it belongs to someone else',
    'one more time — louder this time — until they understand',
  ],
  hookFragments: [
    'we don\'t need their permission and we never did',
    'three chords and the truth — that was always enough',
    'I am not what you wanted me to be and I am glad',
    'we built this scene from nothing and nobody helped us',
    'the system is broken and I am not the one who broke it',
    'turn it up until the comfortable become uncomfortable',
    'this is what a generation with nothing left to lose sounds like',
    'we were young and loud and it turned out that was the point',
    'I would rather be wrong and honest than right and polished',
    'the show starts when the PA squeals and never really ends',
    'everybody in this room found each other because of this',
    'the song is two minutes long and contains everything',
    'we are the noise in the machine that the machine cannot process',
    'do it yourself because nobody else was going to do it',
    'the future belongs to whoever shows up and makes it happen',
    'I have been coming to this venue since before I was legal',
    'the basement show is where the real church holds its service',
    'we sing together because singing apart means nothing to us',
    'louder than the adults who told us to find something productive',
    'this moment this room this song — nothing before or after matters',
  ],
  bridgeLines: [
    'We built this from nothing because nothing was what we had',
    'The record collection was the only education that mattered',
    'Some bands change your life and this was that band for me',
    'The music said I was not alone in any room I entered',
    'We are the kids they wrote the warnings about — that is correct',
    'The three-chord song contained more truth than the whole curriculum',
    'I came for the show and stayed because I finally found my people',
    'What looked like chaos from outside was a very specific order',
    'The point was never the point they thought we were making',
    'We turned the frustration into music and the music turned to community',
  ],
  outroLines: [
    'The show is over but the feeling does not have a closing time',
    'Go home safe — come back next week — bring someone who needs this',
    'The noise was never the problem — the silence was the problem',
    'We were here and we were loud and we would do it the same way',
    'The song ends — the argument it was making continues',
    'Until next time — keep it real keep it loud keep it yours',
  ],
  titles: [
    'No Permission','Three Chords','We Don\'t Comply','Loud and Wrong','The Basement',
    'Against the Grain','System Error','Faster','Two Minutes','The Circle Pit',
    'Not Your Kid','My Generation','Get Out','The Real Thing','Suburban Hell',
    'Holiday in Cambodia','Anarchy in the Scene','God Save','White Riot','London Calling',
    'Basket Case','Good Riddance','American Idiot','Blitzkrieg Bop','I Wanna Be',
    'Linoleum','The Decline','Punk in Drublic','All the Small Things','Dammit',
    'Misery Business','Brick by Boring Brick','Decode','Emergency','Ignorance',
    'Dirty Little Secret','Somewhere I Belong','Crawling','In the End','Numb',
    'Holiday','Boulevard of Broken Dreams','Wake Me Up','Jesus of Suburbia','Homecoming',
    'Radio Nowhere','I\'m Goin\' Down','Born to Run Again','The Promise','Thunder Road',
  ],
};

const GENRE_PHONK = {
  keywords: ['phonk','dark trap','memphis rap','hard trap','drift phonk','underground rap','seshollowaterboyz','suicideboys','$uicideboy$','bones','ghostemane','pouya','drain gang','night lovell','scarlxrd','lil peep','dark rap','hard 808','slowed reverb','phonk music','underground hip hop','aggressive trap','goth trap','memphis','three 6 mafia','screw','chopped','slowed','phonk rap','dark phonk','cowbell phonk','underground phonk','cowbell','phonk beat','drift music','car phonk'],
  cadenceTarget: [6,12],
  rhymeStyle: 'end',
  rhymeSchemes: ['AAAA','AABB','ABAB'],
  sectionTags: ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Bridge]','[Outro]'],
  structures: [
    // Classic phonk: verse-hook-verse minimal (Memphis style)
    ['[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Outro]'],
    // Intro drift then verses (drift phonk / Brazilian phonk)
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Bridge]','[Outro]'],
    // Double verse before hook (chopped and screwed structure)
    ['[Verse 1]','[Verse 2]','[Hook]','[Bridge]','[Hook]'],
    // Hook-bridge-hook minimal format
    ['[Intro]','[Verse 1]','[Hook]','[Bridge]','[Hook]','[Outro]'],
    // Three verse storytelling
    ['[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Verse 3]','[Outro]'],
    // Pure hook energy: Atlanta phonk
    ['[Hook]','[Verse 1]','[Hook]','[Verse 2]','[Hook]'],
    // Minimalist outro vamp
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Vamp]'],
    // Cold intro monologue into verse
    ['[Intro]','[Verse 1]','[Hook]','[Bridge]','[Verse 2]','[Outro]'],
    // Atmospheric: minimal lyrics, long instrumental gaps
    ['[Intro]','[Verse 1]','[Instrumental]','[Hook]','[Verse 2]','[Outro]'],
    // Slowed beat switch mid-song
    ['[Verse 1]','[Hook]','[Beat Switch]','[Verse 2]','[Hook]','[Outro]'],
    // Chorus-first phonk banger
    ['[Hook]','[Verse 1]','[Verse 2]','[Hook]','[Bridge]','[Outro]'],
    // Extended outro fade
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Extended Outro]'],
    // Hard verse then cold hook
    ['[Verse 1]','[Verse 2]','[Hook]','[Outro]'],
    // Tape track format: short and cold
    ['[Intro]','[Verse 1]','[Hook]','[Outro]'],
    // Feature format: two voices, shared hook
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Bridge]','[Hook]'],
    // Full movie phonk: cinematic structure
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Bridge]','[Hook]','[Outro]'],
    // Chopped screwed tape: looped hook ending
    ['[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Hook]'],
    // Underground short form
    ['[Verse 1]','[Hook]','[Outro]'],
  ],
  adlibs: ['(skrt)','(yeah)','(aye)','(hmm)','(slatt)','(gang)'],
  subjects: [
    'I','the dark','this night','my mind','the void','this silence',
    'my demons','the cold','this emptiness','the static','my ghost',
    'the shadows','this weight','the grey','my soul','the fog',
    'this numbness','the echo','my chest','the drain','this drift',
    'the underground','my name','the frequency','this feeling','the code',
    'my circle','the hunger','this grind','the pressure','my legacy',
    'the trap','this drive','the loyalty','my craft','the dark side',
    'this sound','the deep','my focus','the underground network','everything',
  ],
  verbPhrases: [
    'moves through the dark like it was born in the dark and it was',
    'drifts through the night at the frequency that only the awake can hear',
    'runs the underground with the ones who were never meant to surface',
    'keeps it cold because warmth was never part of the original contract',
    'slides through every system designed to contain the uncontainable',
    'hits different at 3am when the regular world has stopped pretending',
    'holds the void open long enough for the truth to climb out of it',
    'stays underground because the surface was never built for this',
    'builds in the dark because the light was occupied by the wrong things',
    'drives through the night with nothing on the mind but the destination',
    'operates in the frequencies they said contained no useful information',
    'keeps the circle tight because loose is how the wrong energy gets in',
    'moves at the tempo that the late hour specifically demands and rewards',
    'trusts nobody with the vision until the vision is too far along to steal',
    'makes the sound that the daylight hours were never quiet enough to produce',
    'drifts through the city at the hour when the city belongs to the honest',
    'understands the dark in ways that the comfortable never had to understand',
    'builds the empire from the basement because the penthouse was already occupied',
    'stays loyal to the craft through every season that made loyalty expensive',
    'rides the 808 down into the low frequency where the real conversations live',
    'keeps the energy consistent whether the room has one person or a million',
    'works through the night because the night offers the clearest visibility',
    'navigates the underground with the confidence of someone who built the map',
    'does not need the validation that the surface world offers as its main currency',
    'makes the track that finds the people in their 3am and confirms the feeling',
    'holds the dark with the ease of someone who has made peace with its dimensions',
    'converts the isolation into the raw material that the music is built from',
    'moves with precision through the system that was designed for someone else',
    'keeps the fire lit in the underground where the real heat was always generated',
    'creates the world that the mainstream cannot enter without losing what it is',
    'rides the dark wave all the way to the bottom where the real ones live',
    'makes the cold feel like home because the cold was always home anyway',
    'lives in the frequency between what is said and what is actually meant',
    'builds from isolation because isolation removes everything non-essential',
    'cuts through the noise by being quieter and more precise than the noise',
    'finds the pocket in the late hour that the daytime songs cannot locate',
    'owns the 3am the way only the ones who built in it can own it',
    'moves through the system like smoke — present and untouchable simultaneously',
    'carries the weight of everything unprocessed into the bass and lets it speak',
    'drops the temperature in every room by simply entering with full intention',
    'sees through the performance that the daylight world requires as admission',
    'thrives in the space they said contained nothing valuable or interesting',
    'makes peace with the dark and then makes the dark into something habitable',
    'speaks at the frequency that requires silence around it to be fully received',
    'runs the underground circuit like someone who installed the wiring personally',
    'stays locked in because locked in is the only posture that produces results',
    'turns the sleepless hours into the raw material that daylight cannot access',
    'holds the line in the cold with the steadiness of someone immune to temperature',
    'hunts the right sound with the patience of someone who has nowhere to be',
    'channels the ghost of every Memphis rap tape into something current and cold',
    'sits in the dark long enough that the dark starts to reveal its actual contents',
    'grinds through the invisible hours that the highlight reel will never include',
    'converts the void into a studio and the studio into a monument to the void',
    'drifts with intention — not lost — moving toward something only visible up close',
    'seals the circle because the outside never understood what was being built inside',
    'works the low end until the low end confesses everything it has been holding',
    'navigates the underground by the light that only the underground generates',
    'makes music for the hour not the algorithm — and the hour remembers everything',
  ],
  images: [
    'at 3am when the city belongs to the honest and the restless',
    'in the drift through the empty streets at the hour past explanation',
    'through the headphones at the volume that bypasses the conscious mind',
    'when the 808 drops below language into the frequency the body reads first',
    'in the studio after midnight when the session finally gets honest',
    'through the dark with the windows down and nowhere specific to arrive',
    'in the underground where the real music has always been generated',
    'when the slowed tape creates the atmosphere that the real hour required',
    'at the crossroads of the dark and the music that makes sense there',
    'through the void that is not empty but full of the wrong kind of light',
    'in the track that found you at the specific hour it was built for',
    'when the night gets long enough that the guard comes down and truth arrives',
    'through every empty room that the music filled with something necessary',
    'at the session where nothing was planned and everything came out honest',
    'in the sample that contains a ghost of something older and unresolved',
    'when the phonk drop shifts the atmosphere like a weather system',
    'through the late drive that became the song that became the record',
    'in the cold of the basement where the best and truest things were made',
    'at the crossroads of isolation and art where the phonk always originated',
    'when the reverb trails off and the silence is the next note in the sequence',
    'at the crossroads where the trap beat slowed into something more honest',
    'in the car at 4am with the bass eating every other frequency alive',
    'through the Memphis sample that contains a ghost nobody invited',
    'when the slowed vocals arrive like a warning from a previous version',
    'in the cold basement where the best phonk was always being assembled',
    'at the session where the engineer left and the real work started',
    'through the late drift when the city reveals what it hides in daylight',
    'in the dark tunnel of the beat before the drop that changes the mood',
    'when the hi-hat stutters and the whole track holds its breath briefly',
    'in the era before the algorithm decided what the underground was allowed to be',
    'at the low end of the frequency where most speakers cannot follow',
    'through the 808 that says what the verse was too careful to say directly',
    'when the pitch drops and the temperature in the track drops with it',
    'in the catalogue that only the ones who were awake at the right hour found',
    'at the exact moment the slowed reverb turns nostalgia into something colder',
    'through the track list that reads like a map of every late-night decision',
    'in the phonk era before it had a name and when it had the most to say',
    'when the sample loop catches something haunted and decides to stay with it',
    'at the boundary between the dark trap and the deeper dark beneath it',
    'through the cold open of the track before the bass announces its intentions',
    'in the late hour when the only honest conversations are with the music',
    'when the distorted vocal arrives and the whole mix leans into the ghost',
    'at the session that ran until dawn and produced the coldest five tracks',
    'in the underground archive that the algorithm has never been able to locate',
  ],
  modifiers: [
    'cold and calculated the way the night teaches when you listen correctly',
    'deep in the underground where the real ones have always been operating',
    'slowed and reverbed — the way the feeling actually sounds at the correct hour',
    'without the daylight version of myself getting in the way of the honest thing',
    'in the dark which is not the absence of light but the presence of something else',
    'low and heavy in the frequency where the body understands before the mind',
    'permanently — the underground does not forget what was built here honestly',
    'authentic — not performing authentic — actually authentic and that is different',
    'at the correct tempo which is slow enough to mean every single note',
    'in the tradition of every ghost that made music from what the living discarded',
    'raw — before the polish — in the state where the truth has not been softened',
    'after midnight — which is when this genre was always built to operate',
    'with the weight of the dark — which is heavy and useful and entirely honest',
    'underground — where the echo carries further than it does in the open air',
    'precisely — the way late-night decisions are always more precise than daytime ones',
    'through the static — which is not noise but information at a different frequency',
    'without performance — just the thing itself — in the room — real and present',
    'in the phonk tradition — which is to take the haunted and make it habitable',
    'at the level that requires silence around it to be fully received',
    'completely — the darkness does not do anything halfway when it finally commits',
  ],
  hookFragments: [
    'they sleep while we move — that is the advantage that the dark provides',
    'underground forever — the surface was never built for what we are making',
    'I drift through the night and the night does not ask for an explanation',
    'cold and calculated — that is the temperature this operates best at',
    'the phonk hits different at the hour it was specifically built for',
    'I built this in the dark and the dark made it honest — that is the process',
    'keep the circle tight because the vision requires protection from the wrong energy',
    'the 808 says what the words cannot carry — that is why the 808 leads here',
    'I move in silence and let the work announce itself at the correct volume',
    'the underground is not a place — it is a commitment to a different frequency',
    'slowed down — the way the real things sound when you give them the space to',
    'I was built in the cold — which means the cold cannot do anything new to me',
    'the drift is the direction — not away from something but toward the honest thing',
    'in the dark the sound carries differently — ask anyone who has been awake in it',
    'they tried to find us and could not — we built the maze and we know every turn',
  ],
  bridgeLines: [
    'The dark was not the enemy — the dark was the only honest available workspace',
    'Everything I built came from the hours that the comfortable world was sleeping through',
    'The underground does not market itself — it finds the ones who needed it specifically',
    'I learned more from the late nights than from every daytime instruction combined',
    'The phonk tradition is the ghost tradition — haunt until the haunting becomes the home',
    'Some sounds only exist at 3am and only make sense to the people who are awake then',
    'The cold made me precise and the dark made me honest — that is the whole curriculum',
    'I do not make music for everyone — I make music for the ones who understand it already',
    'The drift is not directionless — it is the most specific direction available',
    'We built the underground because the surface was built by someone else for someone else',
  ],
  outroLines: [
    'The track ends and the 3am continues — that is the correct relationship between them',
    'Underground forever — the surface was never the destination anyway',
    'The dark carries this further than the light ever would have — that is the whole point',
    'Drift on — the night is long and the frequency is yours if you keep the dial honest',
    'The phonk finds who it needs to find — it does not need help with that part',
    'Cold and honest — which is the only temperature at which the truth stays preserved',
  ],
  titles: [
    'Dark Drift','The Underground','Cold Sessions','After Midnight','The Void',
    'Phonk Hours','Deep Dark','The Frequency','3AM','Underground Forever',
    'The Ghost','Cold and Calculated','Dark Energy','The Basement','Night Drive',
    'Static','The Depth','Dark Architecture','Slowed','The Echo',
    'Underground Network','The Late Hour','Dark Matter','Drift','The Cold',
    'Honest Dark','The Signal Below','Night Moves','Deep Phonk','The Real Hours',
    'Cold Truth','The Underground Map','Dark Sessions','Haunted','The Drift',
    'Low Frequency','The Dark Side','After Hours Underground','The Process','Cold Fire',
    'Underground Legacy','Dark Craft','The Real Underground','Night Frequency','Isolated',
    'Deep and Cold','The Ghost Track','Phonk Forever','Dark Standard','The Foundation',
    'Underground Royalty','Cold Logic','The Night Belongs','Deep Dark Energy','After 3',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRE DATA — UK DRILL / GRIME
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRE_DRILL = {
  keywords: ['drill','uk drill','grime','chicago drill','dark minor','sliding bass','sliding 808','chicago drill','ny drill','melodic drill','central cee','pop smoke','drill music','russ millions','digga d','headie one','skepta','stormzy','dave uk','little simz','ghetts','kano','giggs','melodic rap uk','uk hip hop','road rap','afroswing drill'],
  cadenceTarget: [8,14],
  rhymeStyle: 'end',
  rhymeSchemes: ['AAAA','AABB','ABAB'],
  sectionTags: ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Outro]'],
  structures: [
    // UK drill: verse-chorus-verse (Headie One / Digga D style)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Outro]'],
    // Intro flex then deep verse (Chicago drill: Polo G / Lil Durk)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Outro]'],
    // Double verse storytelling (Central Cee / Dave concept)
    ['[Verse 1]','[Verse 2]','[Chorus]','[Bridge]','[Chorus]'],
    // Short bridge, direct outro (fast-pace drill format)
    ['[Intro]','[Verse 1]','[Chorus]','[Bridge]','[Chorus]','[Outro]'],
    // Verse-heavy: three verses, late chorus
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Verse 3]','[Outro]'],
    // Chorus-first hook (radio drill: Popcaan / Krept & Konan)
    ['[Chorus]','[Verse 1]','[Chorus]','[Verse 2]','[Bridge]','[Chorus]'],
    // Short single: two verses, hook (streaming format)
    ['[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Outro]'],
    // Pre-hook tension (melodic drill: Rod Wave / Lil Baby)
    ['[Intro]','[Verse 1]','[Pre-Hook]','[Hook]','[Verse 2]','[Hook]','[Bridge]','[Outro]'],
    // Long verse storytelling (Digga D / Youngs Teflon narrative)
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Outro]'],
    // Interlude format (drill tape structure: 808 Melo / Bandokay)
    ['[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Interlude]','[Outro]'],
    // Freestyle energy: hook bookends verses
    ['[Hook]','[Verse 1]','[Verse 2]','[Hook]','[Bridge]','[Hook]'],
    // Cinematic drill: slow intro then hard verse (ArrDee / Fredo)
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Verse 3]','[Outro]'],
    // Collab format: two voices alternate verses
    ['[Intro]','[Verse 1]','[Chorus]','[Verse 2]','[Chorus]','[Bridge]','[Final Chorus]'],
    // High pressure: no intro, immediate verse
    ['[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Bridge]','[Hook]'],
    // Slow burn: late hook reveal
    ['[Verse 1]','[Verse 2]','[Verse 3]','[Hook]','[Outro]'],
    // Minimal: pure verse delivery
    ['[Intro]','[Verse 1]','[Verse 2]','[Outro]'],
    // Trap drill crossover (American meets UK drill)
    ['[Intro]','[Hook]','[Verse 1]','[Hook]','[Verse 2]','[Bridge]','[Hook]'],
    // Dark ambient intro into drill verse
    ['[Intro]','[Verse 1]','[Hook]','[Verse 2]','[Hook]','[Ad-lib Outro]'],
  ],
  adlibs: ['(woo)','(on sight)','(real talk)','(say less)','(calm)','(no cap)','(facts)','(still)'],
  subjects: [
    'I','my ting','the ends','road men','my circle','this lifestyle',
    'the block','my peng ting','the racks','opps','my mandem','the code',
    'the trap','my girl','real ones','the grind','my bros','this money',
    'the struggle','my music','loyal ones','the streets','my bars','this energy',
    'the road','my craft','day ones','the culture','my sound','this movement',
    'the youngers','my flow','the elders','the lane','my name','the come up',
    'this level','my city','the work','the vibe','my estate','the mission',
    'the journey','my verse','true ones','the proof','my whole team','this chapter',
  ],
  verbPhrases: [
    // SHORT FORM — 2-5 syllables
    'came up','kept it','moved different','stayed solid',
    'built this','held the code','stacks up','runs it',
    'stays sharp','won\'t fold','drills on','locks in',
    'says less','hits different','stays cold',
    'came up from the ends where opportunity was never part of the plan',
    'kept it real on the block when keeping it real cost the most',
    'moved different from day one and the difference was always the point',
    'built the team from the ground up with no backing and no blueprint',
    'stayed loyal when loyalty was tested by everything the road could throw',
    'earned every number in every account through work nobody witnessed',
    'held the code firm when the code made the comfortable path impossible',
    'moved up levels that the system was specifically not designed to provide',
    'stays consistent at every level which is rarer than talent in this game',
    'runs the road with the same energy regardless of who is watching',
    'switched the narrative on everyone who wrote the story before the chapter',
    'brought the ends to every room that the ends was never meant to enter',
    'stacks before it speaks because the receipts are the only credible currency',
    'built the wave from nothing but the studio and the stubborn intention',
    'stays sharp because the road taught that blunt tools do not survive long',
    'moves with purpose while the wasted ones move with only speed',
    'came from the pavement and made the pavement a launching platform',
    'rides for the team in every room at every level at every hour',
    'kept the vision clean when everything around it was being compromised',
    'elevates the culture by refusing the floor they built as the ceiling',
    'navigated every obstacle the system placed on the road to here',
    'built a lane when every existing lane was occupied and hostile',
    'kept going through every season that was designed to produce giving up',
    'turned every door that closed into a wall that became a foundation instead',
    'made the music that the estate needed when nothing else was speaking truthfully',
    'holds the level even when the level gets tested by circumstances',
    'represents the area in every room the area was never built for',
    'stays humble at the top because the road to the top taught humility',
    'moves chess not checkers through everything that tried to be the obstacle',
    'trusts the team before trusting any external validation the industry offers',
    'holds the postcode with more pride than any trophy the industry hands out',
    'flipped the script on every narrative written before the chapter was finished',
    'takes the estate from backdrop to centerpiece in every bar that gets written',
    'moves at a tempo that the competition cannot read until it is already past them',
    'built the sound from what was available which was not much but was enough',
    'runs the marathon at sprint pace because nothing about this was designed to be slow',
    'keeps every promise made on the road before the music made the road larger',
    'understands the assignment at every level and executes without needing reminding',
    'protects the team with the same energy the team protected the vision first',
    'makes the drill music that the area needed to hear itself described honestly',
    'navigates the industry with the same intelligence applied to navigating the road',
    'stays true to the sound even as the sound evolves past the origin',
    'brings the mandem into every room that would prefer they were not present',
    'converts every doubt into the specific type of fuel the engine requires',
    'delivers on every expectation while building expectations nobody had anticipated',
    'holds the standard at the level the early days made as a permanent commitment',
    'wins in ways that cannot be explained by luck which removes luck from the conversation',
    'takes up space in every room as the earned right of the come up',
    'speaks for the ones who are still in the place the music described getting out of',
    'builds the legacy while building the next step which requires total simultaneity',
    'connects the estate to the global through the specific detail that is universal',
    'stays sharp on every level because the road taught that sharp is the only option',
    'locks in when others drift because locked in is the differential that matters',
    'makes the hard thing look inevitable which is the definition of mastery',
    'represents the culture with every performance at every level in every room',
    'rises above the noise by being more specific and more honest than the noise',
    'earns the respect of the road and the industry which are different currencies',
    'carries the whole area forward by refusing to leave it behind in the success',
    'turns the daily grind into the type of art that the grind itself cannot produce',
  ],
  images: [
    'in the ends where the first bars were written and the hunger first formed',
    'on road at the hour when the block reveals what it is actually about',
    'through the come up that looked like nothing from the outside and was everything',
    'when the racks finally started reflecting the work that preceded them honestly',
    'in the studio after a long road day when the bars finally get fully honest',
    'at the estate with the mandem before the music changed the whole trajectory',
    'through every level of the come up that taught something the comfort cannot',
    'when the single dropped and the ends heard itself described back accurately',
    'in the booth before the engineer arrived — that is when the real bars happen',
    'on the drive through the area with the first check from the music covering it',
    'at the show where the city came out and the crowd confirmed the whole effort',
    'through the years of grafting that the overnight success narrative always edits out',
    'in every conversation with the mandem about where this is actually going',
    'when the feature call came and the whole team understood the level had changed',
    'through the industry noise — staying clear and keeping the direction straight',
    'at the point where the road knowledge became the creative advantage',
    'in the verse that described the postcode in a way that only the resident could verify',
    'when the streaming confirmed that the music had found every city it was built for',
    'through the challenges that tested whether the foundation was actually solid',
    'at the level that the early days were always pointing toward but could not confirm',
    'in the estate block that the music transformed from backdrop to protagonist',
    'when the crowd sang back the bars that came from the most honest place available',
    'through every meeting with the label where the street knowledge was the leverage',
    'at the session where the drill beat dropped and the lyrics arrived immediately',
    'in the first video that confirmed the whole vision was visible to more than the team',
    'through every grind day that the highlight reel will always and only partially show',
    'at the moment the road skills became the life skills that no school ever offered',
    'in the single that documented the reality while the industry preferred the palatable version',
    'when the ends that raised the artist heard itself in the bars and felt seen',
    'through the whole journey from the block to the stage — every step documented',
    'at the estate where the music started and to which the music keeps returning',
    'in the verse that the postcode will cite as evidence for the next generation',
    'when the feature landed and the collaboration confirmed the level is real',
    'through the UK circuit from the ends to the arena in one continuous line',
    'at the meeting where the street knowledge was more valuable than any CV',
    'in the freestyle that the world heard and the label heard and the trajectory changed',
    'when the drill beat dropped and every bar arrived already knowing where to go',
    'through the come up that required more character than talent to survive',
    'at the show where the mandem held the barrier and the city held the stage',
    'in the bar that described the estate so precisely the estate became a character',
    'when the streaming numbers confirmed what the road already knew two years ago',
    'through every police harassment that became a verse that became a movement',
    'at the industry meeting where the road man outthought every room he entered',
    'in the EP that introduced the sound before the sound had been named or claimed',
    'when the label came calling and the terms were set by the one who held the leverage',
  ],
  modifiers: [
    'say less — which means the work speaks and the mouth steps back respectfully',
    'still — regardless of the level — still the same energy and the same code',
    'on sight — because the opportunity was prepared for long before it arrived',
    'real talk — not the version for the interview — the version from the road',
    'no cap — every bar is documented truth — not a single syllable of performance',
    'facts on facts — the receipt is available for every claim made in the verse',
    'calm — which in this context means confident beyond the need for visible emotion',
    'different from the rest — which is the whole competitive advantage right there',
    'from the ends — which is the credential that nothing the industry offers replaces',
    'straight up — no filter between the reality and the description of it',
    'on code — which means the values hold regardless of what the holding costs',
    'consistent — the most underappreciated quality in every arena this touches',
    'level by level — which is the only way to build something that actually holds',
    'road tested — which means proven under conditions more demanding than the studio',
    'already — which means the destination was confirmed before the journey was visible',
    'properly — in the way that the road taught and that only the road can teach',
    'authentic — not performing — genuinely and verifiably and permanently authentic',
    'big — in the way that requires the receipts and then presents the receipts',
    'for real — the version that is still the same when the cameras are not present',
    'mandem approved — which is the only endorsement that this culture actually requires',
  ],
  hookFragments: [
    'came from nothing and built something — that is the whole drill story',
    'the ends raised me and the ends is in every bar I ever wrote',
    'my mandem know what it is — we do not explain it to the outside',
    'stayed loyal when loyalty was the expensive choice and I chose it anyway',
    'road knowledge was always the education that the school could not provide',
    'we moved different and the difference is now visible in the results',
    'the come up was slow and real — not the fast version that does not hold',
    'built this from the block up with nothing but the will and the mandem',
    'every bar is documented — the receipts are available — ask me anything',
    'we are from the ends and the ends is the credential that opens every door',
    'the level changed but the values did not — that is the whole character test',
    'I kept going when the road was specifically designed to produce stopping',
    'this is for the ones on the block who need to see the come up is real',
    'the bars speak for themselves — which is why the mandem lets them',
    'we did not get handed anything — every door required the knock and the wait',
    'the drill is the documentation — every lyric is the primary source material',
    'my name means something in the ends — that is where all worth originates',
    'we move with purpose — the aimless ones are not the ones you hear about',
    'the whole team ate — that is the metric I actually care about from the come up',
    'road to riches — and by riches I mean the freedom to do exactly this',
  ],
  bridgeLines: [
    'The ends made me everything I am and everything I am returns the respect',
    'The come up was the education — the success is just the graduation ceremony',
    'My team built this together and every achievement belongs to everyone who stayed',
    'The road knowledge is the MBA — you can not buy the curriculum that taught this',
    'I represent the postcode in every room the postcode was never invited into',
    'The bars are the documentation of a life that deserves to be accurately recorded',
    'We did not get shortcuts — we got the full route and the full route made us better',
    'The level we are at required everyone who held the code through every season',
    'I make the music the estate needed when nothing else was speaking the truth of it',
    'This is the come up documented in real time — every bar is the primary record',
  ],
  outroLines: [
    'The ends raised this and the ends is in every note of it — that is the whole origin',
    'We built something real here — built it proper — and it will hold',
    'The mandem already know — this one is for everyone who was there from the beginning',
    'From the block to whatever comes next — the code stays the same the whole way through',
    'The work was always going to be the answer — we just had to trust that long enough',
    'Say less — the music speaks — that was always the whole arrangement',
  ],
  titles: [
    'From the Ends','Road Knowledge','The Come Up','On Code','Mandem',
    'Still','Level Up','The Block','Real Talk','No Cap',
    'The Estate','Loyalty Test','Straight Up','The Lane','Built Different',
    'Road Certified','The Circuit','On Sight','The Credential','Consistent',
    'The Documentation','Calm Energy','The Receipt','Proper Built','Day Ones',
    'The Postcode','Say Less','The Real Version','Road to Here','The Grind',
    'Facts','The Level','From Nothing','The Bars','Road Raised',
    'The Mandem Story','On Everything','Built From the Block','The Journey','Real Ones',
    'The Drill','Road Knowledge Degree','Already','The Come Up Story','No Shortcuts',
    'From the Estate','The Values','Road Education','The Standard','Say No More',
    'The Whole Team','Road Certified Platinum','The Ends Story','Properly','The Origin',
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GENRES REGISTRY — all genres assembled
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GENRES = {
  hiphop:     GENRE_HIPHOP,
  pop:        GENRE_POP,
  rnb:        GENRE_RNB,
  country:    GENRE_COUNTRY,
  rock:       GENRE_ROCK,
  electronic: GENRE_ELECTRONIC,
  indie:      GENRE_INDIE,
  latin:      GENRE_LATIN,
  kpop:       GENRE_KPOP,
  gospel:     GENRE_GOSPEL,
  jazz:       GENRE_JAZZ,
  metal:      GENRE_METAL,
  reggae:     GENRE_REGGAE,
  folk:       GENRE_FOLK,
  punk:       GENRE_PUNK,
  phonk:      GENRE_PHONK,
  drill:      GENRE_DRILL,
  default:    GENRE_POP,
};
