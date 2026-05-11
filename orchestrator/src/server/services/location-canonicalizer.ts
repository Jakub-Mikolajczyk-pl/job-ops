export interface CanonicalizedLocation {
  city: string | null;
  country: "PL" | "DE" | "UK" | "OTHER" | null;
  isRemote: boolean;
}

const REMOTE_PATTERNS = [
  /remote/i,
  /zdaln/i,
  /work from home/i,
  /wfh/i,
  /home office/i,
  /hybrid/i,
];

const CITY_ALIASES: Array<[RegExp, string]> = [
  [/warsaw|warszaw|mazowieckie|masovian|mazowsze/i, "Warsaw"],
  [/krak(ow|ów)|małopolsk|lesser poland/i, "Krakow"],
  [/wrocl(aw|ław)|dolnośląsk|lower silesian|dolny śląsk/i, "Wroclaw"],
  [/gda(nsk|ńsk)|trojmiasto|trójmiasto|pomorski/i, "Gdansk"],
  [/pozna(n|ń)|wielkopolsk|greater poland/i, "Poznan"],
  [/lodz|łódź|łódzkie/i, "Lodz"],
  [/katowice|katowic|silesian agglomeration/i, "Katowice"],
  [/gdynia/i, "Gdynia"],
  [/szczecin|westpomeranian|zachodniopomorsk/i, "Szczecin"],
  [/lublin|lubelski|lubelskie/i, "Lublin"],
  [/bydgoszcz/i, "Bydgoszcz"],
  [/biaystok|bialystok|białystok/i, "Bialystok"],
  [/berlin/i, "Berlin"],
  [/munich|muenchen|münchen/i, "Munich"],
  [/hamburg/i, "Hamburg"],
  [/frankfurt/i, "Frankfurt"],
  [/london/i, "London"],
  [/manchester/i, "Manchester"],
  [/birmingham/i, "Birmingham"],
];

const CITY_COUNTRY: Record<string, "PL" | "DE" | "UK"> = {
  Warsaw: "PL", Krakow: "PL", Wroclaw: "PL", Gdansk: "PL", Poznan: "PL",
  Lodz: "PL", Katowice: "PL", Gdynia: "PL", Szczecin: "PL", Lublin: "PL",
  Bydgoszcz: "PL", Bialystok: "PL",
  Berlin: "DE", Munich: "DE", Hamburg: "DE", Frankfurt: "DE",
  London: "UK", Manchester: "UK", Birmingham: "UK",
};

const EXPLICIT_COUNTRY: Array<[RegExp, "PL" | "DE" | "UK" | "OTHER"]> = [
  [/poland|polska/i, "PL"],
  [/germany|deutschland/i, "DE"],
  [/united kingdom|england|great britain/i, "UK"],
];

export function canonicalizeLocation(raw: string): CanonicalizedLocation {
  if (!raw || raw.trim() === "") {
    return { city: null, country: null, isRemote: false };
  }

  const isRemote = REMOTE_PATTERNS.some((re) => re.test(raw));

  let city: string | null = null;
  for (const [re, canonical] of CITY_ALIASES) {
    if (re.test(raw)) { city = canonical; break; }
  }

  let country: "PL" | "DE" | "UK" | "OTHER" | null = null;
  if (city) {
    country = CITY_COUNTRY[city] ?? null;
  } else {
    for (const [re, c] of EXPLICIT_COUNTRY) {
      if (re.test(raw)) { country = c; break; }
    }
  }

  return { city, country, isRemote };
}
