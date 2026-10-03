export const SCHEMA_VERSION = 1;
export const ENTRY_KINDS = ["expense", "income", "refund", "transfer", "adjustment"];
export const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
export const dayAt = (value) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(value));
export const yen = (n) => n === null || n === undefined ? "未設定" : new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(n);
export const clone = (value) => structuredClone(value);

export function integer(n, label = "金額") {
  if (!Number.isSafeInteger(n)) throw new Error(`${label}は整数の円で指定してください`);
  return n;
}
export function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) throw new Error("日付を確認してください");
  return value;
}
export function shortText(value, max = 300) {
  if (typeof value !== "string" || value.length > max) throw new Error("入力文字数を確認してください");
  return value.trim();
}
export function validateAccount(a) {
  if (!a || !/^[\w-]{1,80}$/.test(a.id) || !["bank", "cash", "credit"].includes(a.type)) throw new Error("口座の種類・IDを確認してください");
  shortText(a.name, 80);
  if (!a.name.trim()) throw new Error("口座の呼び名が必要です");
  if (a.openingBalanceYen !== null) integer(a.openingBalanceYen);
  date(a.openingDate);
  if (a.withdrawalDay !== null && a.withdrawalDay !== undefined && ![10,26].includes(a.withdrawalDay)) throw new Error("引落日は10日または26日を指定してください");
  return a;
}
export function validateTransaction(t, accounts) {
  if (!t || !ENTRY_KINDS.includes(t.kind)) throw new Error("取引の種類を確認してください");
  date(t.date);
  if ((t.currency ?? "JPY") !== "JPY") throw new Error("この版は日本円に対応しています。外貨は円換算額を確認してください");
  const account = accounts.find(a => a.id === t.accountId);
  if (!account) throw new Error("対象口座を選んでください");
  shortText(t.merchant ?? "", 160); shortText(t.category ?? "", 80); shortText(t.note ?? "", 1000);
  if (t.kind === "adjustment") {
    integer(t.adjustmentYen);
    if (!t.adjustmentYen) throw new Error("調整額は0円以外を指定してください");
    if (!(t.note ?? "").trim()) throw new Error("残高調整の理由が必要です");
  } else {
    integer(t.amountYen);
    if (t.amountYen <= 0) throw new Error("金額は正の整数を指定してください");
  }
  if (t.kind === "transfer") {
    if (t.accountId === t.toAccountId || !accounts.some(a => a.id === t.toAccountId)) throw new Error("振替先を確認してください");
  }
  return t;
}
export function validateObservation(o, accounts) {
  if (!o || !accounts.some(a => a.id === o.accountId)) throw new Error("残高を確認した口座を選んでください");
  integer(o.balanceYen);
  if (typeof o.observedAt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(o.observedAt) || !Number.isFinite(Date.parse(o.observedAt))) throw new Error("残高の確認日時・タイムゾーンを指定してください");
  if (![true,false,null,undefined].includes(o.withdrawalConfirmed)) throw new Error("引落反映の確認値が不正です");
  shortText(o.note ?? "", 1000);
  return o;
}
export function entryState(e) { return e.pending ? "pending" : e.settled ? "approved" : "rejected"; }
export function selectedTransaction(e, includePending = false) { return includePending ? e.pending?.data ?? e.settled?.data : e.settled?.data; }
export function effect(t, accountId) {
  let amount = 0;
  if (t.accountId === accountId) {
    if (t.kind === "expense" || t.kind === "transfer") amount -= t.amountYen;
    if (t.kind === "income" || t.kind === "refund") amount += t.amountYen;
    if (t.kind === "adjustment") amount += t.adjustmentYen;
  }
  if (t.kind === "transfer" && t.toAccountId === accountId) amount += t.amountYen;
  return amount;
}
export function balanceAt(data, accountId, until = today(), includePending = false, excludeEntryId = null) {
  const a = data.accounts.find(a => a.id === accountId);
  if (!a || a.openingBalanceYen === null || until < a.openingDate) return null;
  let total = a.openingBalanceYen;
  for (const e of data.entries) {
    if (e.id === excludeEntryId) continue;
    const t = selectedTransaction(e, includePending);
    if (t && t.date >= a.openingDate && t.date <= until) total = integer(total + effect(t, accountId));
  }
  return total;
}
export function monthlySummary(data, month, includePending = false) {
  let expenseYen = 0, incomeYen = 0, refundYen = 0;
  const categories = new Map();
  for (const e of data.entries) {
    const t = selectedTransaction(e, includePending);
    if (!t || t.date.slice(0, 7) !== month) continue;
    if (t.kind === "expense") expenseYen = integer(expenseYen + t.amountYen);
    if (t.kind === "income") incomeYen = integer(incomeYen + t.amountYen);
    if (t.kind === "refund") refundYen = integer(refundYen + t.amountYen);
    if (t.kind === "expense" || t.kind === "refund") {
      const key = t.category || "未分類";
      categories.set(key, integer((categories.get(key) ?? 0) + (t.kind === "expense" ? t.amountYen : -t.amountYen)));
    }
  }
  return { month, expenseYen, incomeYen, refundYen, netExpenseYen: integer(expenseYen - refundYen), categories: Array.from(categories, ([name,amountYen]) => ({name,amountYen})).sort((a,b) => b.amountYen-a.amountYen) };
}
export function compareObservation(data, o) {
  const expectedYen = balanceAt(data, o.accountId, dayAt(o.observedAt));
  return { expectedYen, observedYen: o.balanceYen, differenceYen: expectedYen === null ? null : integer(o.balanceYen - expectedYen), date: dayAt(o.observedAt), precision: "day" };
}
export function audit(data, action, entityId, before, after) {
  data.audit.push({ id: crypto.randomUUID(), at: new Date().toISOString(), action, entityId, before: clone(before ?? null), after: clone(after ?? null) });
}
export function proposeTransaction(data, t, options = {}) {
  validateTransaction(t, data.accounts);
  const sourceKey = options.sourceKey ?? null;
  const existing = options.entryId ? data.entries.find(e => e.id === options.entryId) : sourceKey ? data.entries.find(e => e.sourceKey === sourceKey) : null;
  if (options.entryId && !existing) throw new Error("修正対象が見つかりません");
  if (!existing && sourceKey && data.processed.some(p => p.sourceKey === sourceKey)) return { duplicate:true };
  if (existing && JSON.stringify(t) === JSON.stringify(existing.pending?.data ?? existing.settled?.data)) return { id:existing.id, duplicate:true };
  const entry = existing ?? { id:crypto.randomUUID(), sourceKey, settled:null, pending:null, rejectedAt:null };
  const before = clone(existing);
  entry.pending = { data:clone(t), proposedAt:new Date().toISOString(), source:clone(options.source ?? null) };
  if (!existing) data.entries.push(entry);
  audit(data, existing ? "propose_revision" : "propose_transaction", entry.id, before, entry);
  return { id:entry.id, duplicate:false };
}
export function approveEntry(data, id) {
  const e = data.entries.find(e => e.id === id);
  if (!e?.pending) throw new Error("承認待ちの取引がありません");
  const t = e.pending.data;
  validateTransaction(t, data.accounts);
  if (t.observationId) {
    const o = data.observations.find(o => o.id === t.observationId && o.status === "approved");
    if (!o || balanceAt(data, t.accountId, dayAt(o.observedAt), false, e.id) !== t.basisBalanceYen) throw new Error("記録が変わっています。残高を再照合して修正案を作り直してください");
  }
  const before = clone(e);
  e.settled = { data:clone(t), approvedAt:new Date().toISOString() };
  e.pending = null;
  audit(data,"approve_transaction",id,before,e);
}
export function rejectEntry(data, id) {
  const e = data.entries.find(e => e.id === id);
  if (!e?.pending) throw new Error("承認待ちの取引がありません");
  const before = clone(e); e.pending = null; e.rejectedAt = new Date().toISOString();
  audit(data,"reject_proposal",id,before,e);
}
export function recordObservation(data, value, sourceKey = null) {
  validateObservation(value,data.accounts);
  if (sourceKey && data.processed.some(p => p.sourceKey === sourceKey)) return { duplicate:true };
  const o = { ...clone(value), id:crypto.randomUUID(), status:"pending", sourceKey, proposedAt:new Date().toISOString() };
  data.observations.push(o); audit(data,"propose_observation",o.id,null,o);
  return { id:o.id, duplicate:false };
}
export function approveObservation(data, id) {
  const o = data.observations.find(o => o.id === id && o.status === "pending");
  if (!o) throw new Error("確認待ちの残高がありません");
  const before=clone(o); o.status="approved"; o.approvedAt=new Date().toISOString(); audit(data,"approve_observation",id,before,o);
}
export function adjustmentProposal(data, observationId) {
  const o=data.observations.find(o => o.id===observationId && o.status === "approved");
  if (!o) throw new Error("実残高を先に確認・承認してください");
  const comparison=compareObservation(data,o);
  if (comparison.differenceYen === null) throw new Error("先に基準残高を設定してください");
  if (comparison.differenceYen===0) throw new Error("残高は一致しています");
  if (data.entries.some(e=>e.pending?.data.observationId===o.id)) throw new Error("この残高の修正案はすでにあります");
  return proposeTransaction(data, {kind:"adjustment",date:comparison.date,accountId:o.accountId,currency:"JPY",adjustmentYen:comparison.differenceYen,merchant:"残高調整",category:"",note:`実残高との照合による調整。原因・当日の入出金を確認してから承認してください。${o.note ?? ""}`,observationId:o.id,basisBalanceYen:comparison.expectedYen});
}
export function importDraft(data, draft) {
  if (!draft || typeof draft.id!=="string" || typeof draft.sourceKey!=="string") throw new Error("入力候補の形式を確認してください");
  if (data.processed.some(p=>p.id===draft.id || p.sourceKey===draft.sourceKey)) return {duplicate:true};
  let result;
  if (draft.type==="transaction") result=proposeTransaction(data,draft.payload,{sourceKey:draft.sourceKey,source:draft.source});
  else if(draft.type==="balance_observation") result=recordObservation(data,draft.payload,draft.sourceKey);
  else throw new Error("入力候補の種類を確認してください");
  data.processed.push({id:draft.id,sourceKey:draft.sourceKey,at:new Date().toISOString()});
  return result;
}
export function initialData() {
  const d=today();
  return { schemaVersion:SCHEMA_VERSION,meta:{ledgerId:crypto.randomUUID(),revision:0},accounts:[
    {id:"bank-main",name:"銀行口座",type:"bank",openingBalanceYen:null,openingDate:d,withdrawalDay:null},
    {id:"cash-wallet",name:"財布",type:"cash",openingBalanceYen:null,openingDate:d,withdrawalDay:null},
    {id:"card-10",name:"カード（10日引落）",type:"credit",openingBalanceYen:null,openingDate:d,withdrawalDay:10},
    {id:"card-26",name:"カード（26日引落）",type:"credit",openingBalanceYen:null,openingDate:d,withdrawalDay:26}
  ],entries:[],observations:[],audit:[],processed:[] };
}
export function validateSnapshot(data) {
  if (!data || data.schemaVersion!==SCHEMA_VERSION || !data.meta || typeof data.meta.ledgerId!=="string") throw new Error("対応する家計簿バックアップではありません");
  integer(data.meta.revision,"版番号"); if(data.meta.revision<0)throw new Error("版番号が不正です");
  for(const key of ["accounts","entries","observations","audit","processed"])if(!Array.isArray(data[key]))throw new Error("バックアップが不完全です");
  const seen=new Set();
  for(const a of data.accounts){validateAccount(a);if(seen.has(a.id))throw new Error("口座IDが重複しています");seen.add(a.id);}
  for(const e of data.entries){if(typeof e.id!=="string")throw new Error("取引IDが不正です");if(e.pending)validateTransaction(e.pending.data,data.accounts);if(e.settled)validateTransaction(e.settled.data,data.accounts);}
  for(const o of data.observations){validateObservation(o,data.accounts);if(!["pending","approved","rejected"].includes(o.status))throw new Error("残高の状態が不正です");}
  for(const key of ["entries","observations","audit","processed"]){const ids=new Set();for(const x of data[key]){if(typeof x.id!=="string" || ids.has(x.id))throw new Error("レコードIDが不正または重複しています");ids.add(x.id);}}
  return data;
}
