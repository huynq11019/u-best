import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Lu88Adapter from '../src/adapters/lu88Adapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, 'lu88_c-match-event.html'), 'utf-8');

const adapter = new Lu88Adapter('lu88', {});
const result = adapter._parseOddsFromHtml(html, 'football', true);
const ou = result.filter(o => o.marketType.startsWith('OU') || o.marketType.startsWith('AH'));
console.log(JSON.stringify(ou, null, 2));
