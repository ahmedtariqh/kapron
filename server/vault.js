const encoder = new TextEncoder();
function from64(s) { return Uint8Array.from(atob(s),c=>c.charCodeAt(0)); }
function to64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
async function importKey(secret) {
  const bytes=from64(secret);
  if(bytes.length!==32) throw new Error('Vault key must have 32 bytes.');
  return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function seal(secret, plaintext, identity) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await importKey(secret);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(identity)},key,encoder.encode(plaintext));
  return 'v1.'+to64(iv)+'.'+to64(encrypted);
}
export async function unseal(secret, ciphertext, identity) {
  const [version,iv,bytes]=ciphertext.split('.');
  if (version!=='v1') throw new Error('Unsupported vault key version.');
  const key=await importKey(secret);
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(iv),additionalData:encoder.encode(identity)},key,from64(bytes));
  return new TextDecoder().decode(decrypted);
}
