const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('C:/Users/Edwin_Garcia/.gemini/antigravity-ide/brain/86aef2f8-d139-46d9-97d9-4fc3dd50daf4/.system_generated/logs/transcript.jsonl');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let index = 0;
  for await (const line of rl) {
    if (line.includes('postgresql://') || line.includes('postgres://') || line.includes('supabase.co')) {
      fs.writeFileSync(`C:/Users/Edwin_Garcia/.gemini/antigravity-ide/brain/86aef2f8-d139-46d9-97d9-4fc3dd50daf4/db_connection_found_${index}.txt`, line);
      console.log(`Found database connection in line metadata ${index}`);
      index++;
    }
  }
}

processLineByLine();
