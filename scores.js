const crypto = require('crypto');

// World ranking for Mood Arcade. Scores live in a Vercel Blob store, one tiny file per score.
// The file name carries everything we need (inverted score, time, country, name, level),
// so the list can be read without opening any file.

const COUNTRY_DATA = 'AF:Afghanistan|AL:Albania|DZ:Algeria|AS:American Samoa|AD:Andorra|AO:Angola|AI:Anguilla|AQ:Antarctica|AG:Antigua and Barbuda|AR:Argentina|AM:Armenia|AW:Aruba|AU:Australia|AT:Austria|AZ:Azerbaijan|BS:Bahamas|BH:Bahrain|BD:Bangladesh|BB:Barbados|BY:Belarus|BE:Belgium|BZ:Belize|BJ:Benin|BM:Bermuda|BT:Bhutan|BO:Bolivia|BA:Bosnia and Herzegovina|BW:Botswana|BV:Bouvet Island|BR:Brazil|IO:British Indian Ocean Territory|VG:British Virgin Islands|BN:Brunei|BG:Bulgaria|BF:Burkina Faso|BI:Burundi|KH:Cambodia|CM:Cameroon|CA:Canada|CV:Cape Verde|BQ:Caribbean Netherlands|KY:Cayman Islands|CF:Central African Republic|TD:Chad|CL:Chile|CN:China|CX:Christmas Island|CC:Cocos (Keeling) Islands|CO:Colombia|KM:Comoros|CG:Congo|CK:Cook Islands|CR:Costa Rica|HR:Croatia|CU:Cuba|CW:Curaçao|CY:Cyprus|CZ:Czechia|CI:Côte d\'Ivoire|DK:Denmark|DJ:Djibouti|DM:Dominica|DO:Dominican Republic|CD:DR Congo|EC:Ecuador|EG:Egypt|SV:El Salvador|GQ:Equatorial Guinea|ER:Eritrea|EE:Estonia|SZ:Eswatini|ET:Ethiopia|FK:Falkland Islands|FO:Faroe Islands|FJ:Fiji|FI:Finland|FR:France|GF:French Guiana|PF:French Polynesia|TF:French Southern Territories|GA:Gabon|GM:Gambia|GE:Georgia|DE:Germany|GH:Ghana|GI:Gibraltar|GR:Greece|GL:Greenland|GD:Grenada|GP:Guadeloupe|GU:Guam|GT:Guatemala|GG:Guernsey|GN:Guinea|GW:Guinea-Bissau|GY:Guyana|HT:Haiti|HM:Heard Island and McDonald Islands|HN:Honduras|HK:Hong Kong|HU:Hungary|IS:Iceland|IN:India|ID:Indonesia|IR:Iran|IQ:Iraq|IE:Ireland|IM:Isle of Man|IL:Israel|IT:Italy|JM:Jamaica|JP:Japan|JE:Jersey|JO:Jordan|KZ:Kazakhstan|KE:Kenya|KI:Kiribati|KW:Kuwait|KG:Kyrgyzstan|LA:Laos|LV:Latvia|LB:Lebanon|LS:Lesotho|LR:Liberia|LY:Libya|LI:Liechtenstein|LT:Lithuania|LU:Luxembourg|MO:Macau|MG:Madagascar|MW:Malawi|MY:Malaysia|MV:Maldives|ML:Mali|MT:Malta|MH:Marshall Islands|MQ:Martinique|MR:Mauritania|MU:Mauritius|YT:Mayotte|MX:Mexico|FM:Micronesia|MD:Moldova|MC:Monaco|MN:Mongolia|ME:Montenegro|MS:Montserrat|MA:Morocco|MZ:Mozambique|MM:Myanmar|NA:Namibia|NR:Nauru|NP:Nepal|NL:Netherlands|NC:New Caledonia|NZ:New Zealand|NI:Nicaragua|NE:Niger|NG:Nigeria|NU:Niue|NF:Norfolk Island|KP:North Korea|MK:North Macedonia|MP:Northern Mariana Islands|NO:Norway|OM:Oman|PK:Pakistan|PW:Palau|PS:Palestine|PA:Panama|PG:Papua New Guinea|PY:Paraguay|PE:Peru|PH:Philippines|PN:Pitcairn|PL:Poland|PT:Portugal|PR:Puerto Rico|QA:Qatar|RO:Romania|RU:Russia|RW:Rwanda|RE:Réunion|BL:Saint Barthélemy|SH:Saint Helena|KN:Saint Kitts and Nevis|LC:Saint Lucia|MF:Saint Martin (French part)|PM:Saint Pierre and Miquelon|VC:Saint Vincent and the Grenadines|WS:Samoa|SM:San Marino|ST:Sao Tome and Principe|SA:Saudi Arabia|SN:Senegal|RS:Serbia|SC:Seychelles|SL:Sierra Leone|SG:Singapore|SX:Sint Maarten (Dutch part)|SK:Slovakia|SI:Slovenia|SB:Solomon Islands|SO:Somalia|ZA:South Africa|GS:South Georgia and the South Sandwich Islands|KR:South Korea|SS:South Sudan|ES:Spain|LK:Sri Lanka|SD:Sudan|SR:Suriname|SJ:Svalbard and Jan Mayen|SE:Sweden|CH:Switzerland|SY:Syria|TW:Taiwan|TJ:Tajikistan|TZ:Tanzania|TH:Thailand|TL:Timor-Leste|TG:Togo|TK:Tokelau|TO:Tonga|TT:Trinidad and Tobago|TN:Tunisia|TR:Turkey|TM:Turkmenistan|TC:Turks and Caicos Islands|TV:Tuvalu|UG:Uganda|UA:Ukraine|AE:United Arab Emirates|GB:United Kingdom|US:United States|UM:United States Minor Outlying Islands|UY:Uruguay|VI:US Virgin Islands|UZ:Uzbekistan|VU:Vanuatu|VA:Vatican City|VE:Venezuela|VN:Vietnam|WF:Wallis and Futuna|EH:Western Sahara|YE:Yemen|ZM:Zambia|ZW:Zimbabwe|AX:Åland Islands';
const COUNTRIES = new Set(COUNTRY_DATA.split('|').map((c) => c.split(':')[0]));

const MAX_KEEP = 100;               // scores stored
const SHOW = 20;                    // scores returned to the game
const MIN_SECONDS_PER_LEVEL = 2.5;  // faster than this is not humanly possible
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

const BAD_SUBSTRINGS = ['fuck', 'shit', 'cunt', 'nigg', 'fagg', 'hitler', 'nazi', 'mierda', 'whore', 'bitch', 'porn', 'cabron', 'pendejo', 'maricon', 'hijueputa', 'hdp'];
const BAD_TOKENS = ['puta', 'puto', 'verga', 'pija', 'concha', 'culo', 'dick', 'cock', 'sex', 'rape', 'kkk', 'cum', 'ass', 'tits', 'pene'];

let blobImpl = null;
async function blobLib() {
  if (!blobImpl) blobImpl = await import('@vercel/blob');
  return blobImpl;
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}
function makeToken(secret) {
  const p = Buffer.from(JSON.stringify({ t: Date.now(), n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
  return p + '.' + sign(p, secret);
}
function readToken(tok, secret) {
  if (typeof tok !== 'string') return null;
  const parts = tok.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const want = Buffer.from(sign(parts[0], secret));
  const got = Buffer.from(parts[1]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const d = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (!d || typeof d.t !== 'number' || typeof d.n !== 'string' || !/^[a-f0-9]{16}$/.test(d.n)) return null;
    return d;
  } catch (e) {
    return null;
  }
}

function cleanName(raw) {
  return String(raw == null ? '' : raw)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
}
function isBad(name) {
  const leet = name.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't');
  const squashed = leet.replace(/ /g, '');
  if (BAD_SUBSTRINGS.some((w) => squashed.includes(w))) return true;
  return leet.split(' ').some((t) => BAD_TOKENS.includes(t));
}

// Highest score reachable after clearing N levels, mirroring the game's scoring.
function maxScore(cleared) {
  let sum = 0;
  for (let i = 0; i < cleared; i++) sum += (100 + 380) * (1 + Math.floor(i / 2)) + 100;
  return sum + 100;
}

function parsePath(pathname) {
  const m = /^scores\/(\d{7})_(\d+)_([A-Z]{2})_([A-Za-z0-9-]*)_(\d+)\.json$/.exec(pathname);
  if (!m) return null;
  return { score: 9999999 - parseInt(m[1], 10), ts: Number(m[2]), cc: m[3], name: m[4].replace(/-/g, ' '), level: Number(m[5]) };
}
function toScores(pathnames) {
  return pathnames
    .slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(parsePath).filter(Boolean)
    .map((e, i) => ({ rank: i + 1, name: e.name, cc: e.cc, score: e.score, level: e.level }));
}

async function readAll() {
  const lib = await blobLib();
  let cursor;
  const out = [];
  for (let i = 0; i < 5; i++) {
    const r = await lib.list({ prefix: 'scores/', limit: 1000, cursor });
    out.push(...r.blobs);
    if (!r.hasMore) break;
    cursor = r.cursor;
  }
  return out;
}

function fail(res, code, error) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(code).json({ error });
}

async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const secret = process.env.BLOB_READ_WRITE_TOKEN;

    if (req.method === 'GET') {
      if (req.query && req.query.start) {
        res.setHeader('Cache-Control', 'no-store');
        if (!secret) return res.status(200).json({ enabled: false });
        const c = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
        return res.status(200).json({ enabled: true, token: makeToken(secret), country: COUNTRIES.has(c) ? c : '' });
      }
      res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60');
      if (!secret) return res.status(200).json({ enabled: false, scores: [] });
      const all = await readAll();
      return res.status(200).json({ enabled: true, scores: toScores(all.map((b) => b.pathname)).slice(0, SHOW) });
    }

    if (req.method === 'POST') {
      if (!secret) return fail(res, 503, 'offline');
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

      const tok = readToken(body.token, secret);
      if (!tok) return fail(res, 400, 'token');
      const age = Date.now() - tok.t;
      if (age < 0 || age > MAX_AGE_MS) return fail(res, 400, 'expired');

      const score = Number(body.score);
      const cleared = Number(body.cleared);
      if (!Number.isInteger(score) || !Number.isInteger(cleared) || score < 1 || cleared < 0 || cleared > 200) return fail(res, 400, 'score');
      if (score > maxScore(cleared)) return fail(res, 400, 'score');
      if (age / 1000 < cleared * MIN_SECONDS_PER_LEVEL + 1) return fail(res, 400, 'score');

      const cc = String(body.cc || '').toUpperCase();
      if (!COUNTRIES.has(cc)) return fail(res, 400, 'country');
      const name = cleanName(body.name);
      if (name.length < 2 || isBad(name)) return fail(res, 400, 'name');

      const lib = await blobLib();
      const used = await lib.list({ prefix: 'used/' + tok.n, limit: 1 });
      if (used.blobs.length) return fail(res, 409, 'used');

      const all = await readAll();
      const current = toScores(all.map((b) => b.pathname));
      const rank = 1 + current.filter((e) => e.score >= score).length;
      if (rank > MAX_KEEP) return fail(res, 400, 'low');

      await lib.put('used/' + tok.n, '1', { access: 'public', addRandomSuffix: false, contentType: 'text/plain' });
      const inv = String(9999999 - score).padStart(7, '0');
      const pathname = 'scores/' + inv + '_' + Date.now() + '_' + cc + '_' + name.replace(/ /g, '-') + '_' + (cleared + 1) + '.json';
      const put = await lib.put(pathname, JSON.stringify({ v: 1 }), { access: 'public', addRandomSuffix: false, contentType: 'application/json' });

      const combined = all.map((b) => ({ p: b.pathname, u: b.url })).concat([{ p: pathname, u: put.url }]).sort((a, b) => (a.p < b.p ? -1 : 1));
      if (combined.length > MAX_KEEP) await lib.del(combined.slice(MAX_KEEP).map((x) => x.u));

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, rank, scores: toScores(combined.map((x) => x.p)).slice(0, SHOW) });
    }

    res.setHeader('Allow', 'GET, POST');
    return fail(res, 405, 'method');
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'server');
  }
}

module.exports = handler;
module.exports.__setBlob = (m) => { blobImpl = m; };
module.exports.__internals = { cleanName, isBad, maxScore, parsePath };
