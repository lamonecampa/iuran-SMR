/**
 * SMR-ONE authentication backend.
 * Deploy as an Apps Script Web App. Bind this project to the private Google Sheet.
 * Never publish this script's Script Properties or share the spreadsheet publicly.
 */
const CFG = {
  USERS: 'USERS',
  RESIDENTS: 'RESIDENTS',
  AUDIT: 'AUDIT_LOG',
  SESSION_TTL: 21600,
  PASSWORD_ITERATIONS: 120000,
  MIN_PASSWORD_LENGTH: 12
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('SMR-ONE | Portal Warga')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Run once from the Apps Script editor after binding this project to a private spreadsheet. */
function initializeSmrDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Buka Apps Script dari Extensions > Apps Script pada Google Spreadsheet.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SMR_SPREADSHEET_ID', ss.getId());
  ensureSheet_(ss, CFG.USERS, ['user_id','username','role','resident_id','password_salt','password_hash','phone','status','created_at','updated_at','must_change_password']);
  ensureSheet_(ss, CFG.RESIDENTS, ['resident_id','kavling','nama','phone','status','created_at','updated_at']);
  ensureSheet_(ss, CFG.AUDIT, ['event_id','actor_user_id','action','target_id','details','created_at']);
  return {ok:true, spreadsheetId:ss.getId(), sheets:[CFG.USERS,CFG.RESIDENTS,CFG.AUDIT]};
}

/**
 * One-time bootstrap. Before running, set these Script Properties in Project Settings:
 * BOOTSTRAP_USERNAME, BOOTSTRAP_PASSWORD, BOOTSTRAP_NAME, BOOTSTRAP_PHONE.
 * This function removes the temporary bootstrap properties after success.
 */
function bootstrapSuperAdmin() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const ss = db_();
    const sh = ss.getSheetByName(CFG.USERS);
    const rows = rows_(sh);
    if (rows.some(r => r.role === 'SUPER_ADMIN')) throw new Error('Super Admin sudah ada. Bootstrap hanya dapat dilakukan sekali.');
    const p = PropertiesService.getScriptProperties();
    const username = String(p.getProperty('BOOTSTRAP_USERNAME') || '').trim().toLowerCase();
    const password = String(p.getProperty('BOOTSTRAP_PASSWORD') || '');
    const name = String(p.getProperty('BOOTSTRAP_NAME') || 'Administrator SMR-ONE').trim();
    const phone = normalizePhone_(p.getProperty('BOOTSTRAP_PHONE') || '');
    if (!/^[a-z0-9._-]{4,32}$/.test(username)) throw new Error('BOOTSTRAP_USERNAME harus 4-32 karakter: huruf kecil, angka, titik, garis bawah, atau strip.');
    validatePassword_(password);
    if (!phone) throw new Error('BOOTSTRAP_PHONE wajib diisi dengan format 628xxxxxxxxxx.');
    const salt = Utilities.getUuid().replace(/-/g,'');
    const hash = passwordHash_(password, salt);
    const now = new Date();
    sh.appendRow([id_('USR'),username,'SUPER_ADMIN','',salt,hash,phone,'ACTIVE',now,now,false]);
    audit_('', 'BOOTSTRAP_SUPER_ADMIN', username, 'Super Admin dibuat');
    ['BOOTSTRAP_USERNAME','BOOTSTRAP_PASSWORD','BOOTSTRAP_NAME','BOOTSTRAP_PHONE'].forEach(k=>p.deleteProperty(k));
    return {ok:true,message:'Super Admin berhasil dibuat. Simpan username dan password di tempat aman.'};
  } finally { lock.releaseLock(); }
}

function login(username, password) {
  username = String(username || '').trim().toLowerCase();
  password = String(password || '');
  if (!username || !password) throw new Error('Username dan password wajib diisi.');
  const cache = CacheService.getScriptCache();
  const throttleKey = 'login_' + sha256_(username).slice(0,32);
  const attempts = Number(cache.get(throttleKey) || 0);
  if (attempts >= 8) throw new Error('Terlalu banyak percobaan login. Coba lagi setelah 15 menit.');
  const user = rows_(db_().getSheetByName(CFG.USERS)).find(r => r.username === username);
  if (!user || user.status !== 'ACTIVE' || !safeEqual_(passwordHash_(password, user.password_salt || ''), user.password_hash || '')) {
    cache.put(throttleKey, String(attempts + 1), 900);
    throw new Error('Username atau password tidak valid.');
  }
  cache.remove(throttleKey);
  const token = Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
  const session = {user_id:user.user_id, username:user.username, role:user.role, resident_id:user.resident_id || '', issued_at:Date.now()};
  cache.put('session_' + sha256_(token), JSON.stringify(session), CFG.SESSION_TTL);
  audit_(user.user_id, 'LOGIN', user.user_id, 'Login berhasil');
  return {ok:true,token:token,user:{username:user.username,role:user.role,resident_id:user.resident_id || '',must_change_password:user.must_change_password === true || String(user.must_change_password)==='TRUE'}};
}

function logout(token) {
  const session = session_(token);
  CacheService.getScriptCache().remove('session_' + sha256_(token));
  if (session) audit_(session.user_id,'LOGOUT',session.user_id,'Logout');
  return {ok:true};
}

/** Admin-only: create one resident and exactly one account for the kavling. */
function adminCreateResident(token, input) {
  const actor = requireRole_(token, ['SUPER_ADMIN']);
  input = input || {};
  const kavling = normalizeKavling_(input.kavling);
  const nama = String(input.nama || '').trim();
  const phone = normalizePhone_(input.phone);
  const username = String(input.username || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!kavling || !nama || !phone) throw new Error('Kavling, nama, dan nomor WhatsApp wajib diisi.');
  if (!/^[a-z0-9._-]{4,32}$/.test(username)) throw new Error('Username harus 4-32 karakter dan hanya berisi huruf kecil, angka, titik, _ atau -.');
  validatePassword_(password);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const ss = db_(), residents = ss.getSheetByName(CFG.RESIDENTS), users = ss.getSheetByName(CFG.USERS);
    const rr = rows_(residents), ur = rows_(users);
    if (rr.some(r => String(r.kavling).toUpperCase() === kavling)) throw new Error('Nomor kavling sudah terdaftar.');
    if (ur.some(r => r.username === username)) throw new Error('Username sudah digunakan.');
    if (ur.some(r => r.resident_id && rr.find(x=>x.resident_id===r.resident_id && String(x.kavling).toUpperCase()===kavling))) throw new Error('Kavling sudah memiliki akun.');
    const residentId = id_('RES'), userId = id_('USR'), now = new Date(), salt = Utilities.getUuid().replace(/-/g,'');
    residents.appendRow([residentId,kavling,nama,phone,'ACTIVE',now,now]);
    users.appendRow([userId,username,'WARGA',residentId,salt,passwordHash_(password,salt),phone,'ACTIVE',now,now,true]);
    audit_(actor.user_id,'CREATE_RESIDENT_ACCOUNT',residentId,'Kavling '+kavling+'; username '+username);
    return {ok:true,resident_id:residentId,username:username,message:'Akun warga berhasil dibuat. Minta warga mengganti password saat pertama kali login.'};
  } finally { lock.releaseLock(); }
}

/** Admin-only resident directory. Password hashes are never returned. */
function adminListResidents(token) {
  requireRole_(token,['SUPER_ADMIN']);
  const ss=db_(), rr=rows_(ss.getSheetByName(CFG.RESIDENTS)), ur=rows_(ss.getSheetByName(CFG.USERS));
  return rr.map(r=>{
    const u=ur.find(x=>x.resident_id===r.resident_id);
    return {resident_id:r.resident_id,kavling:r.kavling,nama:r.nama,phone:r.phone,status:r.status,username:u?u.username:'(belum ada akun)'};
  }).sort((a,b)=>String(a.kavling).localeCompare(String(b.kavling),undefined,{numeric:true}));
}

function getMyProfile(token) {
  const s=requireRole_(token,['SUPER_ADMIN','WARGA']);
  const u=rows_(db_().getSheetByName(CFG.USERS)).find(r=>r.user_id===s.user_id);
  if(!u) throw new Error('Akun tidak ditemukan.');
  if(s.role==='SUPER_ADMIN') return {username:u.username,role:u.role,phone:u.phone||'',nama:'Administrator SMR-ONE'};
  const r=rows_(db_().getSheetByName(CFG.RESIDENTS)).find(x=>x.resident_id===s.resident_id);
  if(!r) throw new Error('Data kavling tidak ditemukan.');
  return {username:u.username,role:u.role,phone:r.phone||u.phone||'',nama:r.nama,kavling:r.kavling,resident_id:r.resident_id};
}

/** User may update only their own phone number. */
function updateMyPhone(token, newPhone) {
  const s=requireRole_(token,['SUPER_ADMIN','WARGA']);
  const phone=normalizePhone_(newPhone);
  if(!phone) throw new Error('Gunakan format nomor Indonesia 628xxxxxxxxxx.');
  const ss=db_(), users=ss.getSheetByName(CFG.USERS), u=findRow_(users,'user_id',s.user_id);
  if(!u) throw new Error('Akun tidak ditemukan.');
  users.getRange(u.row,7).setValue(phone); users.getRange(u.row,10).setValue(new Date());
  if(s.role==='WARGA') {
    const residents=ss.getSheetByName(CFG.RESIDENTS), r=findRow_(residents,'resident_id',s.resident_id);
    if(!r) throw new Error('Data warga tidak ditemukan.');
    residents.getRange(r.row,4).setValue(phone); residents.getRange(r.row,7).setValue(new Date());
  }
  audit_(s.user_id,'UPDATE_OWN_PHONE',s.user_id,'Nomor HP diperbarui');
  return {ok:true,phone:phone};
}

function changeMyPassword(token, oldPassword, newPassword) {
  const s=requireRole_(token,['SUPER_ADMIN','WARGA']);
  validatePassword_(newPassword);
  const sh=db_().getSheetByName(CFG.USERS), found=findRow_(sh,'user_id',s.user_id);
  if(!found) throw new Error('Akun tidak ditemukan.');
  const r=found.data;
  if(!safeEqual_(passwordHash_(String(oldPassword||''),r.password_salt||''),r.password_hash||'')) throw new Error('Password lama tidak sesuai.');
  const salt=Utilities.getUuid().replace(/-/g,'');
  sh.getRange(found.row,5).setValue(salt); sh.getRange(found.row,6).setValue(passwordHash_(newPassword,salt));
  sh.getRange(found.row,10).setValue(new Date()); sh.getRange(found.row,11).setValue(false);
  audit_(s.user_id,'CHANGE_PASSWORD',s.user_id,'Password diganti');
  return {ok:true};
}

function setResidentStatus(token, residentId, status) {
  const actor=requireRole_(token,['SUPER_ADMIN']);
  if(!['ACTIVE','INACTIVE'].includes(status)) throw new Error('Status tidak valid.');
  const ss=db_(), r=findRow_(ss.getSheetByName(CFG.RESIDENTS),'resident_id',residentId);
  if(!r) throw new Error('Warga tidak ditemukan.');
  const u=findRow_(ss.getSheetByName(CFG.USERS),'resident_id',residentId);
  r.sheet.getRange(r.row,5).setValue(status); r.sheet.getRange(r.row,7).setValue(new Date());
  if(u){u.sheet.getRange(u.row,8).setValue(status);u.sheet.getRange(u.row,10).setValue(new Date());}
  audit_(actor.user_id,'SET_RESIDENT_STATUS',residentId,status);
  return {ok:true};
}

function session_(token) {
  if(!token || typeof token!=='string' || token.length<40) return null;
  const raw=CacheService.getScriptCache().get('session_'+sha256_(token));
  if(!raw) return null;
  try { return JSON.parse(raw); } catch(e) { return null; }
}
function requireRole_(token, roles) {
  const s=session_(token);
  if(!s) throw new Error('Sesi berakhir. Silakan login kembali.');
  if(!roles.includes(s.role)) throw new Error('Anda tidak memiliki hak akses untuk tindakan ini.');
  return s;
}
function db_() {
  const id=PropertiesService.getScriptProperties().getProperty('SMR_SPREADSHEET_ID');
  if(!id) throw new Error('Database belum diinisialisasi. Jalankan initializeSmrDatabase().');
  return SpreadsheetApp.openById(id);
}
function ensureSheet_(ss,name,headers) {
  let sh=ss.getSheetByName(name); if(!sh) sh=ss.insertSheet(name);
  if(sh.getLastRow()===0) sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.setFrozenRows(1); sh.getRange(1,1,1,headers.length).setFontWeight('bold');
  return sh;
}
function rows_(sh) {
  if(!sh || sh.getLastRow()<2) return [];
  const values=sh.getDataRange().getValues(), headers=values.shift();
  return values.filter(r=>r.some(v=>v!=='' && v!==null)).map(r=>headers.reduce((o,h,i)=>(o[h]=r[i] instanceof Date?r[i].toISOString():r[i],o),{}));
}
function findRow_(sh,key,value) {
  const values=sh.getDataRange().getValues(); if(values.length<2) return null;
  const headers=values[0], ix=headers.indexOf(key); if(ix<0)return null;
  for(let i=1;i<values.length;i++) if(String(values[i][ix])===String(value)) return {sheet:sh,row:i+1,data:headers.reduce((o,h,j)=>(o[h]=values[i][j],o),{})};
  return null;
}
function audit_(actor,action,target,details) {
  const sh=db_().getSheetByName(CFG.AUDIT);
  sh.appendRow([id_('LOG'),actor,action,target,String(details||''),new Date()]);
}
function id_(prefix){return prefix+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,12).toUpperCase();}
function normalizeKavling_(v){const s=String(v||'').trim().toUpperCase().replace(/\s+/g,'');return /^KAV-\d{1,4}$/.test(s)?s:'';}
function normalizePhone_(v){let s=String(v||'').replace(/[\s()+.-]/g,'');if(s.startsWith('0'))s='62'+s.slice(1);if(s.startsWith('8'))s='62'+s;return /^628\d{7,12}$/.test(s)?s:'';}
function validatePassword_(p){if(String(p||'').length<CFG.MIN_PASSWORD_LENGTH)throw new Error('Password minimal '+CFG.MIN_PASSWORD_LENGTH+' karakter.');}
function sha256_(s){return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s),Utilities.Charset.UTF_8));}
function toHex_(bytes){return bytes.map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('');}
function safeEqual_(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}

/** PBKDF2-HMAC-SHA256, 120,000 rounds, one 32-byte block. */
function passwordHash_(password,saltHex) {
  if(!saltHex) return '';
  const passwordBytes=Utilities.newBlob(String(password)).getBytes();
  const saltBytes=hexBytes_(saltHex).concat([0,0,0,1]);
  let u=Utilities.computeHmacSha256Signature(saltBytes,passwordBytes), t=u.slice();
  for(let i=1;i<CFG.PASSWORD_ITERATIONS;i++){
    u=Utilities.computeHmacSha256Signature(u,passwordBytes);
    for(let j=0;j<t.length;j++) t[j]=(t[j]^u[j]);
  }
  return toHex_(t);
}
function hexBytes_(hex){const a=[];for(let i=0;i<hex.length;i+=2){let n=parseInt(hex.substr(i,2),16);a.push(n>127?n-256:n);}return a;}
