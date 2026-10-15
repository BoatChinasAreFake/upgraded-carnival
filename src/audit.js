import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// Never record chat, audio, tokens, raw errors, or model output.
export class Audit {
  constructor(file) { fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 }); this.fd = fs.openSync(file,'a',0o600); this.previous = '0'.repeat(64); }
  write(event, fields={}) {
    const record = { time: new Date().toISOString(), event, ...fields, previous:this.previous };
    this.previous = crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
    fs.writeSync(this.fd, JSON.stringify({...record, hash:this.previous})+'\n');
  }
  close() { fs.closeSync(this.fd); }
}
