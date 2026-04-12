import asyncio
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from ingestors.saba import SABAIngestor
from ingestors.xbet import XBETIngestor
from ingestors.base import ProviderError, AuthError
from merger.merger import Merger
from normalizer.normalizer import normalize

def default_serializer(obj):
    from enum import Enum
    from normalizer.schema import Score
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, Score):
        return {"home": obj.home, "away": obj.away}
    return str(obj)

async def test_run():
    merger = Merger()
    saba = SABAIngestor()
    xbet = XBETIngestor()

    print("Fetching matches from SABA...")
    try:
        saba_matches = await saba.fetch_matches()
        print(f" -> SABA returned {len(saba_matches)} matches.")
        for m in saba_matches:
            norm = normalize(m)
            if norm:
                merger.upsert(norm)
    except AuthError:
        print(" -> SABA fetching failed: 401 Auth Error (No valid Token found in .env)")
    except Exception as e:
        import traceback
        print(f" -> SABA fetching failed:")
        traceback.print_exc()

    print("\nFetching matches from 1xBET (this takes a bit longer as we fetch details in parallel)...")
    try:
        xbet_matches = await xbet.fetch_matches()
        print(f" -> 1xBET returned {len(xbet_matches)} matches.")
        for m in xbet_matches:
            norm = normalize(m)
            if norm:
                merger.upsert(norm)
    except Exception as e:
        import traceback
        print(f" -> 1xBET fetching failed:")
        traceback.print_exc()

    
    print("\n--- AGGREGATED LIVE MATCHES (Total {}) ---".format(len(merger._store)))
    
    # We'll just show the first 3 matches for a clean console output
    for i, (key, merged_store) in enumerate(list(merger._store.items())):
        if i >= 3:
            print(f"\n... and {len(merger._store) - 3} more matches")
            break
            
        event = merged_store.to_event()
        out_dict = {
            "Match Key": event.match_key,
            "League": event.league,
            "Home": event.home_team,
            "Away": event.away_team,
            "Status": event.status,
            "Score": event.score,
            "Markets Count": sum(len(markets) for markets in event.source_markets.values()),
            "Sources": list(event.source_markets.keys()),
            "Full JSON Example (Partial)": event.source_markets
        }
        
        print("\nMatch #{}".format(i + 1))
        print(json.dumps(out_dict, indent=2, ensure_ascii=False, default=default_serializer))
        
    print("\nSummary:")
    print(json.dumps(merger.get_stats(), indent=2))

    # Clean up sessions to avoid unclosed socket warnings
    if getattr(saba, 'close', None):
        if asyncio.iscoroutinefunction(saba.close):
            await saba.close()
        else:
            saba.close()
            
    if getattr(xbet, 'close', None):
        if asyncio.iscoroutinefunction(xbet.close):
            await xbet.close()
        else:
            xbet.close()

if __name__ == "__main__":
    asyncio.run(test_run())
