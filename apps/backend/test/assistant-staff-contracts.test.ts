import { describe, expect, it } from 'vitest';
import { dtoArgs, idArgs, ToolInputError } from '../src/assistant/contracts';
import { CreateHubDto, RecordReweighDto } from '../src/common/dto';
const id = 'e8ec812e-8ad6-43ec-a7ef-17dc87c7e710';
describe('staff tool argument contracts', () => {
  it('validates with DTO rules and strips undefined keys', () => {
    expect(dtoArgs(CreateHubDto, { code: 'LAG', name: 'Lagos' })).toEqual({ code: 'LAG', name: 'Lagos' });
    expect(() => dtoArgs(CreateHubDto, { code: 'LAG', name: 'Lagos', admin: true })).toThrow(ToolInputError);
    expect(() => dtoArgs(RecordReweighDto, { verifiedWeightKg: 0 })).toThrow(ToolInputError);
    expect(() => dtoArgs(CreateHubDto, null)).toThrow(ToolInputError);
  });
  it('splits a uuid id from the remaining arguments', () => {
    expect(idArgs({ batchId: id, status: 'sealed' }, 'batchId')).toEqual({ id, rest: { status: 'sealed' } });
    expect(() => idArgs({ batchId: 'nope' }, 'batchId')).toThrow(ToolInputError);
  });
});
