/**
 * Periodic table data used by the renderer and analysis code.
 *
 * Columns: symbol, Z, mass (u), covalent radius (Å, Cordero 2008), van der Waals
 * radius (Å, Bondi / Alvarez 2013), atomic radius (Å, VESTA table), Jmol colour,
 * VESTA colour ("-" = same as Jmol), English name.
 */
const TABLE = `
X 0 0 0.50 1.00 0.50 FF1493 FF1493 Dummy
H 1 1.008 0.31 1.20 0.46 FFFFFF FFCCCC Hydrogen
He 2 4.0026 0.28 1.40 1.22 D9FFFF FCE8CE Helium
Li 3 6.94 1.28 1.82 1.57 CC80FF 86E074 Lithium
Be 4 9.0122 0.96 1.53 1.12 C2FF00 5ED77B Beryllium
B 5 10.81 0.84 1.92 0.81 FFB5B5 1FA20F Boron
C 6 12.011 0.76 1.70 0.77 909090 814929 Carbon
N 7 14.007 0.71 1.55 0.74 3050F8 B0B9E6 Nitrogen
O 8 15.999 0.66 1.52 0.74 FF0D0D FE0300 Oxygen
F 9 18.998 0.57 1.47 0.72 90E050 B0B9E6 Fluorine
Ne 10 20.180 0.58 1.54 1.60 B3E3F5 FE37B5 Neon
Na 11 22.990 1.66 2.27 1.91 AB5CF2 F9DC3C Sodium
Mg 12 24.305 1.41 1.73 1.60 8AFF00 FB7B15 Magnesium
Al 13 26.982 1.21 1.84 1.43 BFA6A6 81B2D6 Aluminium
Si 14 28.085 1.11 2.10 1.18 F0C8A0 1B3BFA Silicon
P 15 30.974 1.07 1.80 1.10 FF8000 C09CC2 Phosphorus
S 16 32.06 1.05 1.80 1.04 FFFF30 FFFA00 Sulfur
Cl 17 35.45 1.02 1.75 0.99 1FF01F 31FC02 Chlorine
Ar 18 39.948 1.06 1.88 1.92 80D1E3 CFFEC4 Argon
K 19 39.098 2.03 2.75 2.35 8F40D4 A121F6 Potassium
Ca 20 40.078 1.76 2.31 1.97 3DFF00 5A96BD Calcium
Sc 21 44.956 1.70 2.58 1.64 E6E6E6 B563AB Scandium
Ti 22 47.867 1.60 2.46 1.47 BFC2C7 78CAFF Titanium
V 23 50.942 1.53 2.42 1.35 A6A6AB E61A00 Vanadium
Cr 24 51.996 1.39 2.45 1.29 8A99C7 00009E Chromium
Mn 25 54.938 1.39 2.45 1.37 9C7AC7 A8089E Manganese
Fe 26 55.845 1.32 2.44 1.26 E06633 B57200 Iron
Co 27 58.933 1.26 2.40 1.25 F090A0 0000AF Cobalt
Ni 28 58.693 1.24 2.40 1.25 50D050 B7BBBD Nickel
Cu 29 63.546 1.32 2.38 1.28 C88033 2247DC Copper
Zn 30 65.38 1.22 2.39 1.37 7D80B0 8F9082 Zinc
Ga 31 69.723 1.22 2.32 1.53 C28F8F 9FE474 Gallium
Ge 32 72.630 1.20 2.29 1.22 668F8F 7E6FA6 Germanium
As 33 74.922 1.19 1.88 1.21 BD80E3 74D057 Arsenic
Se 34 78.971 1.20 1.82 1.04 FFA100 9AEF0F Selenium
Br 35 79.904 1.20 1.86 1.14 A62929 7E3102 Bromine
Kr 36 83.798 1.16 2.25 1.98 5CB8D1 FAC1F3 Krypton
Rb 37 85.468 2.20 3.21 2.50 702EB0 FF0099 Rubidium
Sr 38 87.62 1.95 2.84 2.15 00FF00 00FF27 Strontium
Y 39 88.906 1.90 2.75 1.82 94FFFF 66988E Yttrium
Zr 40 91.224 1.75 2.52 1.60 94E0E0 00FF00 Zirconium
Nb 41 92.906 1.64 2.56 1.47 73C2C9 4CB276 Niobium
Mo 42 95.95 1.54 2.45 1.40 54B5B5 B386AF Molybdenum
Tc 43 98 1.47 2.44 1.35 3B9E9E CDAFCA Technetium
Ru 44 101.07 1.46 2.46 1.34 248F8F CFB8AE Ruthenium
Rh 45 102.91 1.42 2.44 1.34 0A7D8C CDD1AB Rhodium
Pd 46 106.42 1.39 2.15 1.37 006985 C1C3B8 Palladium
Ag 47 107.87 1.45 2.53 1.44 C0C0C0 B7BBBD Silver
Cd 48 112.41 1.44 2.49 1.52 FFD98F F21FDC Cadmium
In 49 114.82 1.42 2.43 1.67 A67573 D780BB Indium
Sn 50 118.71 1.39 2.42 1.58 668080 9A8EB9 Tin
Sb 51 121.76 1.39 2.47 1.41 9E63B5 D88350 Antimony
Te 52 127.60 1.38 1.99 1.37 D47A00 ADA251 Tellurium
I 53 126.90 1.39 2.04 1.33 940094 8E1F8A Iodine
Xe 54 131.29 1.40 2.06 2.18 429EB0 9AA1F8 Xenon
Cs 55 132.91 2.44 3.48 2.72 57178F 0EFEB9 Caesium
Ba 56 137.33 2.15 3.03 2.24 00C900 1EEF2C Barium
La 57 138.91 2.07 2.98 1.88 70D4FF 5AC449 Lanthanum
Ce 58 140.12 2.04 2.88 1.82 FFFFC7 - Cerium
Pr 59 140.91 2.03 2.92 1.82 D9FFC7 - Praseodymium
Nd 60 144.24 2.01 2.95 1.82 C7FFC7 - Neodymium
Pm 61 145 1.99 2.90 1.81 A3FFC7 - Promethium
Sm 62 150.36 1.98 2.90 1.81 8FFFC7 - Samarium
Eu 63 151.96 1.98 2.87 2.06 61FFC7 - Europium
Gd 64 157.25 1.96 2.83 1.79 45FFC7 - Gadolinium
Tb 65 158.93 1.94 2.79 1.77 30FFC7 - Terbium
Dy 66 162.50 1.92 2.87 1.77 1FFFC7 - Dysprosium
Ho 67 164.93 1.92 2.81 1.76 00FF9C - Holmium
Er 68 167.26 1.89 2.83 1.75 00E675 - Erbium
Tm 69 168.93 1.90 2.79 1.74 00D452 - Thulium
Yb 70 173.05 1.87 2.80 1.94 00BF38 - Ytterbium
Lu 71 174.97 1.87 2.74 1.72 00AB24 - Lutetium
Hf 72 178.49 1.75 2.63 1.59 4DC2FF - Hafnium
Ta 73 180.95 1.70 2.53 1.47 4DA6FF - Tantalum
W 74 183.84 1.62 2.57 1.41 2194D6 - Tungsten
Re 75 186.21 1.51 2.49 1.37 267DAB - Rhenium
Os 76 190.23 1.44 2.48 1.35 266696 - Osmium
Ir 77 192.22 1.41 2.41 1.36 175487 - Iridium
Pt 78 195.08 1.36 2.29 1.39 D0D0E0 C9C5D0 Platinum
Au 79 196.97 1.36 2.32 1.44 FFD123 FEB338 Gold
Hg 80 200.59 1.32 2.45 1.55 B8B8D0 - Mercury
Tl 81 204.38 1.45 2.47 1.71 A6544D - Thallium
Pb 82 207.2 1.46 2.60 1.75 575961 52535B Lead
Bi 83 208.98 1.48 2.54 1.82 9E4FB5 D22FF7 Bismuth
Po 84 209 1.40 2.00 1.77 AB5C00 - Polonium
At 85 210 1.50 2.02 1.50 754F45 - Astatine
Rn 86 222 1.50 2.20 2.20 428296 - Radon
Fr 87 223 2.60 3.48 2.80 420066 - Francium
Ra 88 226 2.21 2.83 2.35 007D00 - Radium
Ac 89 227 2.15 2.80 2.03 70ABFA - Actinium
Th 90 232.04 2.06 2.93 1.80 00BAFF - Thorium
Pa 91 231.04 2.00 2.88 1.63 00A1FF - Protactinium
U 92 238.03 1.96 2.71 1.56 008FFF - Uranium
Np 93 237 1.90 2.82 1.56 0080FF - Neptunium
Pu 94 244 1.87 2.81 1.64 006BFF - Plutonium
Am 95 243 1.80 2.83 1.73 545CF2 - Americium
Cm 96 247 1.69 3.05 1.74 785CE3 - Curium
Bk 97 247 1.60 3.40 1.70 8A4FE3 - Berkelium
Cf 98 251 1.60 3.05 1.86 A136D4 - Californium
Es 99 252 1.60 2.70 1.86 B31FD4 - Einsteinium
Fm 100 257 1.60 2.00 1.86 B31FBA - Fermium
Md 101 258 1.60 2.00 1.86 B30DA6 - Mendelevium
No 102 259 1.60 2.00 1.86 BD0D87 - Nobelium
Lr 103 262 1.60 2.00 1.86 C70066 - Lawrencium
`;

/** @typedef {{symbol:string,Z:number,mass:number,rcov:number,rvdw:number,ratom:number,jmol:string,vesta:string,name:string}} Element */

/** @type {Map<string, Element>} */
export const ELEMENTS = new Map();
/** @type {Element[]} indexed by Z */
export const BY_Z = [];

for (const line of TABLE.trim().split('\n')) {
  const [symbol, Z, mass, rcov, rvdw, ratom, jmol, vesta, name] = line.trim().split(/\s+/);
  const el = {
    symbol, Z: +Z, mass: +mass, rcov: +rcov, rvdw: +rvdw, ratom: +ratom,
    jmol: '#' + jmol, vesta: '#' + (vesta === '-' ? jmol : vesta), name,
  };
  ELEMENTS.set(symbol, el);
  BY_Z[el.Z] = el;
}

const LOWER = new Map([...ELEMENTS.keys()].map((s) => [s.toLowerCase(), s]));

/**
 * Normalise a raw label ("FE", "Fe2+", "O1", "C12", "D") to an element symbol.
 * Unknown labels map to "X" so they still render.
 */
export function normalizeSymbol(raw) {
  if (raw == null) return 'X';
  let s = String(raw).trim();
  if (/^\d+$/.test(s)) return BY_Z[+s]?.symbol ?? 'X';
  s = s.replace(/[^A-Za-z]/g, ' ').trim().split(' ')[0] || '';
  if (!s) return 'X';
  if (s === 'D' || s === 'T') return 'H';
  const two = s.slice(0, 2).toLowerCase();
  if (s.length >= 2 && LOWER.has(two)) {
    // Prefer two-letter match only if the second char is lower case or the whole token is that symbol.
    if (s[1] === s[1].toLowerCase() || s.length === 2) return LOWER.get(two);
  }
  const one = s[0].toLowerCase();
  if (LOWER.has(one)) return LOWER.get(one);
  if (LOWER.has(two)) return LOWER.get(two);
  return 'X';
}

export function element(symbol) {
  return ELEMENTS.get(symbol) ?? ELEMENTS.get('X');
}

export const METALS = new Set(
  ('Li Be Na Mg Al K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn ' +
   'Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po ' +
   'Fr Ra Ac Th Pa U Np Pu Am Cm').split(' '),
);

export const ANIONS = new Set(['O', 'F', 'S', 'Cl', 'N', 'Se', 'Br', 'I', 'Te', 'P', 'C', 'H', 'As']);

/** Pauling electronegativity (used to order inorganic formulas: SrTiO3, not O3SrTi). */
export const PAULING = {
  H: 2.2, Li: 0.98, Be: 1.57, B: 2.04, C: 2.55, N: 3.04, O: 3.44, F: 3.98, Na: 0.93, Mg: 1.31, Al: 1.61, Si: 1.9, P: 2.19, S: 2.58, Cl: 3.16,
  K: 0.82, Ca: 1.0, Sc: 1.36, Ti: 1.54, V: 1.63, Cr: 1.66, Mn: 1.55, Fe: 1.83, Co: 1.88, Ni: 1.91, Cu: 1.9, Zn: 1.65, Ga: 1.81, Ge: 2.01,
  As: 2.18, Se: 2.55, Br: 2.96, Kr: 3.0, Rb: 0.82, Sr: 0.95, Y: 1.22, Zr: 1.33, Nb: 1.6, Mo: 2.16, Tc: 1.9, Ru: 2.2, Rh: 2.28, Pd: 2.2,
  Ag: 1.93, Cd: 1.69, In: 1.78, Sn: 1.96, Sb: 2.05, Te: 2.1, I: 2.66, Xe: 2.6, Cs: 0.79, Ba: 0.89, La: 1.1, Ce: 1.12, Pr: 1.13, Nd: 1.14,
  Sm: 1.17, Eu: 1.2, Gd: 1.2, Tb: 1.1, Dy: 1.22, Ho: 1.23, Er: 1.24, Tm: 1.25, Yb: 1.1, Lu: 1.27, Hf: 1.3, Ta: 1.5, W: 2.36, Re: 1.9,
  Os: 2.2, Ir: 2.2, Pt: 2.28, Au: 2.54, Hg: 2.0, Tl: 1.62, Pb: 2.33, Bi: 2.02, Po: 2.0, At: 2.2, Fr: 0.7, Ra: 0.9, Ac: 1.1, Th: 1.3,
  Pa: 1.5, U: 1.38, Np: 1.36, Pu: 1.28,
};
