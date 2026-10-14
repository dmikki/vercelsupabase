// Pure parser: only top-level Codex completion events, never agent-message text.
export function readUsage(log) {
  let input=0,cached=0,output=0,turns=0,invalid=false
  for(const line of log.split('\n')) {
    const match=line.replace(/\x1b\[[0-9;]*m/g,'').match(/^(?:\d{4}-\d\d-\d\dT\S+\s+)?(\{"type":"turn.completed",.*\})\s*$/)
    if(!match) continue
    try {
      const u=JSON.parse(match[1]).usage
      if(!u || ![u.input_tokens,u.cached_input_tokens,u.output_tokens].every(n=>Number.isSafeInteger(n)&&n>=0) || u.cached_input_tokens>u.input_tokens) {invalid=true;continue}
      input+=u.input_tokens;cached+=u.cached_input_tokens;output+=u.output_tokens;turns++
    } catch {invalid=true}
  }
  return {input,cached,output,turns,valid:turns>0&&!invalid}
}
