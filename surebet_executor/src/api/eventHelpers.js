/**
 * Helper to group a flat list of active odds into events.
 * Returns an array of events, where each event contains metadata and a list of markets.
 */
export function groupOddsByEvent(odds) {
  const eventsMap = new Map();

  for (const odd of odds) {
    // Generate a fallback key if eventId is missing, to avoid ungrouping or collisions.
    // The key must be deterministic for the same match.
    // Format: "sport|league|home|away"
    const fallbackKey = `${odd.sport || ''}|${odd.league || ''}|${odd.home || ''}|${odd.away || ''}`;
    const eventKey = odd.eventId || fallbackKey;

    if (!eventsMap.has(eventKey)) {
      eventsMap.set(eventKey, {
        eventId: eventKey,
        sport: odd.sport,
        league: odd.league,
        home: odd.home,
        away: odd.away,
        startTime: odd.startTime,
        markets: []
      });
    }

    const event = eventsMap.get(eventKey);
    // Push the full market object into the event's markets array
    event.markets.push(odd);
  }

  return Array.from(eventsMap.values());
}
