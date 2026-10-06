import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantController } from '../src/assistant/assistant.module';
import { complete } from '../src/assistant/deepseek';
vi.mock('../src/assistant/deepseek', () => ({complete:vi.fn()}));
const originalKey = process.env.DEEPSEEK_API_KEY;
afterEach(() => { vi.resetAllMocks(); if(originalKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY=originalKey; });
function setup() {
  process.env.DEEPSEEK_API_KEY='mock-only';
  const req=new EventEmitter(); const res:any=new EventEmitter();
  let output=''; res.status=()=>res;res.set=()=>res;res.flushHeaders=()=>{};res.write=(s:string)=>{output+=s;};res.end=()=>{res.writableEnded=true;};
  const tools={execute:vi.fn().mockResolvedValue({action:{kind:'navigate',target:'wallet'},label:'Open wallet'})};
  const controller=new AssistantController(tools as any);
  const run=()=>controller.chat({messages:[{role:'user',content:'Open wallet'}]},{sub:'session-user',kind:'requester',email:'a@example.test'},req as any,res);
  return {req,res,tools,run,output:()=>output};
}
const call={id:'tool1',type:'function',function:{name:'open_screen',arguments:'{"target":"wallet"}'}};
describe('assistant route orchestration (mocked provider)',()=>{
  it('reports actual tool attempts, sends review actions and limits identity to the session',async()=>{
    const t=setup();vi.mocked(complete).mockResolvedValueOnce({role:'assistant',content:'',tool_calls:[call]} as any).mockImplementationOnce(async(_m,_t,_s,delta)=>{delta('Ready for review');return {role:'assistant',content:'Ready for review'};});
    await t.run();expect(t.tools.execute).toHaveBeenCalledWith('open_screen',{target:'wallet'},'session-user');
    expect(t.output()).toContain('"activity"');expect(t.output()).toContain('"action"');expect(t.output()).toContain('[DONE]');expect(t.res.writableEnded).toBe(true);
  });
  it('bounds repeated tool rounds and conceals provider diagnostics',async()=>{
    const t=setup();vi.mocked(complete).mockResolvedValue({role:'assistant',content:'',tool_calls:[call]} as any);
    await t.run();expect(t.tools.execute).toHaveBeenCalledTimes(3);expect(t.output()).toContain('"error"');expect(t.output()).not.toContain('[DONE]');
    const f=setup();vi.mocked(complete).mockRejectedValue(new Error('sensitive provider diagnostics'));
    await f.run();expect(f.output()).not.toContain('sensitive');expect(f.output()).toContain('Please retry');
  });
  it('aborts the provider when the client disconnects and removes listeners',async()=>{
    const t=setup();let signal:AbortSignal|undefined;
    vi.mocked(complete).mockImplementation(async(_m,_t,s)=>{signal=s;t.res.emit('close');expect(s.aborted).toBe(true);throw new Error('Disconnected');});
    await t.run();expect(signal?.aborted).toBe(true);expect(t.res.listenerCount('close')).toBe(0);expect(t.req.listenerCount('aborted')).toBe(0);
  });
  it('refuses activation without a backend secret',async()=>{
    const t=setup();delete process.env.DEEPSEEK_API_KEY;await expect(t.run()).rejects.toThrow('not configured');expect(complete).not.toHaveBeenCalled();
  });
  it('times out a stalled provider request',async()=>{
    vi.useFakeTimers();
    try {
      const t=setup();let signal:AbortSignal|undefined;
      vi.mocked(complete).mockImplementation((_m,_t,s)=>new Promise((_resolve,reject)=>{signal=s;s.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}));
      const pending=t.run();await vi.advanceTimersByTimeAsync(45000);await pending;
      expect(signal?.aborted).toBe(true);expect(t.output()).toContain('"error"');expect(t.res.writableEnded).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
