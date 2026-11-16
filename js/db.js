/* ===== KelasHub — Penyimpanan Lokal (localStorage + IndexedDB) ===== */
(() => {
  const PREFIX = 'kelashub_';
  const TABLES = [
    'profiles',
    'classes',
    'class_members',
    'courses',
    'tasks',
    'submissions',
    'materials',
    'material_likes'
  ];
  const SESSION_KEY = PREFIX + 'session';
  const IDB_NAME = 'kelashub_blob_store';
  const IDB_STORE = 'files';
  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

  /* ---------- Utilitas ID & Waktu ---------- */
  const genUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  };
  const nowISO = () => new Date().toISOString();

  const isQuotaErr = e =>
    e && (
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 ||
      e.code === 1014 ||
      /quota/i.test(e.message || '')
    );

  const quotaError = () =>
    new Error('Kuota penyimpanan browser penuh! Hapus beberapa tugas/materi lama atau lakukan Backup data terlebih dahulu.');

  /* ---------- Membaca & Menulis Tabel di localStorage ---------- */
  function readTable(name) {
    try {
      const raw = localStorage.getItem(PREFIX + name);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('Gagal membaca tabel ' + name, e);
      return [];
    }
  }

  function writeTable(name, rows) {
    try {
      localStorage.setItem(PREFIX + name, JSON.stringify(rows));
    } catch (e) {
      if (isQuotaErr(e)) throw quotaError();
      throw e;
    }
  }

  function ensureTables() {
    TABLES.forEach(t => {
      if (localStorage.getItem(PREFIX + t) === null) {
        writeTable(t, []);
      }
    });
  }

  /* ---------- Hashing Password (SHA-256 via crypto.subtle + salt) ---------- */
  function randomSalt(len = 16) {
    const arr = new Uint8Array(len);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback SHA-256 murni JS jika dibuka lewat file:// atau HTTP non-localhost di HP
  function sha256Fallback(ascii) {
    const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let result = '';
    const words = [];
    const asciiBitLength = ascii.length * 8;
    let hash = [];
    const k = [];
    let primeCounter = 0;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while ((ascii.length % 64) - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) {
      const j = ascii.charCodeAt(i);
      words[i >> 2] |= j << (((3 - i) % 4) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (let j = 0; j < words.length; ) {
      const w = words.slice(j, (j += 16));
      const oldHash = hash.slice(0);
      hash = hash.slice(0, 8);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 =
          hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] =
            i < 16
              ? w[i]
              : (w[i - 16] +
                  (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                  w[i - 7] +
                  (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
                0);
        const temp2 =
          (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (let i = 0; i < 8; i++) {
      for (let j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  async function hashPassword(password, salt) {
    const input = `${salt}:${password}`;
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      const buf = new TextEncoder().encode(input);
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }
    const utf8 = unescape(encodeURIComponent(input));
    return sha256Fallback(utf8);
  }

  /* ---------- Inisialisasi Akun Admin Awal ---------- */
  async function ensureDefaultAdmin() {
    ensureTables();
    const profiles = readTable('profiles');
    const hasAdmin = profiles.some(p => p.role === 'admin');
    if (!hasAdmin) {
      const salt = randomSalt(16);
      const password_hash = await hashPassword('admin123', salt);
      profiles.push({
        id: genUUID(),
        username: 'admin',
        name: 'Administrator',
        nim: '',
        role: 'admin',
        salt,
        password_hash,
        default_pw: true,
        created_at: nowISO()
      });
      writeTable('profiles', profiles);
    }
  }

  const INIT_PROMISE = ensureDefaultAdmin();

  /* ---------- Sesi & Helper Peran (Porting fungsi private.* dari SQL) ---------- */
  function getSessionSync() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function currentUid() {
    const s = getSessionSync();
    return s && s.user ? s.user.id : null;
  }

  function getProfile(uid) {
    if (!uid) return null;
    return readTable('profiles').find(p => p.id === uid) || null;
  }

  function isRole(uid, role) {
    const p = getProfile(uid);
    return !!p && p.role === role;
  }
  const isAdminUser = uid => isRole(uid, 'admin');
  const isDosenUser = uid => isRole(uid, 'dosen');
  const isMahasiswaUser = uid => isRole(uid, 'mahasiswa');

  function isMember(uid, classId) {
    if (!uid || !classId) return false;
    return readTable('class_members').some(m => m.class_id === classId && m.user_id === uid);
  }

  function sharesClass(uidA, uidB) {
    if (!uidA || !uidB) return false;
    const members = readTable('class_members');
    const classesA = new Set(members.filter(m => m.user_id === uidA).map(m => m.class_id));
    return members.some(m => m.user_id === uidB && classesA.has(m.class_id));
  }

  function teaches(uid, classId) {
    if (!uid || !classId) return false;
    return readTable('courses').some(c => c.class_id === classId && c.dosen_id === uid);
  }

  function teachesCourse(uid, courseId) {
    if (!uid || !courseId) return false;
    return readTable('courses').some(c => c.id === courseId && c.dosen_id === uid);
  }

  function teachesTask(uid, taskId) {
    if (!uid || !taskId) return false;
    const task = readTable('tasks').find(t => t.id === taskId);
    if (!task) return false;
    return teachesCourse(uid, task.course_id);
  }

  function stripSecret(profile) {
    if (!profile) return null;
    const { salt, password_hash, ...safe } = profile;
    return safe;
  }

  /* ---------- Filter RLS (Row Level Security) untuk SELECT ---------- */
  function filterSelect(table, rows, uid) {
    if (!uid) return [];
    switch (table) {
      case 'profiles':
        return rows
          .filter(r => r.id === uid || isAdminUser(uid) || sharesClass(uid, r.id))
          .map(stripSecret);
      case 'classes':
        return rows.filter(r => isAdminUser(uid) || isMember(uid, r.id));
      case 'class_members':
        return rows.filter(r => isAdminUser(uid) || isMember(uid, r.class_id));
      case 'courses':
        return rows.filter(r => isAdminUser(uid) || isMember(uid, r.class_id));
      case 'tasks':
        return rows.filter(r => isAdminUser(uid) || isMember(uid, r.class_id));
      case 'submissions':
        return rows.filter(r => r.user_id === uid || isAdminUser(uid) || teachesTask(uid, r.task_id));
      case 'materials':
        return rows.filter(r => isAdminUser(uid) || isMember(uid, r.class_id));
      case 'material_likes':
        return rows.filter(r => isAdminUser(uid) || isMember(uid, r.class_id));
      default:
        return rows;
    }
  }

  /* ---------- Relasi & Join Otomatis pada SELECT ---------- */
  function enrichRow(table, row, selectSpec, uid) {
    const out = { ...row };
    const spec = String(selectSpec || '*');

    if (table === 'classes') {
      if (spec.includes('class_members(count)')) {
        const count = filterSelect('class_members', readTable('class_members'), uid).filter(x => x.class_id === row.id).length;
        out.class_members = [{ count }];
      }
      if (spec.includes('courses(count)')) {
        const count = filterSelect('courses', readTable('courses'), uid).filter(x => x.class_id === row.id).length;
        out.courses = [{ count }];
      }
      if (spec.includes('tasks(count)')) {
        const count = filterSelect('tasks', readTable('tasks'), uid).filter(x => x.class_id === row.id).length;
        out.tasks = [{ count }];
      }
      if (spec.includes('materials(count)')) {
        const count = filterSelect('materials', readTable('materials'), uid).filter(x => x.class_id === row.id).length;
        out.materials = [{ count }];
      }
      if (spec.includes('submissions(count)')) {
        const count = filterSelect('submissions', readTable('submissions'), uid).filter(x => x.class_id === row.id).length;
        out.submissions = [{ count }];
      }
    }

    if (table === 'class_members' && spec.includes('profiles(')) {
      const p = stripSecret(readTable('profiles').find(x => x.id === row.user_id));
      out.profiles = p ? { name: p.name, username: p.username, nim: p.nim || '', role: p.role } : null;
    }

    if (table === 'tasks' && spec.includes('courses(')) {
      const c = readTable('courses').find(x => x.id === row.course_id);
      out.course = c ? { name: c.name, emoji: c.emoji, color: c.color } : null;
    }

    if (table === 'materials' && spec.includes('material_likes(')) {
      const likes = readTable('material_likes')
        .filter(l => l.material_id === row.id)
        .map(l => ({ user_id: l.user_id }));
      out.material_likes = likes;
    }

    return out;
  }

  /* ---------- Aturan Validasi, Trigger & Cascade per Tabel ---------- */
  function dupError(constraint) {
    const err = new Error(`duplicate key value violates unique constraint "${constraint}"`);
    err.code = '23505';
    return err;
  }

  function applyInsert(table, payload, uid) {
    if (!uid) throw new Error('Silakan masuk terlebih dahulu.');
    const items = Array.isArray(payload) ? payload : [payload];
    const rows = readTable(table);
    const inserted = [];

    for (const raw of items) {
      if (table === 'classes') {
        if (!isAdminUser(uid)) throw new Error('Hanya admin yang dapat membuat kelas.');
        const name = String(raw.name || '').trim();
        if (!name || name.length > 40) throw new Error('Nama kelas harus 1–40 karakter.');
        const code = String(raw.code || '').trim().toUpperCase();
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error('Format kode kelas tidak valid.');
        if (rows.some(c => c.name.toLowerCase() === name.toLowerCase())) throw dupError('classes_name_uq');
        if (rows.some(c => c.code === code)) throw dupError('classes_code_key');

        const rec = {
          id: raw.id || genUUID(),
          name,
          descr: String(raw.descr ?? '').trim(),
          emoji: raw.emoji || '🏫',
          color: raw.color || '#367CFF',
          code,
          created_at: raw.created_at || nowISO()
        };
        rows.push(rec);
        inserted.push(rec);
      } else if (table === 'courses') {
        if (!isAdminUser(uid)) throw new Error('Hanya admin yang dapat menambahkan mata kuliah.');
        const name = String(raw.name || '').trim();
        if (!name || name.length > 60) throw new Error('Nama mata kuliah harus 1–60 karakter.');
        const class_id = raw.class_id;
        if (!readTable('classes').some(c => c.id === class_id)) throw new Error('Kelas tidak ditemukan.');
        if (rows.some(c => c.class_id === class_id && c.name.toLowerCase() === name.toLowerCase())) {
          throw dupError('courses_class_name_uq');
        }
        const dosen_id = raw.dosen_id || null;
        // Trigger courses_guard
        if (dosen_id) {
          const dProf = getProfile(dosen_id);
          if (!dProf || dProf.role !== 'dosen') throw new Error('Pengampu harus berupa akun dosen');
          const members = readTable('class_members');
          if (!members.some(m => m.class_id === class_id && m.user_id === dosen_id)) {
            members.push({ class_id, user_id: dosen_id, joined_at: nowISO() });
            writeTable('class_members', members);
          }
        }
        const rec = {
          id: raw.id || genUUID(),
          class_id,
          name,
          code: String(raw.code ?? '').trim(),
          emoji: raw.emoji || '📘',
          color: raw.color || '#367CFF',
          dosen_id,
          created_at: raw.created_at || nowISO()
        };
        rows.push(rec);
        inserted.push(rec);
      } else if (table === 'tasks') {
        if (!isDosenUser(uid)) throw new Error('Hanya dosen yang dapat membuat tugas.');
        const course = readTable('courses').find(c => c.id === raw.course_id && c.class_id === raw.class_id);
        if (!course || course.dosen_id !== uid) {
          throw new Error('Kamu hanya bisa mengirim tugas di mata kuliah yang kamu ampu.');
        }
        const title = String(raw.title || '').trim();
        if (!title || title.length > 120) throw new Error('Judul tugas harus 1–120 karakter.');
        const rec = {
          id: raw.id || genUUID(),
          class_id: raw.class_id,
          course_id: raw.course_id,
          title,
          descr: String(raw.descr ?? '').trim(),
          emoji: raw.emoji || '📝',
          deadline: raw.deadline,
          attach_path: raw.attach_path || null,
          attach_name: raw.attach_name || null,
          attach_size: raw.attach_size || null,
          by_id: uid,
          by_name: raw.by_name || '',
          by_nid: raw.by_nid || '',
          created_at: raw.created_at || nowISO()
        };
        rows.push(rec);
        inserted.push(rec);
      } else if (table === 'submissions') {
        if (!isMahasiswaUser(uid) || !isMember(uid, raw.class_id)) {
          throw new Error('Hanya mahasiswa anggota kelas yang dapat mengumpulkan tugas.');
        }
        const task = readTable('tasks').find(t => t.id === raw.task_id && t.class_id === raw.class_id);
        if (!task) throw new Error('Tugas tidak ditemukan di kelas ini.');
        if (rows.some(s => s.task_id === raw.task_id && s.user_id === uid)) {
          throw dupError('submissions_task_id_user_id_key');
        }
        // Trigger set_late
        const now = Date.now();
        const late = now > new Date(task.deadline).getTime();
        const rec = {
          id: raw.id || genUUID(),
          task_id: raw.task_id,
          class_id: raw.class_id,
          user_id: uid,
          name: String(raw.name || '').trim(),
          nim: String(raw.nim ?? '').trim(),
          note: String(raw.note ?? '').trim(),
          file_path: raw.file_path || null,
          file_name: raw.file_name || null,
          file_size: raw.file_size || null,
          late,
          created_at: nowISO()
        };
        rows.push(rec);
        inserted.push(rec);
      } else if (table === 'materials') {
        if (!isMember(uid, raw.class_id)) throw new Error('Kamu bukan anggota kelas ini.');
        const course = readTable('courses').find(c => c.id === raw.course_id && c.class_id === raw.class_id);
        if (!course) throw new Error('Mata kuliah tidak ditemukan di kelas ini.');
        if (!isMahasiswaUser(uid) && course.dosen_id !== uid) {
          throw new Error('Dosen hanya dapat membagikan materi di mata kuliah yang diampu.');
        }
        const title = String(raw.title || '').trim();
        if (!title || title.length > 120) throw new Error('Judul materi harus 1–120 karakter.');
        const rec = {
          id: raw.id || genUUID(),
          class_id: raw.class_id,
          course_id: raw.course_id,
          title,
          cat: ['Slide', 'Modul', 'Video', 'Catatan', 'Link'].includes(raw.cat) ? raw.cat : 'Modul',
          descr: String(raw.descr ?? '').trim(),
          link: raw.link || null,
          file_path: raw.file_path || null,
          file_name: raw.file_name || null,
          file_size: raw.file_size || null,
          author_id: uid,
          author_name: raw.author_name || '',
          created_at: raw.created_at || nowISO()
        };
        rows.push(rec);
        inserted.push(rec);
      } else if (table === 'material_likes') {
        if (!isMember(uid, raw.class_id)) throw new Error('Kamu bukan anggota kelas ini.');
        const mat = readTable('materials').find(m => m.id === raw.material_id && m.class_id === raw.class_id);
        if (!mat) throw new Error('Materi tidak ditemukan.');
        if (!rows.some(l => l.material_id === raw.material_id && l.user_id === uid)) {
          const rec = { material_id: raw.material_id, class_id: raw.class_id, user_id: uid };
          rows.push(rec);
          inserted.push(rec);
        }
      } else {
        throw new Error('Operasi insert tidak diizinkan pada tabel ' + table);
      }
    }

    writeTable(table, rows);
    return inserted;
  }

  function applyUpsert(table, payload, uid) {
    if (table !== 'submissions') return applyInsert(table, payload, uid);
    if (!uid) throw new Error('Silakan masuk terlebih dahulu.');
    const items = Array.isArray(payload) ? payload : [payload];
    const rows = readTable('submissions');
    const result = [];

    for (const raw of items) {
      if (!isMahasiswaUser(uid) || !isMember(uid, raw.class_id)) {
        throw new Error('Hanya mahasiswa anggota kelas yang dapat mengumpulkan tugas.');
      }
      const task = readTable('tasks').find(t => t.id === raw.task_id && t.class_id === raw.class_id);
      if (!task) throw new Error('Tugas tidak ditemukan di kelas ini.');
      const late = Date.now() > new Date(task.deadline).getTime();
      const idx = rows.findIndex(s => s.task_id === raw.task_id && s.user_id === uid);
      if (idx >= 0) {
        rows[idx] = {
          ...rows[idx],
          name: String(raw.name || '').trim(),
          nim: String(raw.nim ?? '').trim(),
          note: String(raw.note ?? '').trim(),
          file_path: raw.file_path ?? rows[idx].file_path,
          file_name: raw.file_name ?? rows[idx].file_name,
          file_size: raw.file_size ?? rows[idx].file_size,
          late,
          created_at: nowISO()
        };
        result.push(rows[idx]);
      } else {
        const rec = {
          id: raw.id || genUUID(),
          task_id: raw.task_id,
          class_id: raw.class_id,
          user_id: uid,
          name: String(raw.name || '').trim(),
          nim: String(raw.nim ?? '').trim(),
          note: String(raw.note ?? '').trim(),
          file_path: raw.file_path || null,
          file_name: raw.file_name || null,
          file_size: raw.file_size || null,
          late,
          created_at: nowISO()
        };
        rows.push(rec);
        result.push(rec);
      }
    }

    writeTable('submissions', rows);
    return result;
  }

  function applyUpdate(table, patch, matchFn, uid) {
    if (!uid) throw new Error('Silakan masuk terlebih dahulu.');
    const rows = readTable(table);
    const updated = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!matchFn(row)) continue;

      if (table === 'classes') {
        if (!isAdminUser(uid)) throw new Error('Hanya admin yang dapat mengubah kelas.');
        const nextName = patch.name !== undefined ? String(patch.name).trim() : row.name;
        if (!nextName || nextName.length > 40) throw new Error('Nama kelas harus 1–40 karakter.');
        const nextCode = patch.code !== undefined ? String(patch.code).trim().toUpperCase() : row.code;
        if (rows.some((c, idx) => idx !== i && c.name.toLowerCase() === nextName.toLowerCase())) {
          throw dupError('classes_name_uq');
        }
        if (rows.some((c, idx) => idx !== i && c.code === nextCode)) {
          throw dupError('classes_code_key');
        }
        rows[i] = {
          ...row,
          ...patch,
          name: nextName,
          descr: patch.descr !== undefined ? String(patch.descr).trim() : row.descr,
          code: nextCode
        };
        updated.push(rows[i]);
      } else if (table === 'courses') {
        if (!isAdminUser(uid)) throw new Error('Hanya admin yang dapat mengubah mata kuliah.');
        const nextDosen = patch.dosen_id !== undefined ? (patch.dosen_id || null) : row.dosen_id;
        const nextClass = patch.class_id !== undefined ? patch.class_id : row.class_id;
        if (nextDosen) {
          const dProf = getProfile(nextDosen);
          if (!dProf || dProf.role !== 'dosen') throw new Error('Pengampu harus berupa akun dosen');
          const members = readTable('class_members');
          if (!members.some(m => m.class_id === nextClass && m.user_id === nextDosen)) {
            members.push({ class_id: nextClass, user_id: nextDosen, joined_at: nowISO() });
            writeTable('class_members', members);
          }
        }
        rows[i] = { ...row, ...patch, dosen_id: nextDosen };
        updated.push(rows[i]);
      } else if (table === 'tasks') {
        if (!teachesCourse(uid, row.course_id)) throw new Error('Tidak memiliki akses mengubah tugas ini.');
        rows[i] = { ...row, ...patch };
        updated.push(rows[i]);
      } else if (table === 'submissions') {
        if (row.user_id !== uid) throw new Error('Tidak memiliki akses mengubah pengumpulan ini.');
        const task = readTable('tasks').find(t => t.id === row.task_id);
        const late = task ? Date.now() > new Date(task.deadline).getTime() : row.late;
        rows[i] = { ...row, ...patch, late, created_at: nowISO() };
        updated.push(rows[i]);
      } else {
        throw new Error('Update tidak didukung pada tabel ' + table);
      }
    }

    writeTable(table, rows);
    return updated;
  }

  function applyDelete(table, matchFn, uid) {
    if (!uid) throw new Error('Silakan masuk terlebih dahulu.');
    const rows = readTable(table);
    const keep = [];
    const removed = [];

    for (const row of rows) {
      if (!matchFn(row)) {
        keep.push(row);
        continue;
      }
      // Cek izin hapus per baris sesuai RLS SQL
      let allowed = false;
      if (table === 'classes') {
        allowed = isAdminUser(uid);
      } else if (table === 'class_members') {
        if (isAdminUser(uid)) {
          allowed = true;
        } else if (row.user_id === uid) {
          if (teaches(uid, row.class_id)) {
            throw new Error('Dosen yang masih menjadi pengampu mata kuliah di kelas ini tidak bisa keluar kelas.');
          }
          allowed = true;
        }
      } else if (table === 'courses') {
        allowed = isAdminUser(uid);
      } else if (table === 'tasks') {
        allowed = teachesCourse(uid, row.course_id) || isAdminUser(uid);
      } else if (table === 'submissions') {
        allowed = row.user_id === uid || teachesTask(uid, row.task_id) || isAdminUser(uid);
      } else if (table === 'materials') {
        allowed = row.author_id === uid || teachesCourse(uid, row.course_id) || isAdminUser(uid);
      } else if (table === 'material_likes') {
        allowed = row.user_id === uid || isAdminUser(uid);
      }

      if (allowed) {
        removed.push(row);
      } else {
        keep.push(row);
      }
    }

    writeTable(table, keep);

    // Cascade delete sesuai foreign key ON DELETE CASCADE di SQL
    if (removed.length) {
      if (table === 'classes') {
        const cids = new Set(removed.map(r => r.id));
        writeTable('class_members', readTable('class_members').filter(x => !cids.has(x.class_id)));
        writeTable('courses', readTable('courses').filter(x => !cids.has(x.class_id)));
        writeTable('tasks', readTable('tasks').filter(x => !cids.has(x.class_id)));
        writeTable('submissions', readTable('submissions').filter(x => !cids.has(x.class_id)));
        writeTable('materials', readTable('materials').filter(x => !cids.has(x.class_id)));
        writeTable('material_likes', readTable('material_likes').filter(x => !cids.has(x.class_id)));
      } else if (table === 'courses') {
        const coids = new Set(removed.map(r => r.id));
        const removedTasks = readTable('tasks').filter(t => coids.has(t.course_id));
        const tids = new Set(removedTasks.map(t => t.id));
        const removedMats = readTable('materials').filter(m => coids.has(m.course_id));
        const mids = new Set(removedMats.map(m => m.id));
        writeTable('tasks', readTable('tasks').filter(t => !coids.has(t.course_id)));
        writeTable('submissions', readTable('submissions').filter(s => !tids.has(s.task_id)));
        writeTable('materials', readTable('materials').filter(m => !coids.has(m.course_id)));
        writeTable('material_likes', readTable('material_likes').filter(l => !mids.has(l.material_id)));
      } else if (table === 'tasks') {
        const tids = new Set(removed.map(r => r.id));
        writeTable('submissions', readTable('submissions').filter(s => !tids.has(s.task_id)));
      } else if (table === 'materials') {
        const mids = new Set(removed.map(r => r.id));
        writeTable('material_likes', readTable('material_likes').filter(l => !mids.has(l.material_id)));
      }
    }

    return removed;
  }

  /* ---------- Query Builder (Mirip sb.from(...)) ---------- */
  class LocalQuery {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.selectSpec = '*';
      this.payload = null;
      this.filters = [];
      this.orderCol = null;
      this.orderAsc = true;
      this.limitCount = null;
      this.wantSingle = false;
      this.wantMaybeSingle = false;
    }

    select(spec = '*') {
      this.selectSpec = spec;
      return this;
    }

    insert(payload) {
      this.op = 'insert';
      this.payload = payload;
      return this;
    }

    update(payload) {
      this.op = 'update';
      this.payload = payload;
      return this;
    }

    upsert(payload) {
      this.op = 'upsert';
      this.payload = payload;
      return this;
    }

    delete() {
      this.op = 'delete';
      return this;
    }

    eq(col, val) {
      this.filters.push(row => row[col] === val);
      return this;
    }

    in(col, vals) {
      const set = new Set(vals || []);
      this.filters.push(row => set.has(row[col]));
      return this;
    }

    order(col, opts = {}) {
      this.orderCol = col;
      this.orderAsc = opts.ascending !== false;
      return this;
    }

    limit(n) {
      this.limitCount = n;
      return this;
    }

    single() {
      this.wantSingle = true;
      return this;
    }

    maybeSingle() {
      this.wantMaybeSingle = true;
      return this;
    }

    async _exec() {
      await INIT_PROMISE;
      const uid = currentUid();
      const matchFn = row => this.filters.every(fn => fn(row));

      try {
        let rows = [];
        if (this.op === 'select') {
          rows = filterSelect(this.table, readTable(this.table), uid)
            .filter(matchFn)
            .map(r => enrichRow(this.table, r, this.selectSpec, uid));
          if (this.orderCol) {
            const col = this.orderCol;
            const dir = this.orderAsc ? 1 : -1;
            rows.sort((a, b) => {
              const va = a[col] ?? '';
              const vb = b[col] ?? '';
              return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
            });
          }
          if (typeof this.limitCount === 'number') {
            rows = rows.slice(0, this.limitCount);
          }
        } else if (this.op === 'insert') {
          rows = applyInsert(this.table, this.payload, uid);
        } else if (this.op === 'upsert') {
          rows = applyUpsert(this.table, this.payload, uid);
        } else if (this.op === 'update') {
          rows = applyUpdate(this.table, this.payload, matchFn, uid);
        } else if (this.op === 'delete') {
          rows = applyDelete(this.table, matchFn, uid);
        }

        if (this.wantSingle) {
          if (!rows.length) return { data: null, error: new Error('Data tidak ditemukan.') };
          return { data: rows[0], error: null };
        }
        if (this.wantMaybeSingle) {
          return { data: rows[0] || null, error: null };
        }
        return { data: rows, error: null };
      } catch (err) {
        return { data: null, error: err };
      }
    }

    then(onFulfilled, onRejected) {
      return this._exec().then(onFulfilled, onRejected);
    }
  }

  /* ---------- IndexedDB untuk File Upload (Blob maks 10 MB) ---------- */
  function openIDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('Browser ini tidak mendukung IndexedDB untuk menyimpan file.'));
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'path' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Gagal membuka penyimpanan file lokal.'));
    });
  }

  async function idbPutFile(path, file, opts = {}) {
    if (!file) throw new Error('File tidak valid.');
    if (file.size > MAX_BYTES) {
      throw new Error('Ukuran file melebihi batas maksimal 10 MB.');
    }
    const uid = currentUid();
    if (!uid) throw new Error('Silakan masuk terlebih dahulu.');

    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const record = {
        path,
        blob: file instanceof Blob ? file : new Blob([file], { type: opts.contentType || 'application/octet-stream' }),
        name: file.name || path.split('/').pop() || 'file',
        type: file.type || opts.contentType || 'application/octet-stream',
        size: file.size || 0,
        owner_id: uid,
        created_at: nowISO()
      };
      const req = store.put(record);
      req.onsuccess = () => resolve({ path });
      req.onerror = () => {
        if (isQuotaErr(req.error)) reject(quotaError());
        else reject(req.error || new Error('Gagal menyimpan file.'));
      };
      tx.onabort = () => {
        if (isQuotaErr(tx.error)) reject(quotaError());
        else reject(tx.error || new Error('Penyimpanan file dibatalkan.'));
      };
    });
  }

  async function idbGetFile(path) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(path);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Gagal membaca file dari penyimpanan lokal.'));
    });
  }

  async function idbDeleteFiles(paths) {
    const valid = (paths || []).filter(Boolean);
    if (!valid.length) return;
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      valid.forEach(p => store.delete(p));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGetAllFiles() {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbClearAndRestoreFiles(fileRecords) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.clear();
      (fileRecords || []).forEach(r => store.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        if (isQuotaErr(tx.error)) reject(quotaError());
        else reject(tx.error);
      };
    });
  }

  /* ---------- Konversi Blob <-> Base64 untuk Backup & Restore ---------- */
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(dataUrl, fallbackType = 'application/octet-stream') {
    const parts = String(dataUrl || '').split(',');
    if (parts.length < 2) return new Blob([], { type: fallbackType });
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = (mimeMatch && mimeMatch[1]) || fallbackType;
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* ---------- Auth & RPC Lokal ---------- */
  function extractUsername(emailOrUser) {
    const raw = String(emailOrUser || '').trim().toLowerCase();
    return raw.includes('@') ? raw.split('@')[0] : raw;
  }

  const localAuth = {
    async getSession() {
      await INIT_PROMISE;
      const s = getSessionSync();
      if (!s || !s.user) return { data: { session: null }, error: null };
      const prof = getProfile(s.user.id);
      if (!prof) {
        localStorage.removeItem(SESSION_KEY);
        return { data: { session: null }, error: null };
      }
      return { data: { session: s }, error: null };
    },

    async signInWithPassword({ email, username, password }) {
      await INIT_PROMISE;
      const uname = extractUsername(username || email);
      const profiles = readTable('profiles');
      const prof = profiles.find(p => p.username.toLowerCase() === uname);
      if (!prof) {
        return { data: { user: null, session: null }, error: new Error('Invalid login credentials') };
      }
      const computed = await hashPassword(String(password || ''), prof.salt || '');
      if (computed !== prof.password_hash) {
        return { data: { user: null, session: null }, error: new Error('Invalid login credentials') };
      }
      const session = {
        user: { id: prof.id, username: prof.username, role: prof.role },
        created_at: nowISO()
      };
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch (e) {
        if (isQuotaErr(e)) return { data: null, error: quotaError() };
        return { data: null, error: e };
      }
      return { data: { user: session.user, session }, error: null };
    },

    async signUp({ email, username, password, options = {} }) {
      await INIT_PROMISE;
      const meta = options.data || {};
      const uname = extractUsername(meta.username || username || email);
      if (!/^[a-z0-9_.]{3,20}$/.test(uname)) {
        return { data: null, error: new Error('Username harus 3–20 karakter (huruf, angka, titik, atau garis bawah).') };
      }
      if (!password || String(password).length < 6) {
        return { data: null, error: new Error('Password minimal 6 karakter.') };
      }
      const profiles = readTable('profiles');
      if (profiles.some(p => p.username.toLowerCase() === uname)) {
        return { data: null, error: new Error('User already registered') };
      }
      const name = String(meta.name || uname).trim().slice(0, 80) || uname;
      const nim = String(meta.nim || '').trim() || null;
      const role = meta.role === 'dosen' ? 'dosen' : 'mahasiswa';
      const salt = randomSalt(16);
      const password_hash = await hashPassword(String(password), salt);

      const newProf = {
        id: genUUID(),
        username: uname,
        name,
        nim,
        role,
        salt,
        password_hash,
        default_pw: false,
        created_at: nowISO()
      };

      try {
        profiles.push(newProf);
        writeTable('profiles', profiles);
        const session = {
          user: { id: newProf.id, username: newProf.username, role: newProf.role },
          created_at: nowISO()
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        return { data: { user: session.user, session }, error: null };
      } catch (e) {
        return { data: null, error: e };
      }
    },

    async signOut() {
      localStorage.removeItem(SESSION_KEY);
      return { error: null };
    },

    async changePassword(oldPassword, newPassword) {
      await INIT_PROMISE;
      const uid = currentUid();
      if (!uid) throw new Error('Silakan masuk terlebih dahulu.');
      if (!newPassword || String(newPassword).length < 6) {
        throw new Error('Password baru minimal 6 karakter.');
      }
      const profiles = readTable('profiles');
      const idx = profiles.findIndex(p => p.id === uid);
      if (idx < 0) throw new Error('Akun tidak ditemukan.');
      const prof = profiles[idx];
      const oldHash = await hashPassword(String(oldPassword || ''), prof.salt || '');
      if (oldHash !== prof.password_hash) {
        throw new Error('Password lama tidak sesuai.');
      }
      const newSalt = randomSalt(16);
      const newHash = await hashPassword(String(newPassword), newSalt);
      profiles[idx] = {
        ...prof,
        salt: newSalt,
        password_hash: newHash,
        default_pw: String(newPassword) === 'admin123'
      };
      writeTable('profiles', profiles);
      return true;
    },

    isDefaultAdminPassword() {
      const uid = currentUid();
      const prof = getProfile(uid);
      return !!(prof && prof.role === 'admin' && prof.default_pw);
    }
  };

  /* ---------- Objek Klien Lokal (kompatibel dengan pemanggilan sb.*) ---------- */
  const sb = {
    auth: localAuth,
    from(table) {
      return new LocalQuery(table);
    },
    async rpc(fnName, params = {}) {
      await INIT_PROMISE;
      if (fnName === 'join_class') {
        try {
          const uid = currentUid();
          if (!uid) throw new Error('Silakan masuk dulu');
          const prof = getProfile(uid);
          if (!prof || !['mahasiswa', 'dosen'].includes(prof.role)) {
            throw new Error('Akun admin tidak perlu bergabung ke kelas');
          }
          const code = String(params.p_code || '').trim().toUpperCase();
          const cls = readTable('classes').find(c => c.code === code);
          if (!cls) throw new Error('Kode kelas tidak ditemukan');
          const members = readTable('class_members');
          if (!members.some(m => m.class_id === cls.id && m.user_id === uid)) {
            members.push({ class_id: cls.id, user_id: uid, joined_at: nowISO() });
            writeTable('class_members', members);
          }
          return { data: { id: cls.id, name: cls.name }, error: null };
        } catch (err) {
          return { data: null, error: err };
        }
      }
      return { data: null, error: new Error('Fungsi RPC tidak dikenal: ' + fnName) };
    },
    storage: {
      from() {
        return {
          async upload(path, file, opts = {}) {
            try {
              const data = await idbPutFile(path, file, opts);
              return { data, error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
          async remove(paths) {
            try {
              await idbDeleteFiles(paths);
              return { data: paths, error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
          async download(path) {
            try {
              const rec = await idbGetFile(path);
              if (!rec || !rec.blob) throw new Error('File tidak ditemukan di penyimpanan browser ini.');
              return { data: rec, error: null };
            } catch (error) {
              return { data: null, error };
            }
          }
        };
      }
    }
  };

  /* ---------- Backup & Restore Data (JSON) ---------- */
  const DB = {
    async exportBackup() {
      await INIT_PROMISE;
      const tables = {};
      TABLES.forEach(t => {
        tables[t] = readTable(t);
      });
      let files = [];
      try {
        const rawFiles = await idbGetAllFiles();
        files = await Promise.all(
          rawFiles.map(async f => ({
            path: f.path,
            name: f.name,
            type: f.type,
            size: f.size,
            owner_id: f.owner_id,
            created_at: f.created_at,
            dataUrl: f.blob ? await blobToDataURL(f.blob) : null
          }))
        );
      } catch (e) {
        console.warn('Gagal mengekspor file IndexedDB:', e);
      }
      const payload = {
        app: 'KelasHub',
        version: 1,
        exported_at: nowISO(),
        tables,
        files
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `kelashub-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    },

    async importBackup(jsonString) {
      await INIT_PROMISE;
      let parsed;
      try {
        parsed = JSON.parse(jsonString);
      } catch {
        throw new Error('File JSON tidak valid atau rusak.');
      }
      const srcTables = parsed && parsed.tables ? parsed.tables : parsed;
      if (!srcTables || typeof srcTables !== 'object') {
        throw new Error('Format file backup KelasHub tidak dikenali.');
      }
      const hasAnyTable = TABLES.some(t => Array.isArray(srcTables[t]));
      if (!hasAnyTable) {
        throw new Error('File backup tidak berisi tabel data KelasHub.');
      }

      TABLES.forEach(t => {
        if (Array.isArray(srcTables[t])) {
          writeTable(t, srcTables[t]);
        } else {
          writeTable(t, []);
        }
      });

      if (Array.isArray(parsed.files)) {
        const fileRecords = parsed.files
          .filter(f => f && f.path && f.dataUrl)
          .map(f => ({
            path: f.path,
            name: f.name || 'file',
            type: f.type || 'application/octet-stream',
            size: f.size || 0,
            owner_id: f.owner_id || null,
            created_at: f.created_at || nowISO(),
            blob: dataURLToBlob(f.dataUrl, f.type)
          }));
        await idbClearAndRestoreFiles(fileRecords);
      }

      await ensureDefaultAdmin();
      return true;
    }
  };

  window.sb = sb;
  window.DB = DB;
})();
