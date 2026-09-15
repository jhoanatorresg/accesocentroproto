const fs = require('fs');
const path = require('path');

const brainDir = 'C:/Users/Edwin_Garcia/.gemini/antigravity-ide/brain/86aef2f8-d139-46d9-97d9-4fc3dd50daf4';
const files = fs.readdirSync(brainDir);

for (const file of files) {
  if (file.startsWith('db_connection_found_')) {
    const content = fs.readFileSync(path.join(brainDir, file), 'utf8');
    // search for postgres urls
    const regex = /(postgres(?:ql)?:\/\/[^\s"']+)/g;
    const matches = content.match(regex);
    if (matches) {
      console.log(`File: ${file}`);
      matches.forEach(m => console.log(`  Match: ${m}`));
    }
  }
}
