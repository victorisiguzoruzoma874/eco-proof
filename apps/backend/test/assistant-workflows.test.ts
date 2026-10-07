import { describe, expect, it, vi } from 'vitest';
import { AssistantTools } from '../src/assistant/tools';
import { CatalogRedemptionEntity, RequesterEntity } from '../src/database/entities';
import { clearAssistantDrafts, readAssistantDraft, saveAssistantDraft, validateAssistantAction } from '../../dashboard/src/lib/assistant-actions';

const id = 'e8ec812e-8ad6-43ec-a7ef-17dc87c7e710';
const pickup = {hubId:id,material:'PET',estimatedWeightKg:5.345,address:'12 Example Road',notes:'Gate B'};
function setup() {
  const wallet={getWallet:vi.fn().mockResolvedValue({balanceCredits:100,pendingWithdrawals:[],transactions:[]})};
  const manager={find:vi.fn().mockResolvedValue([]),findOne:vi.fn(),save:vi.fn(),update:vi.fn(),delete:vi.fn()};
  return {wallet,manager,tools:new AssistantTools(wallet as any,{manager} as any)};
}
describe('expanded assistant workflows',()=>{
  it('reads profile and reward orders using only authenticated identity and safe fields',async()=>{
    const t=setup();t.manager.findOne.mockResolvedValue({name:'Person',email:'a@example.test',phone:null,active:true,passwordHash:'never return'});
    const profile=await t.tools.execute('get_account',{},'session-user');expect(profile).not.toHaveProperty('passwordHash');
    expect(t.manager.findOne).toHaveBeenCalledWith(RequesterEntity,expect.objectContaining({where:{id:'session-user'},select:expect.not.objectContaining({passwordHash:true})}));
    await t.tools.execute('get_reward_orders',{limit:3},'session-user');expect(t.manager.find).toHaveBeenCalledWith(CatalogRedemptionEntity,expect.objectContaining({where:{requesterId:'session-user'},take:3}));
    await expect(t.tools.execute('get_account',{userId:'victim'},'session-user')).rejects.toThrow();
  });
  it('prepares a validated pickup with exact details and never books or writes',async()=>{
    const t=setup();t.manager.findOne.mockResolvedValueOnce({id,name:'Hub'}).mockResolvedValueOnce({code:'PET',name:'Plastic'});
    expect(await t.tools.execute('prepare_pickup',pickup,'session-user')).toMatchObject({action:{kind:'review-pickup',...pickup},status:expect.stringContaining('no pickup')});
    expect(t.manager.save).not.toHaveBeenCalled();expect(t.manager.update).not.toHaveBeenCalled();
    for(const invalid of [{...pickup,hubId:'https://evil.test'},{...pickup,estimatedWeightKg:.0001},{...pickup,address:''},{...pickup,notes:'x'.repeat(1001)},{...pickup,userId:'victim'}])await expect(t.tools.execute('prepare_pickup',invalid,'session-user')).rejects.toThrow();
  });
  it('rejects stale hubs/materials and insufficient or unavailable rewards',async()=>{
    const t=setup();t.manager.findOne.mockResolvedValue(null);
    await expect(t.tools.execute('prepare_pickup',pickup,'session-user')).rejects.toThrow('unavailable');
    t.manager.findOne.mockResolvedValue({id,active:true,stock:0,costCredits:1});await expect(t.tools.execute('prepare_reward',{itemId:id},'session-user')).rejects.toThrow('out of stock');
    t.manager.findOne.mockResolvedValue({id,name:'Reward',stock:1,costCredits:101});await expect(t.tools.execute('prepare_reward',{itemId:id},'session-user')).rejects.toThrow('Insufficient');
    t.manager.findOne.mockResolvedValue({id,name:'Reward',stock:1,costCredits:10});expect(await t.tools.execute('prepare_reward',{itemId:id},'session-user')).toMatchObject({action:{kind:'review-reward',itemId:id}});
    expect(t.manager.save).not.toHaveBeenCalled();
  });
  it('normalizes claim format without redeeming it, and validates explicit themes',async()=>{
    const t=setup();expect(await t.tools.execute('prepare_claim',{code:'abcd-efgh'},'session-user')).toMatchObject({action:{kind:'review-claim',code:'ABCDEFGH'}});
    await expect(t.tools.execute('prepare_claim',{code:'not-a-code'},'session-user')).rejects.toThrow();
    expect(await t.tools.execute('set_theme',{theme:'dark'},'session-user')).toMatchObject({action:{kind:'set-theme',theme:'dark'}});
    await expect(t.tools.execute('set_theme',{theme:'javascript:alert(1)'},'session-user')).rejects.toThrow();expect(t.wallet.getWallet).not.toHaveBeenCalled();expect(t.manager.save).not.toHaveBeenCalled();
  });
  it('host validation rejects extra fields and arbitrary navigation across every action',()=>{
    const actions=[{kind:'navigate',target:'wallet'},{kind:'review-withdrawal',amountCredits:1},{kind:'review-pickup',...pickup},{kind:'review-reward',itemId:id},{kind:'review-claim',code:'ABCDEFGH'},{kind:'set-theme',theme:'dark'}];
    for(const a of actions){expect(validateAssistantAction(a)).toEqual(a);expect(()=>validateAssistantAction({...a,url:'https://evil.test'})).toThrow();}
    for(const a of [{kind:'navigate',target:'constructor'},{kind:'review-pickup',...pickup,estimatedWeightKg:Infinity},{kind:'review-claim',code:'<script>'},{kind:'set-theme',theme:['dark']}])expect(()=>validateAssistantAction(a)).toThrow();
  });
  it('keeps private drafts in memory, distinct, expiring and clearable',()=>{
    clearAssistantDrafts();const a=saveAssistantDraft({kind:'review-pickup',...pickup});const b=saveAssistantDraft({kind:'review-claim',code:'ABCDEFGH'});
    expect(a).not.toBe(b);expect(a).not.toContain(pickup.address);expect(readAssistantDraft(a)).toMatchObject({address:pickup.address});expect(readAssistantDraft(b)).toMatchObject({code:'ABCDEFGH'});
    const now=vi.spyOn(Date,'now').mockReturnValue(Date.now()+16*60000);expect(readAssistantDraft(a)).toBeUndefined();now.mockRestore();clearAssistantDrafts();expect(readAssistantDraft(b)).toBeUndefined();
  });
});
