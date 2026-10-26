import './style.css';
import { fetchCharData, createProgressiveStrokeSVG, createFullCharSVG, exportWorksheetToPDF } from './pdfExport.js';

const DEFAULT_WORDS = [
  { chars: '年级', pinyin: 'nián jí', meaning: 'Năm học / Lớp' },
  { chars: '暑假', pinyin: 'shǔ jià', meaning: 'Kỳ nghỉ hè' },
  { chars: '请教', pinyin: 'qǐng jiào', meaning: 'Xin chỉ giáo' },
  { chars: '学习', pinyin: 'xué xí', meaning: 'Học tập' }
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let words = JSON.parse(localStorage.getItem('hanzi_wordlist') || 'null') || DEFAULT_WORDS;
let selected = new Set(words.map((_, i) => i)); // các từ được tick để xuất PDF
let learnedChars = new Set(JSON.parse(localStorage.getItem('hanzi_learned') || '[]'));
let currentWordIndex = 0;
let currentCharIndex = 0;
let writer = null;
let showOutline = true;
let showFreehandOutline = true; // Trạng thái nét mờ của 4 ô luyện viết tự do
let currentCharData = null;

const saveWords = () => localStorage.setItem('hanzi_wordlist', JSON.stringify(words));

// ---------- Danh sách từ ----------
function renderWordList() {
  const listEl = $('word-list');
  listEl.innerHTML = '';

  words.forEach((item, idx) => {
    const active = idx === currentWordIndex;
    const allLearned = Array.from(item.chars).every((c) => learnedChars.has(c));
    const div = document.createElement('div');
    div.className = `p-3.5 rounded-2xl border cursor-pointer transition flex items-center gap-2.5 ${
      active ? 'border-[#455d95] bg-[#edf3fa] shadow-2xs' : 'border-slate-200/80 hover:bg-slate-50'
    }`;
    div.innerHTML = `
      <input type="checkbox" class="word-cb w-4 h-4 accent-[#2d426d] flex-shrink-0 cursor-pointer" ${selected.has(idx) ? 'checked' : ''} title="Chọn để xuất PDF" />
      <div class="flex-1 min-w-0 word-nav">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xl font-bold font-serif text-slate-800">${esc(item.chars)}</span>
          <span class="text-xs font-bold text-[#2d426d]">${esc(item.pinyin)}</span>
          ${allLearned ? '<span class="text-[11px] bg-[#e3ecf6] text-[#2d426d] font-semibold px-2 py-0.5 rounded-full">✓ Đã thuộc</span>' : ''}
        </div>
        <p class="text-xs text-slate-500 mt-0.5 truncate" title="${esc(item.meaning)}">${esc(item.meaning)}</p>
      </div>
      <button class="btn-del text-slate-300 hover:text-rose-500 px-2 py-1 text-lg" title="Xóa từ">&times;</button>
    `;

    div.querySelector('.word-cb').addEventListener('change', (e) => {
      if (e.target.checked) selected.add(idx);
      else selected.delete(idx);
      updateSelectAllBtn();
    });
    div.querySelector('.word-nav').addEventListener('click', () => selectWord(idx));
    div.querySelector('.btn-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (words.length <= 1) return;
      words.splice(idx, 1);
      selected = new Set([...selected].filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i)));
      saveWords();
      if (currentWordIndex >= words.length) currentWordIndex = 0;
      selectWord(currentWordIndex);
    });
    listEl.appendChild(div);
  });

  $('learned-counter').textContent = `Đã thuộc: ${learnedChars.size} chữ`;
  updateSelectAllBtn();
}

function updateSelectAllBtn() {
  const all = words.length > 0 && words.every((_, i) => selected.has(i));
  $('btn-select-all').textContent = all ? 'Bỏ chọn tất cả' : 'Chọn tất cả';
}

function addWordToTop(word) {
  const dup = words.findIndex((w) => w.chars === word.chars);
  if (dup !== -1) {
    words.splice(dup, 1);
    selected = new Set([...selected].filter((i) => i !== dup).map((i) => (i > dup ? i - 1 : i)));
  }
  words.unshift(word);
  selected = new Set([0, ...[...selected].map((i) => i + 1)]);
  saveWords();
  selectWord(0);
}

// ---------- Khu vực viết ----------
function selectWord(index) {
  currentWordIndex = index;
  currentCharIndex = 0;
  const word = words[index];
  $('current-word-title').textContent = word.chars;
  $('current-word-pinyin').textContent = word.pinyin;
  $('current-word-meaning').textContent = word.meaning;
  renderCharSelector();
  renderWordList();
  loadCharacterIntoWriter(Array.from(word.chars)[0]);
  clearAllCanvases();
}

function renderCharSelector() {
  const el = $('char-selector');
  el.innerHTML = '';
  Array.from(words[currentWordIndex].chars).forEach((ch, idx) => {
    const btn = document.createElement('button');
    btn.className = `w-10 h-10 rounded-2xl font-serif text-lg font-bold border transition ${
      idx === currentCharIndex
        ? 'bg-[#2d426d] text-white border-[#2d426d] shadow-xs'
        : 'bg-white text-slate-700 border-slate-200 hover:border-[#a0c1e1]'
    }`;
    btn.textContent = ch;
    btn.addEventListener('click', () => {
      currentCharIndex = idx;
      renderCharSelector();
      loadCharacterIntoWriter(ch);
    });
    el.appendChild(btn);
  });
}

async function loadCharacterIntoWriter(char) {
  $('hanzi-target').innerHTML = '';
  $('quiz-feedback').textContent = '';
  freehandUndoStack = [];
  freehandRedoStack = [];
  updateFreehandUndoRedoBtns();

  writer = window.HanziWriter.create('hanzi-target', char, {
    width: 220,
    height: 220,
    padding: 15,
    showOutline,
    strokeAnimationSpeed: 1.2,
    delayBetweenStrokes: 250,
    strokeColor: '#0f172a',
    radicalColor: '#2d426d',
    outlineColor: '#cbd5e1',
    drawingWidth: 22
  });

  const previewEl = $('stroke-order-preview');
  const badgeEl = $('stroke-count-badge');
  previewEl.innerHTML = '<span class="text-xs text-slate-400">Đang tải thứ tự nét...</span>';

  const data = await fetchCharData(char);
  currentCharData = data;
  updateFreehandOutlines(char, data);

  if (data && data.strokes) {
    badgeEl.textContent = `${data.strokes.length}画 (Nét)`;
    previewEl.innerHTML = data.strokes
      .map((_, i) => `<div class="p-1 bg-white border border-slate-200 rounded-xl shadow-2xs">${createProgressiveStrokeSVG(data.strokes, i, 36)}</div>`)
      .join('');
  } else {
    badgeEl.textContent = '?画';
    previewEl.innerHTML = '<span class="text-xs text-rose-500">Không tìm thấy dữ liệu nét chữ này.</span>';
  }
}

// Cập nhật lớp nét mờ cho 8 ô luyện viết tự do
function updateFreehandOutlines(char, charData) {
  const btn = $('btn-toggle-freehand-outline');
  if (btn) {
    if (showFreehandOutline) {
      btn.className = 'w-9 h-9 rounded-full flex items-center justify-center bg-[#e3ecf6] text-[#2d426d] hover:bg-[#d6e4f3] transition active:scale-95 text-base';
      btn.title = 'Nét mờ: Đang Bật (Bấm để Tắt)';
    } else {
      btn.className = 'w-9 h-9 rounded-full flex items-center justify-center bg-slate-100 text-slate-400 hover:bg-slate-200/60 transition active:scale-95 text-base';
      btn.title = 'Nét mờ: Đang Tắt (Bấm để Bật)';
    }
  }

  const outlineElements = document.querySelectorAll('.freehand-outline');
  if (!outlineElements.length) return;

  let contentHtml = '';
  if (charData && charData.strokes) {
    // Dùng vector nét mờ chuẩn của HanziWriter (màu xám nhạt #cbd5e1)
    contentHtml = createFullCharSVG(charData.strokes, '#cbd5e1', 110);
  } else if (char) {
    contentHtml = `<span class="font-serif text-7xl text-slate-300 select-none">${esc(char)}</span>`;
  }

  outlineElements.forEach((el) => {
    el.innerHTML = contentHtml;
    if (showFreehandOutline) {
      el.style.opacity = '1';
      el.style.display = 'flex';
    } else {
      el.style.opacity = '0';
      el.style.display = 'none';
    }
  });
}

// ---------- 8 ô viết tự do (Có bút vẽ & Gôm tẩy như Paint, hỗ trợ Undo / Redo) ----------
let currentFreehandTool = 'pen'; // 'pen' | 'eraser'
let freehandUndoStack = [];
let freehandRedoStack = [];
const MAX_UNDO_STEPS = 40;

function updateFreehandUndoRedoBtns() {
  const undoBtn = $('btn-undo-freehand');
  const redoBtn = $('btn-redo-freehand');
  if (undoBtn) undoBtn.disabled = freehandUndoStack.length === 0;
  if (redoBtn) redoBtn.disabled = freehandRedoStack.length === 0;
}

function undoFreehand() {
  if (freehandUndoStack.length === 0) return;
  const action = freehandUndoStack.pop();
  const canvases = Array.from(document.querySelectorAll('.freehand-canvas'));

  if (action.type === 'clear') {
    action.allCanvases.forEach(({ canvasIdx, data }) => {
      const c = canvases[canvasIdx];
      if (c) c.getContext('2d').putImageData(data, 0, 0);
    });
  } else if (action.type === 'stroke') {
    const c = canvases[action.canvasIdx];
    if (c) c.getContext('2d').putImageData(action.before, 0, 0);
  }

  freehandRedoStack.push(action);
  updateFreehandUndoRedoBtns();
}

function redoFreehand() {
  if (freehandRedoStack.length === 0) return;
  const action = freehandRedoStack.pop();
  const canvases = Array.from(document.querySelectorAll('.freehand-canvas'));

  if (action.type === 'clear') {
    canvases.forEach((c) => {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.beginPath();
    });
  } else if (action.type === 'stroke') {
    const c = canvases[action.canvasIdx];
    if (c) c.getContext('2d').putImageData(action.after, 0, 0);
  }

  freehandUndoStack.push(action);
  updateFreehandUndoRedoBtns();
}

function setFreehandTool(tool) {
  currentFreehandTool = tool;
  const isPen = tool === 'pen';

  const penBtn = $('tool-pen');
  const eraserBtn = $('tool-eraser');

  if (penBtn && eraserBtn) {
    if (isPen) {
      penBtn.className = 'w-9 h-9 rounded-full flex items-center justify-center bg-[#2d426d] text-white shadow-xs transition active:scale-95 text-base';
      eraserBtn.className = 'w-9 h-9 rounded-full flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition active:scale-95 text-base';
    } else {
      eraserBtn.className = 'w-9 h-9 rounded-full flex items-center justify-center bg-[#2d426d] text-white shadow-xs transition active:scale-95 text-base';
      penBtn.className = 'w-9 h-9 rounded-full flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition active:scale-95 text-base';
    }
  }

  document.querySelectorAll('.freehand-canvas').forEach((canvas) => {
    if (isPen) canvas.classList.remove('eraser-mode');
    else canvas.classList.add('eraser-mode');
  });
}

function initFreehandCanvases() {
  const canvases = Array.from(document.querySelectorAll('.freehand-canvas'));
  canvases.forEach((canvas, canvasIdx) => {
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let strokeDrawn = false;
    let beforeData = null;

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return {
        x: (p.clientX - r.left) * (canvas.width / r.width),
        y: (p.clientY - r.top) * (canvas.height / r.height)
      };
    };

    const start = (e) => {
      e.preventDefault();
      drawing = true;
      strokeDrawn = false;
      beforeData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const p = pos(e);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (currentFreehandTool === 'eraser') {
        // Chế độ gôm tẩy giống Paint: xóa pixel mực đã vẽ về trong suốt, để lộ lưới chữ Điền phía sau
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 18;
      } else {
        // Chế độ bút mực thông thường
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
      }

      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      strokeDrawn = true;
    };

    const move = (e) => {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      strokeDrawn = true;
    };

    const end = (e) => {
      if (!drawing) return;
      drawing = false;
      ctx.beginPath();

      if (strokeDrawn && beforeData) {
        const afterData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        freehandUndoStack.push({
          type: 'stroke',
          canvasIdx,
          before: beforeData,
          after: afterData
        });
        if (freehandUndoStack.length > MAX_UNDO_STEPS) {
          freehandUndoStack.shift();
        }
        freehandRedoStack = [];
        updateFreehandUndoRedoBtns();
      }
      beforeData = null;
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);

    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  });

  updateFreehandUndoRedoBtns();
}

function clearAllCanvases(recordHistory = true) {
  const canvases = Array.from(document.querySelectorAll('.freehand-canvas'));

  if (recordHistory) {
    const snapshot = canvases.map((c, canvasIdx) => ({
      canvasIdx,
      data: c.getContext('2d').getImageData(0, 0, c.width, c.height)
    }));
    const hasContent = snapshot.some((s) => {
      const d = s.data.data;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 0) return true;
      }
      return false;
    });

    if (hasContent) {
      freehandUndoStack.push({ type: 'clear', allCanvases: snapshot });
      if (freehandUndoStack.length > MAX_UNDO_STEPS) freehandUndoStack.shift();
      freehandRedoStack = [];
      updateFreehandUndoRedoBtns();
    }
  }

  canvases.forEach((c) => {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.beginPath();
  });
}

// ---------- Tra cứu: tiếng Việt -> AI (chuẩn nhất), chữ Hán -> MongoDB; có dự phòng chéo ----------
async function searchMongo(keyword, script) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(keyword)}`);
  if (!res.ok) return null;
  const d = await res.json();
  if (!d || !d.hanzi) return null;
  return {
    chars: (script === 'traditional' && d.hanzi_tw ? d.hanzi_tw : d.hanzi).trim(),
    pinyin: (d.pinyin || '').trim(),
    meaning: (d.meaning || keyword).trim()
  };
}

async function translateAI(keyword, script) {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: keyword, script })
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.hanzi) throw new Error(d.error || 'Không dịch được từ này');
  return { chars: d.hanzi.trim(), pinyin: (d.pinyin || '').trim(), meaning: (d.meaning || keyword).trim() };
}

// Luôn ưu tiên từ điển MongoDB trước; không có kết quả khớp (hoặc lỗi) thì mới dùng AI dịch
async function lookup(keyword, script) {
  try {
    const r = await searchMongo(keyword, script);
    if (r) return r;
  } catch (e) {
    console.warn('MongoDB lỗi, chuyển sang AI:', e);
  }
  return translateAI(keyword, script);
}

async function handleSearch() {
  const keyword = $('search-input').value.trim();
  if (!keyword) return;
  const script = document.querySelector('input[name="script-type"]:checked').value;
  const status = $('ai-status');
  status.textContent = '⚡ Đang tra cứu...';
  status.classList.remove('hidden');
  try {
    addWordToTop(await lookup(keyword, script));
    $('search-input').value = '';
  } catch (err) {
    alert('Lỗi tra cứu / dịch:\n' + err.message);
  } finally {
    status.classList.add('hidden');
  }
}

// ---------- Sự kiện ----------
function bindEvents() {
  $('btn-animate').addEventListener('click', () => writer && writer.animateCharacter());

  $('btn-quiz').addEventListener('click', () => {
    if (!writer) return;
    const ch = Array.from(words[currentWordIndex].chars)[currentCharIndex];
    const fb = $('quiz-feedback');
    fb.textContent = 'Hãy dùng bút/tay viết từng nét vào ô bên trên...';
    writer.quiz({
      onMistake: (s) => { fb.textContent = `Sai nét thứ ${s.strokeNum + 1}! Hãy thử lại.`; },
      onCorrectStroke: (s) => { fb.textContent = `Chính xác nét ${s.strokeNum + 1}!`; },
      onComplete: (s) => {
        fb.textContent = `🎉 Tuyệt vời! Hoàn thành chữ "${ch}" (Sai ${s.totalMistakes} lần).`;
        learnedChars.add(ch);
        localStorage.setItem('hanzi_learned', JSON.stringify([...learnedChars]));
        renderWordList();
      }
    });
  });

  $('btn-toggle-outline').addEventListener('click', () => {
    if (!writer) return;
    showOutline = !showOutline;
    showOutline ? writer.showOutline() : writer.hideOutline();
  });

  $('btn-clear-canvas').addEventListener('click', () => clearAllCanvases(true));

  // Bộ công cụ vẽ: Bút viết & Gôm tẩy
  $('tool-pen')?.addEventListener('click', () => setFreehandTool('pen'));
  $('tool-eraser')?.addEventListener('click', () => setFreehandTool('eraser'));

  // Undo / Redo cho 8 ô luyện viết tự do
  $('btn-undo-freehand')?.addEventListener('click', undoFreehand);
  $('btn-redo-freehand')?.addEventListener('click', redoFreehand);

  // Bật/tắt nét mờ trong 8 ô luyện viết tự do
  $('btn-toggle-freehand-outline')?.addEventListener('click', () => {
    showFreehandOutline = !showFreehandOutline;
    const char = Array.from(words[currentWordIndex]?.chars || '')[currentCharIndex] || '';
    updateFreehandOutlines(char, currentCharData);
  });

  $('search-btn').addEventListener('click', handleSearch);
  $('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSearch(); });

  $('btn-select-all').addEventListener('click', () => {
    const all = words.every((_, i) => selected.has(i));
    selected = all ? new Set() : new Set(words.map((_, i) => i));
    renderWordList();
  });

  $('btn-add-manual').addEventListener('click', () => {
    const chars = $('manual-hanzi').value.trim();
    if (!chars) return alert('Vui lòng nhập chữ Hán!');
    words.push({
      chars,
      pinyin: $('manual-pinyin').value.trim(),
      meaning: $('manual-meaning').value.trim() || 'Từ tự thêm'
    });
    selected.add(words.length - 1);
    saveWords();
    selectWord(words.length - 1);
    ['manual-hanzi', 'manual-pinyin', 'manual-meaning'].forEach((id) => { $(id).value = ''; });
  });

  const rowsEl = $('pdf-rows');
  rowsEl.value = localStorage.getItem('pdf_rows') || '2';
  rowsEl.addEventListener('change', () => localStorage.setItem('pdf_rows', rowsEl.value));

  $('btn-export-pdf').addEventListener('click', async () => {
    const list = words.filter((_, i) => selected.has(i));
    if (!list.length) return alert('Vui lòng tick chọn ít nhất một từ để xuất PDF!');
    const btn = $('btn-export-pdf');
    const original = btn.innerHTML;
    btn.innerHTML = '⏳ Đang tạo PDF...';
    btn.disabled = true;
    try {
      await exportWorksheetToPDF(list, parseInt(rowsEl.value, 10) || 2);
    } catch (err) {
      alert('Không thể xuất PDF: ' + err.message);
    } finally {
      btn.innerHTML = original;
      btn.disabled = false;
    }
  });
}

renderWordList();
selectWord(0);
initFreehandCanvases();
bindEvents();
