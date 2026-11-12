import CryptoJS from 'crypto-js';

const RELAY_URL = '';

const OBF_K1 = '545f41dcf0c919e746d1d35e71e61ef4866efb4861b26ff479eab44f17978ff3';
const OBF_K2 = 'bcfcdd8b1392efc351b6c012d2950aa37c50b082cfd70efb6ba164b604056927';
const OBF_IV = '96b00361cc51b8d3f12257b7f5a3cc18';
const OBF_TPL = 'OUBvKHIToS5cd0mKlhUOTo/1ys/T/mRmhLlCiMLK0W0vxGgt0CgD0Bs0geDDAFXv6b0pfHBCbLjM6AFPNBqkGA==';

const TPT_K1 = '1d5b7e3954557524bbf7311d8fd6f63b945c3775b844018de1b0262ab49df7af';
const TPT_K2 = 'f91a747c011792725f7d62641af27b1491dd23906690cec834dc94b2a5471308';

const rs = (length: number) =>
  Array.from({length}, () => Math.random().toString(36)[2]).join('');

function xorHex(h1: string, h2: string): CryptoJS.lib.WordArray {
  const a = CryptoJS.enc.Hex.parse(h1);
  const b = CryptoJS.enc.Hex.parse(h2);
  const words = a.words.map((w, i) => w ^ (b.words[i] ?? 0));
  return CryptoJS.lib.WordArray.create(words, a.sigBytes);
}

function decryptConstant(b64: string): string {
  return CryptoJS.AES.decrypt(b64, xorHex(OBF_K1, OBF_K2), {
    iv: CryptoJS.enc.Hex.parse(OBF_IV),
    padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Utf8);
}

function buildTargetUrl(packageName: string): string {
  const tpl = decryptConstant(OBF_TPL);
  return tpl
    .replaceAll('{n}', rs(12))
    .replace('{pkg}', packageName)
    .replace('{n}', rs(8));
}

function transportEncrypt(json: string): string {
  const key = xorHex(TPT_K1, TPT_K2);
  const iv = CryptoJS.lib.WordArray.random(16);
  const ct = CryptoJS.AES.encrypt(json, key, {
    iv,
    padding: CryptoJS.pad.Pkcs7,
  }).ciphertext;
  return CryptoJS.enc.Base64.stringify(iv.clone().concat(ct));
}

function transportDecrypt(b64: string): string {
  const key = xorHex(TPT_K1, TPT_K2);
  const wa = CryptoJS.enc.Base64.parse(b64);
  const iv = CryptoJS.lib.WordArray.create(wa.words.slice(0, 4), 16);
  const ct = CryptoJS.lib.WordArray.create(wa.words.slice(4), wa.sigBytes - 16);
  return CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ciphertext: ct}),
    key,
    {iv, padding: CryptoJS.pad.Pkcs7},
  ).toString(CryptoJS.enc.Utf8);
}

export type ConfigRequest = {
  packageName: string;
  androidId: string;
  gpsAdid: string;
  referrer: string;
  userAgent: string;
  timezone: string;
  language: string;
  region: string;
  simCountryIso: string;
  country: string;
};

export async function fetchConfig(req: ConfigRequest): Promise<any | null> {
  try {
    return RELAY_URL ? await fetchViaRelay(req) : await fetchDirect(req);
  } catch {
    return null;
  }
}

async function fetchDirect(req: ConfigRequest): Promise<any | null> {
  const resp = await fetch(buildTargetUrl(req.packageName), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': req.userAgent,
    },
    body: JSON.stringify({
      android_id: req.androidId,
      gps_adid: req.gpsAdid,
      install_referrer: req.referrer,
      timezone: req.timezone,
      language: req.language,
      region: req.region,
      sim_country_iso: req.simCountryIso,
      country: req.country,
    }),
  });
  if (!resp.ok) {
    return null;
  }
  return await resp.json();
}

async function fetchViaRelay(req: ConfigRequest): Promise<any | null> {
  const resp = await fetch(RELAY_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      d: transportEncrypt(
        JSON.stringify({
          p: req.packageName,
          a: req.androidId,
          g: req.gpsAdid,
          r: req.referrer,
          u: req.userAgent,
          tz: req.timezone,
          lg: req.language,
          rg: req.region,
          sci: req.simCountryIso,
          cy: req.country,
          t: Date.now(),
        }),
      ),
    }),
  });
  if (!resp.ok) {
    return null;
  }
  const json = await resp.json();
  return JSON.parse(transportDecrypt(json.d));
}
