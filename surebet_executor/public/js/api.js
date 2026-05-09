const BASE = '';

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const json = await res.json();
  if (!res.ok) throw { status: res.status, ...json };
  return json;
}

export const api = {
  /** List registered bookmakers */
  bookmakers: () => request('/api/bookmakers'),

  /** Get events for a bookmaker */
  events: (book, sport = 'football', marketType) => {
    let url = `/api/${book}/events?sport=${sport}`;
    if (marketType) url += `&marketType=${marketType}`;
    return request(url);
  },

  /** Get event detail */
  eventDetail: (book, eventId, sport = 'football') =>
    request(`/api/${book}/events/${eventId}?sport=${sport}`),

  /** Get flat odds list */
  odds: (book, sport = 'football', marketType) => {
    let url = `/api/odds/${book}?sport=${sport}`;
    if (marketType) url += `&marketType=${marketType}`;
    return request(url);
  },

  /** Place bet by selection */
  betBySelection: (book, body) =>
    request(`/api/${book}/bets/by-selection`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Scan surebets */
  surebetScan: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.sport) qs.set('sport', params.sport);
    if (params.minProfitPct != null) qs.set('minProfitPct', params.minProfitPct);
    if (params.books) qs.set('books', params.books);
    if (params.scope) qs.set('scope', params.scope);
    return request(`/api/surebet/scan?${qs}`);
  },

  /** Latest surebets from cache */
  surebetLatest: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', params.limit);
    if (params.minProfitPct != null) qs.set('minProfitPct', params.minProfitPct);
    if (params.sport) qs.set('sport', params.sport);
    return request(`/api/surebet/latest?${qs}`);
  },

  /** Surebet worker health */
  surebetHealth: () => request('/api/surebet/health'),
};
