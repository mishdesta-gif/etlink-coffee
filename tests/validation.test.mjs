import { test } from 'node:test';
import assert from 'node:assert/strict';
import { field,email,uuid,password,integer,validateDocument,documentHash,validateStoredDocument } from '../src/lib/foundation/validation.ts';
test('server validation rejects malformed and oversized data',()=>{
  assert.throws(()=>email('person@example.test\r\nBcc:other@example.test'));
  assert.throws(()=>uuid("x' or true"));assert.throws(()=>password('short'));assert.throws(()=>integer('1.5'));
  const f=new FormData();f.set('name','\0bad');assert.throws(()=>field(f,'name'));
  assert.equal(email('Person@Example.Test'),'person@example.test');
  assert.equal(password('  this password stays padded  '),'  this password stays padded  ');
});
test('stored byte validation rejects tampering, MIME/size mismatch and spoofed signatures',async()=>{
  const bytes=new TextEncoder().encode('%PDF-1.7\n Synthetic stored verification');
  const sha256=await documentHash(bytes);const expected={mime:'application/pdf',bytes:bytes.length,sha256};
  await validateStoredDocument(new Blob([bytes],{type:'application/pdf'}),expected);
  const changed=new Uint8Array(bytes);changed[changed.length-1]^=1;
  await assert.rejects(()=>validateStoredDocument(new Blob([changed],{type:'application/pdf'}),expected));
  await assert.rejects(()=>validateStoredDocument(new Blob([bytes],{type:'image/jpeg'}),expected));
  await assert.rejects(()=>validateStoredDocument(new Blob([bytes],{type:'application/pdf'}),{...expected,bytes:bytes.length+1}));
  const html=new TextEncoder().encode('<script>synthetic</script>');
  const htmlHash=await documentHash(html);
  await assert.rejects(()=>validateStoredDocument(new Blob([html],{type:'application/pdf'}),{mime:'application/pdf',bytes:html.length,sha256:htmlHash}));
});
test('document validation rejects MIME spoofing, active HTML and oversized files',()=>{
  assert.throws(()=>validateDocument(new TextEncoder().encode('<script>alert(1)</script>'),'application/pdf'));
  assert.throws(()=>validateDocument(new Uint8Array(5242881),'image/png'));
  assert.throws(()=>validateDocument(new Uint8Array([]),'application/pdf'));
  validateDocument(new TextEncoder().encode('%PDF-1.7\n synthetic'),'application/pdf');
  validateDocument(new Uint8Array([137,80,78,71,13,10,26,10]),'image/png');
});
