/* ===== KelasHub — Inti Aplikasi & Animasi UI ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
document.documentElement.style.visibility = 'hidden'; // sembunyikan sampai sesi dicek

const reducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let _revealed = false;
const reveal = () => {
  if (_revealed) return;
  _revealed = true;
  document.documentElement.style.visibility = '';
  document.body.classList.remove('page-leave');
  if (!reducedMotion()) {
    document.body.classList.add('page-enter');
  }
  initRevealObserver();
};
setTimeout(reveal, 5000);

const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const MAX_FILE = 10 * 1024 * 1024; // batas 10 MB per file

function fmtSize(b) {
  if (!b) return '0 KB';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'baru saja';
  if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return Math.floor(s / 86400) + ' hari lalu';
}

/* ---------- Toast ---------- */
function toast(msg, type = '') {
  let box = $('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 380);
  }, 3200);
}

/* ---------- Confetti (Palet Baru) ---------- */
function confetti() {
  if (reducedMotion()) return;
  const cols = ['#367CFF', '#00D9FF', '#8B5CF6', '#22C55E', '#F59E0B', '#EF4444'];
  for (let i = 0; i < 65; i++) {
    const c = document.createElement('i');
    c.className = 'cf';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = cols[i % cols.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.8 + 's';
    c.style.animationDelay = Math.random() * 0.35 + 's';
    c.style.borderRadius = Math.random() > 0.5 ? '50%' : '3px';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4000);
  }
}

/* ---------- File helpers (Palet Baru) ---------- */
function fileKind(name = '', cat = '') {
  const e = (name.split('.').pop() || '').toLowerCase();
  if (['pdf'].includes(e)) return { l: 'PDF', c: '#EF4444' };
  if (['doc', 'docx'].includes(e)) return { l: 'DOC', c: '#367CFF' };
  if (['ppt', 'pptx'].includes(e)) return { l: 'PPT', c: '#F59E0B' };
  if (['xls', 'xlsx', 'csv'].includes(e)) return { l: 'XLS', c: '#22C55E' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) return { l: 'IMG', c: '#00D9FF' };
  if (['zip', 'rar', '7z'].includes(e)) return { l: 'ZIP', c: '#8B5CF6' };
  if (['mp4', 'mov', 'mkv'].includes(e) || cat === 'Video') return { l: 'VID', c: '#8B5CF6' };
  if (cat === 'Link') return { l: 'URL', c: '#22C55E' };
  return { l: (e || 'FILE').slice(0, 4).toUpperCase(), c: '#367CFF' };
}

/* ---------- Dropzone ---------- */
function setupDrop(zone, input, label) {
  if (!zone || !input || !label) return;
  const show = () => {
    const f = input.files[0];
    label.innerHTML = f ? `📎 ${esc(f.name)} <small>(${fmtSize(f.size)})</small>` : '';
    if (f && f.size > MAX_FILE) {
      toast('File melebihi 10 MB, pilih file yang lebih kecil.', 'err');
      input.value = '';
      label.innerHTML = '';
    }
  };
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', show);
  ['dragenter', 'dragover'].forEach(ev =>
    zone.addEventListener(ev, e => {
      e.preventDefault();
      zone.classList.add('over');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    zone.addEventListener(ev, e => {
      e.preventDefault();
      zone.classList.remove('over');
    })
  );
  zone.addEventListener('drop', e => {
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      show();
    }
  });
}

/* ---------- Modal (Spring + Bottom Sheet di HP) ---------- */
function openModal(id) {
  const m = $('#' + id);
  if (m) m.classList.add('show');
}
function closeModal(id) {
  const m = $('#' + id);
  if (m) m.classList.remove('show');
}
document.addEventListener('click', e => {
  if (e.target.classList.contains('ov')) e.target.classList.remove('show');
  if (e.target.dataset.close) closeModal(e.target.dataset.close);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $$('.ov.show').forEach(o => o.classList.remove('show'));
    closeDrawer();
  }
});

/* ---------- Mobile Drawer & Overlay ---------- */
function toggleDrawer(force) {
  const links = $('.links');
  const burger = $('.burger');
  if (!links) return;
  let ov = $('.nav-ov');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'nav-ov';
    ov.addEventListener('click', () => closeDrawer());
    document.body.appendChild(ov);
  }
  const open = typeof force === 'boolean' ? force : !links.classList.contains('open');
  links.classList.toggle('open', open);
  ov.classList.toggle('show', open);
  if (burger) {
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.textContent = open ? '✕' : '☰';
  }
  document.body.classList.toggle('nav-lock', open);
}
function closeDrawer() {
  toggleDrawer(false);
}

/* ---------- Staggered Reveal (IntersectionObserver) ---------- */
let _io = null;
function initRevealObserver() {
  const autoTargets = $$(
    '.phead, .hero, .banner, .stats, .panel, .sec-t, .duo, .steps, .toolbar, .cgrid, .grid, .hist, .feed, .lp-sec .split'
  );
  autoTargets.forEach((el, idx) => {
    if (!el.classList.contains('rv')) el.classList.add('rv');
    if (!el.style.getPropertyValue('--d')) {
      el.style.setProperty('--d', `${Math.min(idx * 55, 330)}ms`);
    }
  });

  // Stagger anak di dalam stats / steps / duo
  $$('.stats, .steps, .duo').forEach(group => {
    [...group.children].forEach((child, i) => {
      child.style.setProperty('--i', i);
    });
  });

  if (reducedMotion() || typeof IntersectionObserver === 'undefined') {
    $$('.rv').forEach(el => el.classList.add('in'));
    return;
  }

  if (!_io) {
    _io = new IntersectionObserver(
      entries => {
        entries.forEach(x => {
          if (x.isIntersecting) {
            x.target.classList.add('in');
            _io.unobserve(x.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -20px 0px' }
    );
  }
  $$('.rv:not(.in)').forEach(el => _io.observe(el));
}

/* ---------- Micro-interaction: Ripple Effect & Transisi Halaman ---------- */
function setupInteractions() {
  const b = $('.burger');
  if (b) b.onclick = () => toggleDrawer();

  // Ripple saat tap tombol / tab / chip
  document.addEventListener('pointerdown', e => {
    if (reducedMotion()) return;
    const target = e.target.closest('.btn, .tabs button, .chip, .like, .code button');
    if (!target || target.disabled) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.8;
    const ink = document.createElement('span');
    ink.className = 'ripple-ink';
    ink.style.width = ink.style.height = size + 'px';
    ink.style.left = e.clientX - rect.left - size / 2 + 'px';
    ink.style.top = e.clientY - rect.top - size / 2 + 'px';
    target.appendChild(ink);
    setTimeout(() => ink.remove(), 550);
  });

  // Fallback transisi keluar saat klik link antar halaman
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (
      !href ||
      href.startsWith('#') ||
      href.startsWith('javascript:') ||
      a.target === '_blank' ||
      a.hasAttribute('download') ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return;

    closeDrawer();
    if (!reducedMotion()) {
      e.preventDefault();
      navigateWithTransition(href);
    }
  });
}

function navigateWithTransition(url, replace = false) {
  if (reducedMotion() || !_revealed) {
    if (replace) location.replace(url);
    else location.href = url;
    return;
  }
  document.body.classList.remove('page-enter');
  document.body.classList.add('page-leave');
  setTimeout(() => {
    if (replace) location.replace(url);
    else location.href = url;
  }, 190);
}

window.addEventListener('pageshow', e => {
  if (e.persisted) {
    document.body.classList.remove('page-leave');
    document.body.classList.add('page-enter');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  setupInteractions();
  initRevealObserver();
  observeStatNumbers();
});

/* ---------- Count-Up Angka Statistik ---------- */
function countUp(el, to) {
  if (!el) return;
  const target = Number(to) || 0;
  el.dataset.counted = String(target);
  if (reducedMotion() || target === 0) {
    el.textContent = target;
    return;
  }
  const duration = 650;
  const start = performance.now();
  const step = now => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(eased * target);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = target;
  };
  requestAnimationFrame(step);
}

function observeStatNumbers() {
  $$('.stat b[id]').forEach(el => {
    let busy = false;
    const mo = new MutationObserver(() => {
      if (busy) return;
      const val = Number(el.textContent);
      if (!Number.isNaN(val) && val > 0 && el.dataset.counted !== String(val)) {
        busy = true;
        countUp(el, val);
        setTimeout(() => {
          busy = false;
        }, 700);
      }
    });
    mo.observe(el, { childList: true, characterData: true, subtree: true });
  });
}

/* ---------- Skeleton Loading ---------- */
function showSkeleton(container, count = 3, kind = 'card') {
  if (!container) return;
  if (kind === 'list') {
    container.innerHTML = Array.from({ length: count })
      .map(
        () => `<div class="skel-row">
          <div class="skel skel-av"></div>
          <div class="grow"><div class="skel skel-line w60"></div><div class="skel skel-line w40"></div></div>
        </div>`
      )
      .join('');
    return;
  }
  container.innerHTML = Array.from({ length: count })
    .map(
      () => `<div class="card skel-card">
        <div class="skel skel-title"></div>
        <div class="skel skel-line w80"></div>
        <div class="skel skel-line w50"></div>
        <div class="skel skel-btn"></div>
      </div>`
    )
    .join('');
}

/* ---------- Supabase Storage & Helpers ---------- */
const CONFIGURED =
  typeof SUPABASE_URL !== 'undefined' &&
  !/ISI_/.test(SUPABASE_URL + SUPABASE_KEY) &&
  typeof supabase !== 'undefined';
const sb = CONFIGURED ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const BUCKET = 'files';
const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const fail = (e, msg) => {
  console.error(e);
  toast(msg || (e && e.message) || 'Terjadi kesalahan', 'err');
};
const go = u => {
  navigateWithTransition(u, true);
  return new Promise(() => {});
};
const safeName = n =>
  String(n || 'file')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .slice(-80);

async function uploadFile(file, folder) {
  if (file && file.size > MAX_FILE) {
    throw new Error('File melebihi batas maksimal 10 MB.');
  }
  const path = `${folder}/${uid()}-${safeName(file.name)}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream'
  });
  if (error) throw error;
  return path;
}
async function removeFiles(paths) {
  paths = (paths || []).filter(Boolean);
  if (paths.length) {
    try {
      await sb.storage.from(BUCKET).remove(paths);
    } catch (e) {
      console.warn(e);
    }
  }
}
async function downloadPath(path, name) {
  if (!path) {
    toast('File tidak tersedia.', 'err');
    return;
  }
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 120, {
    download: name || true
  });
  if (error) {
    fail(error, 'Gagal mengunduh file');
    return;
  }
  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function openLink(url) {
  if (/^https?:\/\//i.test(url || '')) window.open(url, '_blank', 'noopener');
  else toast('Tautan tidak valid.', 'err');
}

/* ---------- Sesi, Profil, Kelas ---------- */
const PAGE = location.pathname.split('/').pop() || 'index.html';
const DASH = ['admin.html', 'dosen.html', 'mahasiswa.html'];
const ADMIN_PAGES = ['admin.html', 'kelola.html'];
const homeOf = u =>
  u && u.role === 'admin' ? 'admin.html' : u && u.role === 'dosen' ? 'dosen.html' : 'mahasiswa.html';
const ROLE_LABEL = { admin: 'Admin', dosen: 'Dosen', mahasiswa: 'Mahasiswa' };
let ME = null,
  CLS = null,
  CID = null,
  MY = [],
  COURSES = [],
  HOME = 'login.html';
let DOSEN = {};
const isAdmin = () => !!ME && ME.role === 'admin';
const isDosen = () => !!ME && ME.role === 'dosen';
const classKey = () => 'kh_class_' + (ME ? ME.id : '');
const selectClass = id => localStorage.setItem(classKey(), id);

const Auth = {
  email: u => String(u).trim().toLowerCase() + '@kelashub.app',
  async logout() {
    await sb.auth.signOut();
    navigateWithTransition('login.html');
  }
};

const courseById = id => COURSES.find(c => c.id === id);
const courseColor = id => (courseById(id) || {}).color || '#367CFF';
const courseName = id => (courseById(id) || {}).name || '—';
const dosenName = id => (id && DOSEN[id]) || 'Belum ada pengampu';
const isMine = courseId => !!ME && (courseById(courseId) || {}).dosen_id === ME.id;
const myCourses = () => COURSES.filter(c => c.dosen_id === (ME && ME.id));

async function loadDosen(ids) {
  ids = [...new Set((ids || []).filter(Boolean))].filter(id => !(id in DOSEN));
  if (ids.length) {
    must(await sb.from('profiles').select('id,name').in('id', ids)).forEach(p => {
      DOSEN[p.id] = p.name;
    });
  }
  return DOSEN;
}
async function loadCourses() {
  COURSES = must(await sb.from('courses').select('*').eq('class_id', CID).order('created_at'));
  await loadDosen(COURSES.map(c => c.dosen_id));
  return COURSES;
}
function courseOptions(sel, list = COURSES) {
  sel.innerHTML = list.length
    ? list.map(c => `<option value="${esc(c.id)}">${esc(c.emoji)} ${esc(c.name)}</option>`).join('')
    : '<option value="">— belum ada mata kuliah —</option>';
}
async function loadMemberCounts() {
  const rows = must(await sb.from('class_members').select('class_id, profiles(role)'));
  const out = {};
  rows.forEach(r => {
    const o = out[r.class_id] || (out[r.class_id] = { mhs: 0, dsn: 0 });
    const role = r.profiles && r.profiles.role;
    if (role === 'mahasiswa') o.mhs++;
    else if (role === 'dosen') o.dsn++;
  });
  return out;
}
async function loadClassStats() {
  const rows = must(
    await sb
      .from('classes')
      .select('*, class_members(count), courses(count), tasks(count), materials(count), submissions(count)')
      .order('created_at')
  );
  const n = r => (r && r[0] && r[0].count) || 0;
  return rows.map(c => ({
    ...c,
    nMembers: n(c.class_members),
    nCourses: n(c.courses),
    nTasks: n(c.tasks),
    nMats: n(c.materials),
    nSubs: n(c.submissions)
  }));
}

const READY = (async () => {
  if (!CONFIGURED) {
    document.body.innerHTML = `<div style="max-width:560px;margin:12vh auto;padding:28px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:20px;box-shadow:var(--sh2)">
      <h2>⚙️ Supabase belum dikonfigurasi</h2>
      <p style="margin:12px 0;color:var(--mut)">Buka <code>js/config.js</code>, lalu isi <b>SUPABASE_URL</b> dan <b>SUPABASE_KEY</b> (anon key) dari Supabase &gt; Project Settings &gt; API.</p>
      <p style="color:var(--mut);font-size:.9rem">Jika sudah diisi dan masih muncul, periksa koneksi internet (library Supabase dimuat dari CDN).</p></div>`;
    reveal();
    return false;
  }

  const {
    data: { session }
  } = await sb.auth.getSession();
  if (!session) {
    if (PAGE !== 'login.html') await go('login.html');
    return true;
  }

  const { data: prof } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (!prof) {
    await sb.auth.signOut();
    if (PAGE !== 'login.html') await go('login.html');
    return true;
  }
  ME = {
    id: prof.id,
    name: prof.name,
    username: prof.username,
    nim: prof.nim || '',
    role: prof.role
  };
  HOME = homeOf(ME);

  if (PAGE === 'login.html') await go(HOME);
  if (DASH.includes(PAGE) && PAGE !== HOME) await go(HOME);
  if (isAdmin() !== ADMIN_PAGES.includes(PAGE)) await go(HOME);

  if (!DASH.includes(PAGE) && !ADMIN_PAGES.includes(PAGE)) {
    MY = must(await sb.from('classes').select('*').order('created_at'));
    CLS = MY.find(c => c.id === localStorage.getItem(classKey())) || (MY.length === 1 ? MY[0] : null);
    if (!CLS) await go(HOME);
    CID = CLS.id;
    selectClass(CID);
    await loadCourses();
  }
  buildNav();
  return true;
})().catch(e => {
  console.error(e);
  reveal();
  toast('Gagal memuat: ' + (e.message || e), 'err');
  return false;
});

function boot(fn) {
  return READY.then(async ok => {
    if (!ok) return;
    // Tampilkan skeleton sementara pada container utama sebelum data selesai dimuat
    const mainList = $('#list') || $('#tasks') || $('#mats');
    if (mainList && !mainList.children.length) {
      showSkeleton(mainList, 3, 'card');
    }
    try {
      await fn();
    } catch (e) {
      fail(e);
    }
    reveal();
  });
}

/* ---------- Navbar Dinamis ---------- */
function buildNav() {
  const logo = $('.nav .logo');
  if (logo) logo.href = HOME;
  const links = $('.links');
  if (!links || !ME) return;
  const inDash = DASH.includes(PAGE);
  const items =
    CID && !inDash
      ? [
          ['index.html', 'Beranda Kelas'],
          ['tugas.html', '📝 Tugas'],
          ['materi.html', '📚 Materi'],
          ['matakuliah.html', '🎓 Mata Kuliah']
        ]
      : [];
  const dashLabel = isAdmin() ? '🛡️ Dashboard Admin' : isDosen() ? '🏫 Dashboard Dosen' : '🎒 Dashboard';
  links.innerHTML =
    items.map(([h, t]) => `<a href="${h}" class="${PAGE === h ? 'on' : ''}">${t}</a>`).join('') +
    `<a href="${HOME}" class="cls ${inDash ? 'on' : ''}" title="Kembali ke dashboard">${
      inDash || !CLS ? dashLabel : '← ' + esc(CLS.name)
    }</a>` +
    `<span class="uchip"><i>${esc(ME.name.trim()[0].toUpperCase())}</i><span>${esc(ME.name)}<small>${
      ROLE_LABEL[ME.role] || ''
    }${ME.nim ? ' · ' + (isDosen() ? 'NIDN ' : 'NIM ') + esc(ME.nim) : ''}</small></span></span>` +
    `<button class="btn red sm" id="btnOut">Keluar</button>`;
  $('#btnOut').onclick = () => {
    if (confirm('Keluar dari akun?')) Auth.logout();
  };
  const tag = $('.phead .tag');
  if (tag && CLS && !inDash) tag.textContent += ' · ' + CLS.name;
}
