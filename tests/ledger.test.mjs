import test from "node:test";
import assert from "node:assert/strict";
import * as c from "../web/core.js";
function ledger(){const d=c.initialData();for(const a of d.accounts){a.openingDate="2026-10-01";a.openingBalanceYen=a.type==="bank"?10000:0;}return d;}
const purchase=(amountYen=1000)=>({kind:"expense",date:"2026-10-03",accountId:"card-10",amountYen,merchant:"店舗",category:"食費",currency:"JPY"});
test("a card purchase and its bank settlement count as one expense",()=>{
  const d=ledger();const e=c.proposeTransaction(d,purchase()).id;
  assert.equal(c.monthlySummary(d,"2026-10").expenseYen,0);c.approveEntry(d,e);
  const transfer=c.proposeTransaction(d,{kind:"transfer",date:"2026-10-10",accountId:"bank-main",toAccountId:"card-10",amountYen:1000}).id;c.approveEntry(d,transfer);
  assert.equal(c.monthlySummary(d,"2026-10").expenseYen,1000);assert.equal(c.balanceAt(d,"bank-main","2026-10-10"),9000);assert.equal(c.balanceAt(d,"card-10","2026-10-10"),0);
});
test("editing an approved transaction preserves the confirmed amount until approval",()=>{
  const d=ledger(),id=c.proposeTransaction(d,purchase()).id;c.approveEntry(d,id);c.proposeTransaction(d,purchase(2000),{entryId:id});
  assert.equal(c.monthlySummary(d,"2026-10").expenseYen,1000);assert.equal(c.monthlySummary(d,"2026-10",true).expenseYen,2000);
  c.rejectEntry(d,id);assert.equal(c.monthlySummary(d,"2026-10").expenseYen,1000);
  c.proposeTransaction(d,purchase(2000),{entryId:id});c.approveEntry(d,id);assert.equal(c.monthlySummary(d,"2026-10").expenseYen,2000);
});
test("a screenshot observation does not silently change the ledger",()=>{
  const d=ledger(),id=c.recordObservation(d,{accountId:"bank-main",balanceYen:8500,observedAt:"2026-10-10T20:00:00+09:00",withdrawalConfirmed:null}).id;
  assert.equal(c.balanceAt(d,"bank-main","2026-10-10"),10000);assert.equal(c.compareObservation(d,d.observations[0]).differenceYen,-1500);
  c.approveObservation(d,id);const adjustment=c.adjustmentProposal(d,id).id;assert.equal(c.balanceAt(d,"bank-main","2026-10-10"),10000);
  c.approveEntry(d,adjustment);assert.equal(c.balanceAt(d,"bank-main","2026-10-10"),8500);assert.equal(c.monthlySummary(d,"2026-10").expenseYen,0);
});
test("a correction cannot be approved using a stale balance comparison",()=>{
  const d=ledger(),observation=c.recordObservation(d,{accountId:"bank-main",balanceYen:8500,observedAt:"2026-10-10T20:00:00+09:00"}).id;c.approveObservation(d,observation);
  const adjustment=c.adjustmentProposal(d,observation).id,expense=c.proposeTransaction(d,{...purchase(500),accountId:"bank-main",date:"2026-10-09"}).id;c.approveEntry(d,expense);
  assert.throws(()=>c.approveEntry(d,adjustment),/再照合/);assert.equal(c.balanceAt(d,"bank-main","2026-10-10"),9500);
});
test("input retries and rejected source records are not reimported",()=>{
  const d=ledger(),draft={id:"mail-1",sourceKey:"gmail:mail-1:line-0",type:"transaction",payload:purchase()};
  const first=c.importDraft(d,draft);c.rejectEntry(d,first.id);assert.equal(c.importDraft(d,draft).duplicate,true);assert.equal(d.entries.length,1);
});
test("refunds reduce spending while transfers and corrections remain separate",()=>{
  const d=ledger();for(const p of [purchase(3000),{...purchase(500),kind:"refund"},{kind:"adjustment",date:"2026-10-03",accountId:"bank-main",adjustmentYen:100,note:"確認済みの残高調整"}])c.approveEntry(d,c.proposeTransaction(d,p).id);
  assert.equal(c.monthlySummary(d,"2026-10").netExpenseYen,2500);assert.equal(c.monthlySummary(d,"2026-10").incomeYen,0);
});
test("unknown opening balances remain unknown, and invalid monetary input is rejected",()=>{
  const d=c.initialData();assert.equal(c.balanceAt(d,"bank-main"),null);
  assert.throws(()=>c.proposeTransaction(d,purchase(0)),/正の整数/);assert.throws(()=>c.proposeTransaction(d,purchase(1.2)),/整数/);assert.throws(()=>c.proposeTransaction(d,purchase(Number.MAX_SAFE_INTEGER+1)),/整数/);
  assert.throws(()=>c.proposeTransaction(d,{...purchase(),currency:"USD"}),/日本円/);assert.throws(()=>c.validateSnapshot({...d,accounts:[...d.accounts,d.accounts[0]]}),/重複/);
});
