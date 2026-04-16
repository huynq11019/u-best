const fs = require('fs');

let content = fs.readFileSync('src/adapters/lu88Adapter.js', 'utf8');
content = content.replace(/await frame\.locator\('\.c-match'\)\.first\(\)\.waitFor\(\{ state: 'attached', timeout: 10000 \}\)\.catch\(\(\) => \{\}\);/, 
  "await frame.locator('.c-match').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});\n      await page.waitForTimeout(5000);");
fs.writeFileSync('src/adapters/lu88Adapter.js', content, 'utf8');

