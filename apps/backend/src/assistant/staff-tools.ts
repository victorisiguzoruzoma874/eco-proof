import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { isEmail } from 'class-validator';
import { BATCH_STATUSES, type BatchStatus } from '@proofchain/shared';
import type { JwtPayload, Role } from '../auth/auth.module';
import { HubEntity } from '../database/entities';
import { BatchesService } from '../batches/batches.service';
import { EventsService } from '../events/events.service';
import { ReportsService } from '../reports/reports.service';
import { CustodyService } from '../custody/custody.service';
import { ReweighService } from '../reweigh/reweigh.service';
import { RequestsService } from '../requests/requests.service';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';
import { PayoutsService } from '../payouts/payouts.service';
import { CatalogService } from '../catalog/catalog.service';
import { RegistryService } from '../collectors/registry.service';
import { MaterialsService } from '../materials/materials.service';
import { MaterialRatesService } from '../material-rates/material-rates.service';
import { CreditRatesService } from '../credit-rates/credit-rates.service';
import { UsersService } from '../users/users.service';
import { AddEventsDto, AdvanceStatusDto, AssignRequestDto, CreateBatchDto, CreateCatalogItemDto, CreateCollectorDto, CreateCreditRateDto, CreateCustodyTransferDto, CreateHubDto, CreateMaterialDto, CreateMaterialRateDto, CreatePayoutDto, EnrolDeviceDto, FulfillRequestDto, MarkPayoutPaidDto, MarkWithdrawalPaidDto, RecordReweighDto, UpdateMaterialDto, UpdateUserDto } from '../common/dto';
import { definition } from './tools';
import { dtoArgs, idArgs, isUuid, objectArgs, ToolInputError } from './contracts';
import { PendingAdminOps } from './pending';

/** read: every staff role · ops-read/operate: operator+admin · admin-read/admin: admin only. */
export type Tier = 'read' | 'ops-read' | 'operate' | 'admin-read' | 'admin';
const TIERS: Record<Role, Tier[]> = { auditor: ['read'], operator: ['read', 'ops-read', 'operate'], admin: ['read', 'ops-read', 'operate', 'admin-read', 'admin'] };
export const STAFF_SCREENS = ['batches', 'weigh-ins', 'reweigh', 'payouts', 'requests', 'withdrawals', 'collectors', 'material-rates', 'materials', 'catalog-items', 'catalog-redemptions'] as const;
const id = { type: 'string', format: 'uuid' }, ids = { type: 'array', items: id }, str = (maxLength: number) => ({ type: 'string', maxLength });
const num = { type: 'number', minimum: 0 }, bool = { type: 'boolean' }, limit = { limit: { type: 'integer', minimum: 1, maximum: 50 } };
const material = { type: 'string', pattern: '^[A-Z0-9][A-Z0-9_-]{1,15}$' }, isoDate = { type: 'string', format: 'date-time' };
const tool = (tier: Tier, name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({ tier, tool: definition(name, description, properties, required) });
export const STAFF_TOOLS = [
  tool('read', 'get_capabilities', 'List the operations this signed-in staff account may use, and its role.'),
  tool('read', 'list_batches', 'List batches, newest first, optionally by status.', { status: { type: 'string', enum: [...BATCH_STATUSES] }, ...limit }),
  tool('read', 'get_batch', 'Read one batch.', { batchId: id }, ['batchId']),
  tool('read', 'get_batch_events', 'List the weigh-ins in a batch.', { batchId: id, ...limit }, ['batchId']),
  tool('read', 'get_batch_report', 'Read the audit report for a batch.', { batchId: id }, ['batchId']),
  tool('read', 'list_events', 'List weigh-in events, newest first, with optional filters.', { hubId: id, collectorId: id, batched: bool, quarantined: bool, hasPhoto: bool, ...limit }),
  tool('read', 'get_event', 'Read one weigh-in event with its reweighs.', { eventId: id }, ['eventId']),
  tool('read', 'list_payouts', 'List collector payouts.', { collectorId: id, ...limit }),
  tool('read', 'get_payout', 'Read one payout.', { payoutId: id }, ['payoutId']),
  tool('read', 'list_hubs', 'List hubs with ids, codes and names.'),
  tool('read', 'list_materials', 'List materials, retired ones flagged.'),
  tool('read', 'list_credit_rates', 'List requester credit-per-kg rates.', { materialCode: material, hubId: id, ...limit }),
  tool('read', 'open_screen', 'Offer a button to a staff dashboard screen; it opens only when clicked.', { target: { type: 'string', enum: [...STAFF_SCREENS] } }, ['target']),
  tool('ops-read', 'list_requests', 'List pickup requests.', { status: str(30), hubId: id, ...limit }),
  tool('ops-read', 'list_withdrawals', 'List requester withdrawal requests.', { status: str(30), ...limit }),
  tool('ops-read', 'list_collectors', 'List registered collectors.', { ...limit }),
  tool('ops-read', 'list_devices', 'List enrolled collector devices.', { collectorId: id, ...limit }),
  tool('ops-read', 'list_reward_orders', 'List reward (catalog) redemption orders.', { status: str(30), ...limit }),
  tool('ops-read', 'list_material_rates', 'List collector payout rates per kg.', { materialCode: material, hubId: id, ...limit }),
  tool('ops-read', 'list_custody', 'List custody transfers of a batch.', { batchId: id }, ['batchId']),
  tool('operate', 'create_batch', 'Open a new batch for a hub and material.', { hubId: id, material }, ['hubId', 'material']),
  tool('operate', 'add_batch_events', 'Add weigh-in events to an open batch.', { batchId: id, eventIds: ids }, ['batchId', 'eventIds']),
  tool('operate', 'remove_batch_event', 'Remove one weigh-in from an open batch.', { batchId: id, eventId: id }, ['batchId', 'eventId']),
  tool('operate', 'seal_batch', 'Seal a batch: freeze membership and compute its Merkle root.', { batchId: id }, ['batchId']),
  tool('operate', 'advance_batch_status', 'Move a batch to its next status.', { batchId: id, status: { type: 'string', enum: [...BATCH_STATUSES] } }, ['batchId', 'status']),
  tool('operate', 'record_custody_transfer', 'Record a custody transfer for a batch.', { batchId: id, fromParty: str(200), toParty: str(200), weightInKg: num, weightOutKg: num, reason: str(500), transferredAt: isoDate }, ['batchId', 'fromParty', 'toParty', 'weightInKg', 'weightOutKg', 'transferredAt']),
  tool('operate', 'record_reweigh', 'Record the hub-verified weight of a weigh-in event.', { eventId: id, verifiedWeightKg: num, notes: str(500) }, ['eventId', 'verifiedWeightKg']),
  tool('operate', 'assign_request', 'Assign a pickup request to a collector.', { requestId: id, collectorId: id }, ['requestId', 'collectorId']),
  tool('operate', 'fulfill_request', 'Mark a pickup request fulfilled by a weigh-in event.', { requestId: id, eventId: id }, ['requestId', 'eventId']),
  tool('operate', 'cancel_request', 'Cancel a pickup request.', { requestId: id }, ['requestId']),
  tool('operate', 'mark_withdrawal_paid', 'Mark a withdrawal request paid after paying it outside ProofChain.', { withdrawalId: id, payoutRef: str(200) }, ['withdrawalId']),
  tool('operate', 'reject_withdrawal', 'Reject a withdrawal request and release its held credits.', { withdrawalId: id }, ['withdrawalId']),
  tool('operate', 'create_payout', 'Create a collector payout covering reweighed events.', { collectorId: id, eventReweighIds: ids, method: str(50) }, ['collectorId', 'eventReweighIds', 'method']),
  tool('operate', 'mark_payout_paid', 'Mark a collector payout paid.', { payoutId: id, payoutRef: str(200) }, ['payoutId']),
  tool('operate', 'fulfill_reward_order', 'Mark a reward order fulfilled.', { redemptionId: id }, ['redemptionId']),
  tool('operate', 'create_collector', 'Register a collector.', { name: str(200), phone: str(16), cooperativeId: str(100), kycLevel: { type: 'string', enum: ['none', 'basic', 'verified'] } }, ['name', 'phone']),
  tool('operate', 'enrol_device', 'Enrol a collector device by its ed25519 public key.', { collectorId: id, label: str(120), publicKeyBase64: str(44) }, ['collectorId', 'label', 'publicKeyBase64']),
  tool('admin-read', 'list_users', 'List staff accounts and roles.'),
  tool('admin', 'create_hub', 'Admin: prepare a new hub for confirmation.', { code: str(50), name: str(200), minWeightKg: num, maxWeightKg: num }, ['code', 'name']),
  tool('admin', 'create_material', 'Admin: prepare a new material for confirmation.', { code: material, name: str(100), description: str(500), examples: { type: 'array', items: str(100) }, active: bool, sortOrder: num }, ['code', 'name']),
  tool('admin', 'update_material', 'Admin: prepare a material edit or retirement (active:false) for confirmation.', { code: material, name: str(100), description: str(500), examples: { type: 'array', items: str(100) }, active: bool, sortOrder: num }, ['code']),
  tool('admin', 'create_material_rate', 'Admin: prepare a collector payout rate per kg for confirmation.', { materialCode: material, hubId: id, ratePerKg: num, effectiveFrom: isoDate }, ['materialCode', 'ratePerKg']),
  tool('admin', 'create_credit_rate', 'Admin: prepare a requester credit rate per kg for confirmation.', { materialCode: material, hubId: id, creditsPerKg: num, effectiveFrom: isoDate }, ['materialCode', 'creditsPerKg']),
  tool('admin', 'create_catalog_item', 'Admin: prepare a new reward catalog item for confirmation.', { name: str(200), description: str(500), category: str(50), costCredits: num, stock: num }, ['name', 'category', 'costCredits']),
  tool('admin', 'create_user', 'Admin: prepare a staff account for confirmation. A temporary password is generated on confirmation; never ask for one.', { email: str(200), role: { type: 'string', enum: ['admin', 'operator', 'auditor'] } }, ['email', 'role']),
  tool('admin', 'update_user', 'Admin: prepare a role change or (de)activation of a staff account for confirmation.', { userId: id, role: { type: 'string', enum: ['admin', 'operator', 'auditor'] }, active: bool }, ['userId']),
];
export const toolsFor = (role: Role) => STAFF_TOOLS.filter(t => TIERS[role]?.includes(t.tier)).map(t => t.tool);

const lim = (v: unknown) => { if (v === undefined) return 10; if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 50) throw new ToolInputError('limit must be a whole number from 1 to 50.'); return v; };
const clip = <T>(rows: T[], limit: unknown) => { const n = lim(limit); return { total: rows.length, showing: Math.min(n, rows.length), rows: rows.slice(0, n) }; };
const optId = (v: unknown, key: string) => { if (v !== undefined && !isUuid(v)) throw new ToolInputError(`${key} must be an id from a list tool.`); return v as string | undefined; };
const optBool = (v: unknown, key: string) => { if (v !== undefined && typeof v !== 'boolean') throw new ToolInputError(`${key} must be true or false.`); return v as boolean | undefined; };
const optStr = (v: unknown, key: string, max = 30) => { if (v !== undefined && (typeof v !== 'string' || !v.trim() || v.length > max)) throw new ToolInputError(`Invalid ${key}.`); return v as string | undefined; };
const onlyId = (input: unknown, key: string) => { const { id, rest } = idArgs(input, key); objectArgs(rest, []); return id; };
const ROLES = ['admin', 'operator', 'auditor'];

@Injectable()
export class StaffAssistantTools {
  constructor(@InjectDataSource() private readonly db: DataSource, private readonly pending: PendingAdminOps,
    private readonly batches: BatchesService, private readonly events: EventsService, private readonly reports: ReportsService,
    private readonly custody: CustodyService, private readonly reweigh: ReweighService, private readonly requests: RequestsService,
    private readonly withdrawals: WithdrawalsService, private readonly payouts: PayoutsService, private readonly catalog: CatalogService,
    private readonly registry: RegistryService, private readonly materials: MaterialsService, private readonly materialRates: MaterialRatesService,
    private readonly creditRates: CreditRatesService, private readonly users: UsersService) {}

  async execute(name: string, input: unknown, actor: JwtPayload): Promise<unknown> {
    const spec = STAFF_TOOLS.find(t => t.tool.function.name === name);
    if (!spec) throw new ToolInputError('Unsupported tool');
    if (!TIERS[actor.role]?.includes(spec.tier)) throw new ToolInputError(`${name} needs ${spec.tier.startsWith('admin') ? 'an admin' : 'an operator or admin'} account; this account is ${actor.role}.`);
    return spec.tier === 'admin' ? this.prepareAdmin(name, input, actor) : this.run(name, input, actor);
  }

  /** Called only from the confirm route, i.e. by a human click — never by the model. */
  async confirm(opId: string, actor: JwtPayload) {
    // Role first, so a demoted admin's click does not consume the op.
    if (actor.role !== 'admin') throw new ForbiddenException('Only an admin can confirm admin changes.');
    const op = this.pending.take(opId, actor.sub);
    if (!op) throw new NotFoundException('This confirmation expired, was already used, or belongs to another admin. Ask the assistant again.');
    return { summary: op.summary, result: await this.runAdmin(op.tool, op.args, actor) };
  }

  private async prepareAdmin(name: string, input: unknown, actor: JwtPayload) {
    const args = this.adminArgs(name, input);
    const summary = await this.describe(name, args);
    if (summary.length > 180) throw new ToolInputError('This change is too long to show in one confirmation. Shorten the text fields or split it into separate changes.');
    const op = this.pending.create({ actorId: actor.sub, tool: name, args, summary });
    return { action: { kind: 'confirm-admin', id: op.id }, label: `Confirm: ${summary}`, status: 'Awaiting the admin’s Confirm click. Nothing has changed yet; do not report it as done.' };
  }

  private adminArgs(name: string, input: unknown): Record<string, any> {
    switch (name) {
      case 'create_hub': return dtoArgs(CreateHubDto, input);
      case 'create_material': return dtoArgs(CreateMaterialDto, input);
      case 'update_material': {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolInputError('Invalid tool arguments.');
        const { code, ...rest } = input as Record<string, unknown>;
        if (typeof code !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,15}$/.test(code)) throw new ToolInputError('code must be an existing material code.');
        const changes = dtoArgs(UpdateMaterialDto, rest);
        if (!Object.keys(changes).length) throw new ToolInputError('Say what to change about the material.');
        return { code: code.toUpperCase(), ...changes };
      }
      case 'create_material_rate': return dtoArgs(CreateMaterialRateDto, input);
      case 'create_credit_rate': return dtoArgs(CreateCreditRateDto, input);
      case 'create_catalog_item': return dtoArgs(CreateCatalogItemDto, input);
      case 'create_user': {
        const a = objectArgs(input, ['email', 'role']);
        if (typeof a.email !== 'string' || !isEmail(a.email)) throw new ToolInputError('Provide a valid email address.');
        if (!ROLES.includes(a.role as string)) throw new ToolInputError('role must be admin, operator or auditor.');
        return { email: a.email.toLowerCase(), role: a.role };
      }
      case 'update_user': {
        const { id: userId, rest } = idArgs(input, 'userId');
        const changes = dtoArgs(UpdateUserDto, rest);
        if (!Object.keys(changes).length) throw new ToolInputError('Say whether to change the role or active status.');
        return { userId, ...changes };
      }
      default: throw new ToolInputError('Unsupported admin operation');
    }
  }

  private async describe(name: string, a: Record<string, any>): Promise<string> {
    const where = a.hubId ? ` at ${await this.hubLabel(a.hubId)}` : ' at all hubs';
    const from = a.effectiveFrom ? ` from ${a.effectiveFrom}` : '';
    switch (name) {
      case 'create_hub': return `Create hub ${a.code} “${a.name}”`;
      case 'create_material': return `Add material ${String(a.code).toUpperCase()} “${a.name}”`;
      case 'update_material': { const { code, ...changes } = a; return `Update material ${code}: ${JSON.stringify(changes)}`; }
      case 'create_material_rate': return `Set ${a.materialCode} collector rate to ${a.ratePerKg}/kg${where}${from}`;
      case 'create_credit_rate': return `Set ${a.materialCode} credit rate to ${a.creditsPerKg} credits/kg${where}${from}`;
      case 'create_catalog_item': return `Add reward “${a.name}” (${a.category}) for ${a.costCredits} credits${a.stock !== undefined ? `, stock ${a.stock}` : ''}`;
      case 'create_user': return `Create ${a.role} account ${a.email}`;
      case 'update_user': {
        const user = await this.users.findOne(a.userId);
        return `Change ${user.email}:${a.role ? ` role → ${a.role}` : ''}${a.active === undefined ? '' : a.active ? ' reactivate' : ' deactivate'}`;
      }
      default: throw new ToolInputError('Unsupported admin operation');
    }
  }

  private async hubLabel(hubId: string) {
    const hub = await this.db.manager.findOne(HubEntity, { where: { id: hubId } });
    if (!hub) throw new ToolInputError('Unknown hub; use list_hubs.');
    return `${hub.name} (${hub.code})`;
  }

  private async runAdmin(name: string, a: Record<string, any>, actor: JwtPayload): Promise<unknown> {
    switch (name) {
      case 'create_hub': return this.registry.createHub(a as CreateHubDto);
      case 'create_material': return this.materials.create(a as CreateMaterialDto);
      case 'update_material': { const { code, ...changes } = a; return this.materials.update(code, changes); }
      case 'create_material_rate': return this.materialRates.create(a as CreateMaterialRateDto);
      case 'create_credit_rate': return this.creditRates.create(a as CreateCreditRateDto);
      case 'create_catalog_item': return this.catalog.create(a as CreateCatalogItemDto);
      case 'create_user': {
        // Generated here so no password ever passes through the model.
        const temporaryPassword = randomBytes(12).toString('base64url');
        const user = await this.users.create({ email: a.email, role: a.role, password: temporaryPassword });
        return { user, temporaryPassword };
      }
      case 'update_user': { const { userId, ...changes } = a; return this.users.update(userId, changes, actor); }
      default: throw new ToolInputError('Unsupported admin operation');
    }
  }

  private async run(name: string, input: unknown, actor: JwtPayload): Promise<unknown> {
    switch (name) {
      case 'get_capabilities': objectArgs(input, []); return { role: actor.role, tools: toolsFor(actor.role).map(t => ({ name: t.function.name, description: t.function.description })), rules: 'Reads and operator actions run directly. Admin changes wait for the admin to click Confirm in the chat. Password resets, user deletion, material deletion and device revocation are done manually.' };
      case 'list_batches': { const a = objectArgs(input, ['status', 'limit']); if (a.status !== undefined && !BATCH_STATUSES.includes(a.status as BatchStatus)) throw new ToolInputError('Unknown batch status.'); return clip(await this.batches.list(a.status as BatchStatus | undefined), a.limit); }
      case 'get_batch': return this.batches.findOne(onlyId(input, 'batchId'));
      case 'get_batch_events': { const { id: batchId, rest } = idArgs(input, 'batchId'); const a = objectArgs(rest, ['limit']); return clip(await this.batches.eventsOf(batchId), a.limit); }
      case 'get_batch_report': return this.reports.buildAuditReport(onlyId(input, 'batchId'));
      case 'list_events': { const a = objectArgs(input, ['hubId', 'collectorId', 'batched', 'quarantined', 'hasPhoto', 'limit']); const n = lim(a.limit); return clip(await this.events.list({ hubId: optId(a.hubId, 'hubId'), collectorId: optId(a.collectorId, 'collectorId'), batched: optBool(a.batched, 'batched'), quarantined: optBool(a.quarantined, 'quarantined'), hasPhoto: optBool(a.hasPhoto, 'hasPhoto'), limit: n }), n); }
      case 'get_event': { const eventId = onlyId(input, 'eventId'); const [event, reweighs] = await Promise.all([this.events.findOne(eventId), this.reweigh.list(eventId)]); return { event, reweighs }; }
      case 'list_payouts': { const a = objectArgs(input, ['collectorId', 'limit']); return clip(await this.payouts.list(optId(a.collectorId, 'collectorId')), a.limit); }
      case 'get_payout': return this.payouts.findOne(onlyId(input, 'payoutId'));
      case 'list_hubs': objectArgs(input, []); return this.registry.listHubs();
      case 'list_materials': objectArgs(input, []); return this.materials.list();
      case 'list_credit_rates': { const a = objectArgs(input, ['materialCode', 'hubId', 'limit']); return clip(await this.creditRates.list({ materialCode: optStr(a.materialCode, 'materialCode', 16), hubId: optId(a.hubId, 'hubId') }), a.limit); }
      case 'open_screen': { const a = objectArgs(input, ['target']); if (!STAFF_SCREENS.includes(a.target as any)) throw new ToolInputError('Unsupported screen'); return { action: { kind: 'navigate', target: a.target }, label: `Open ${a.target}`, status: 'Offered; not opened yet.' }; }
      case 'list_requests': { const a = objectArgs(input, ['status', 'hubId', 'limit']); return clip(await this.requests.list({ status: optStr(a.status, 'status'), hubId: optId(a.hubId, 'hubId') }), a.limit); }
      case 'list_withdrawals': { const a = objectArgs(input, ['status', 'limit']); return clip(await this.withdrawals.list(optStr(a.status, 'status')), a.limit); }
      case 'list_collectors': { const a = objectArgs(input, ['limit']); return clip(await this.registry.listCollectors(), a.limit); }
      case 'list_devices': { const a = objectArgs(input, ['collectorId', 'limit']); return clip(await this.registry.listDevices(optId(a.collectorId, 'collectorId')), a.limit); }
      case 'list_reward_orders': { const a = objectArgs(input, ['status', 'limit']); return clip(await this.catalog.listRedemptions(optStr(a.status, 'status')), a.limit); }
      case 'list_material_rates': { const a = objectArgs(input, ['materialCode', 'hubId', 'limit']); return clip(await this.materialRates.list({ materialCode: optStr(a.materialCode, 'materialCode', 16), hubId: optId(a.hubId, 'hubId') }), a.limit); }
      case 'list_custody': return this.custody.list(onlyId(input, 'batchId'));
      case 'list_users': objectArgs(input, []); return this.users.list();
      case 'create_batch': { const d = dtoArgs(CreateBatchDto, input); return this.batches.create(d.hubId, d.material); }
      case 'add_batch_events': { const { id: batchId, rest } = idArgs(input, 'batchId'); return this.batches.addEvents(batchId, dtoArgs(AddEventsDto, rest).eventIds); }
      case 'remove_batch_event': { const { id: batchId, rest } = idArgs(input, 'batchId'); return this.batches.removeEvent(batchId, onlyId(rest, 'eventId')); }
      case 'seal_batch': return this.batches.seal(onlyId(input, 'batchId'));
      case 'advance_batch_status': { const { id: batchId, rest } = idArgs(input, 'batchId'); return this.batches.advanceStatus(batchId, dtoArgs(AdvanceStatusDto, rest).status); }
      case 'record_custody_transfer': { const { id: batchId, rest } = idArgs(input, 'batchId'); return this.custody.create(batchId, dtoArgs(CreateCustodyTransferDto, rest)); }
      case 'record_reweigh': { const { id: eventId, rest } = idArgs(input, 'eventId'); return this.reweigh.create(eventId, dtoArgs(RecordReweighDto, rest), actor.sub); }
      case 'assign_request': { const { id: requestId, rest } = idArgs(input, 'requestId'); return this.requests.assign(requestId, dtoArgs(AssignRequestDto, rest).collectorId); }
      case 'fulfill_request': { const { id: requestId, rest } = idArgs(input, 'requestId'); return this.requests.fulfill(requestId, dtoArgs(FulfillRequestDto, rest).eventId); }
      case 'cancel_request': return this.requests.cancel(onlyId(input, 'requestId'));
      case 'mark_withdrawal_paid': { const { id: withdrawalId, rest } = idArgs(input, 'withdrawalId'); return this.withdrawals.markPaid(withdrawalId, dtoArgs(MarkWithdrawalPaidDto, rest).payoutRef, actor.sub); }
      case 'reject_withdrawal': return this.withdrawals.reject(onlyId(input, 'withdrawalId'));
      case 'create_payout': { const d = dtoArgs(CreatePayoutDto, input); return this.payouts.create(d.collectorId, d.eventReweighIds, d.method); }
      case 'mark_payout_paid': { const { id: payoutId, rest } = idArgs(input, 'payoutId'); return this.payouts.markPaid(payoutId, dtoArgs(MarkPayoutPaidDto, rest).payoutRef, actor.sub); }
      case 'fulfill_reward_order': return this.catalog.fulfill(onlyId(input, 'redemptionId'), actor.sub);
      case 'create_collector': return this.registry.createCollector(dtoArgs(CreateCollectorDto, input));
      case 'enrol_device': return this.registry.enrolDevice(dtoArgs(EnrolDeviceDto, input));
      default: throw new ToolInputError('Unsupported tool');
    }
  }
}
