import { chromium } from 'playwright';
import Lu88Adapter from './src/adapters/lu88Adapter.js';
import { config } from './src/config/index.js';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const adapter = new Lu88Adapter('lu88', config.bookkies.lu88);
  await adapter.login(page);
  await adapter.warmUp(page);
  const frameCount = page.frames().length;
  console.log("Total frames:", frameCount);
  for (const f of page.frames()) {
      console.log("Frame name:", f.name(), "URL:", f.url());
  }
  await browser.close();
}
main();
