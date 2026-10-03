import test from "node:test";
import assert from "node:assert/strict";
import {newBackupKey,encryptSnapshot,decryptSnapshot} from "../web/crypto.js";
import {initialData} from "../web/core.js";
test("encrypted backups restore exactly and reject a wrong password or tampering",async()=>{
  const data=initialData(),pass="a-long-test-passphrase",key=await newBackupKey(pass),a=await encryptSnapshot(data,key),b=await encryptSnapshot(data,key);
  assert.notEqual(a.iv,b.iv);assert.equal(JSON.stringify(a).includes("銀行口座"),false);
  assert.deepEqual((await decryptSnapshot(a,pass)).data,data);
  await assert.rejects(decryptSnapshot(a,"another-test-password"),/パスフレーズ/);
  const changed={...a,ciphertext:(a.ciphertext[0]==="A"?"B":"A")+a.ciphertext.slice(1)};await assert.rejects(decryptSnapshot(changed,pass),/破損/);
  await assert.rejects(decryptSnapshot({...a,revision:a.revision+1},pass),/破損/);
});
