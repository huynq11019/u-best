import asyncio
import os
import sys

# Add odds_aggregator to path to import modules
sys.path.append(os.path.join(os.path.dirname(__file__), "odds_aggregator"))

from ingestors.saba import SABAIngestor

async def main():
    print("Testing SABAIngestor automatic token fetching...")
    
    # Initialize without a token in environment
    if "SABA_TOKEN" in os.environ:
        del os.environ["SABA_TOKEN"]
        
    ingestor = SABAIngestor()
    
    # Force token to be empty to test logic
    ingestor._token = ""
    
    try:
        matches = await ingestor.fetch_matches()
        if matches:
            print(f"✅ Success! Fetched {len(matches)} matches.")
            print(f"Token obtained: {ingestor._token[:40]}...")
            print(f"Sample match: {matches[0].home_team} vs {matches[0].away_team}")
        else:
            print("⚠️ No matches fetched, but no errors. Token might be valid.")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        await ingestor.close()

if __name__ == "__main__":
    asyncio.run(main())
