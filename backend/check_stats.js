const fs = require('fs');
const content = fs.readFileSync('app/page.tsx', 'utf8');

console.log('Contains stats.histogram:', content.includes('stats.histogram'));
console.log('Contains stats.weekly:', content.includes('stats.weekly'));
console.log('Contains weekly:', content.includes('weekly'));
