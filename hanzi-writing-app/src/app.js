import './style.css';

// ==========================================
// 2. KHỞI TẠO HANZI WRITER & UI
// ==========================================
let writer;
let currentHanzi = '';

function initHanziWriter(char) {
  const container = document.getElementById('hanzi-character');
  container.innerHTML = '';
  writer = HanziWriter.create('hanzi-character', char, {
    width: 300,
    height: 300,
    padding: 20,
    showOutline: true,
    strokeAnimationSpeed: 1.5,
    delayBetweenStrokes: 150,
    outlineColor: '#B0C4DE', // lightsteelblue
    strokeColor: '#1e293b'
  });
}

// ==========================================
// 3. TÌM KIẾM TỪ MONGODB & GEMINI FALLBACK
// ==========================================
async function translateWithAI(text) {
  // Gọi tới API serverless của Vercel thay vì gọi Google API trực tiếp
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error("Lỗi API Backend");
  }

  // Kết quả trả về đã được format sẵn là JSON chứa hanzi, pinyin, meaning
  return await response.json();
}

async function searchDictionary(keyword) {
  try {
    // Gọi tới API backend Vercel của bạn (ví dụ: api/search.js truy vấn tới MongoDB URL bạn đã cung cấp)
    const res = await fetch(`/api/search?q=${encodeURIComponent(keyword)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.hanzi) return data;
    }
  } catch (error) {
    console.warn("Không tìm thấy trong MongoDB, đang dùng Gemini Fallback...");
  }
  
  // Fallback dùng Gemini API
  return await translateWithAI(keyword);
}

document.getElementById('search-btn').addEventListener('click', async () => {
  const keyword = document.getElementById('search-input').value.trim();
  if (!keyword) return;

  document.getElementById('char-display').innerText = "⏳...";
  try {
    const result = await searchDictionary(keyword);
    document.getElementById('char-display').innerText = result.hanzi;
    document.getElementById('pinyin-display').innerText = `Pinyin: ${result.pinyin}`;
    document.getElementById('meaning-display').innerText = `Nghĩa: ${result.meaning}`;
    currentHanzi = result.hanzi;
    initHanziWriter(result.hanzi.charAt(0));
  } catch (err) {
    alert("Không thể tìm kiếm từ này.");
  }
});

// Nút tương tác HanziWriter
document.getElementById('animate-btn').addEventListener('click', () => { if (writer) writer.animateCharacter(); });
document.getElementById('quiz-btn').addEventListener('click', () => { if (writer) writer.quiz(); });

// ==========================================
// 4. CANVAS: TÍNH NĂNG XÓA THEO NÉT BÚT
// ==========================================
const canvas = document.getElementById('freehand-canvas');
const ctx = canvas.getContext('2d');
let strokes = []; 
let currentStroke = [];
let isDrawing = false;
let currentTool = 'pen'; // 'pen' | 'eraser'
const ERASER_RADIUS = 15;

function redrawAllStrokes() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 4;

  strokes.forEach(stroke => {
    if (stroke.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
  });
}

function isStrokeHit(stroke, x, y) {
  for (let i = 0; i < stroke.length; i++) {
    const dx = stroke[i].x - x;
    const dy = stroke[i].y - y;
    if (Math.hypot(dx, dy) <= ERASER_RADIUS) return true;
  }
  return false;
}

function eraseStrokeAt(x, y) {
  const initialLength = strokes.length;
  strokes = strokes.filter(stroke => !isStrokeHit(stroke, x, y));
  if (strokes.length !== initialLength) redrawAllStrokes();
}

function getPointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height)
  };
}

function startDrawing(e) {
  e.preventDefault();
  isDrawing = true;
  const pos = getPointerPos(e);
  if (currentTool === 'eraser') {
    eraseStrokeAt(pos.x, pos.y);
  } else {
    currentStroke = [pos];
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 4;
    ctx.moveTo(pos.x, pos.y);
  }
}

function draw(e) {
  if (!isDrawing) return;
  e.preventDefault();
  const pos = getPointerPos(e);
  if (currentTool === 'eraser') {
    eraseStrokeAt(pos.x, pos.y);
  } else {
    currentStroke.push(pos);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }
}

function stopDrawing() {
  if (!isDrawing) return;
  isDrawing = false;
  if (currentTool === 'pen' && currentStroke.length > 0) {
    strokes.push(currentStroke);
    currentStroke = [];
  }
}

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
window.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('touchstart', startDrawing, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
window.addEventListener('touchend', stopDrawing);

// Các nút điều khiển Canvas
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const tool = e.target.getAttribute('data-tool');
    if (tool === 'pen' || tool === 'eraser') {
      currentTool = tool;
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
    } else if (e.target.id === 'undo-btn') {
      strokes.pop();
      redrawAllStrokes();
    } else if (e.target.id === 'clear-btn') {
      strokes = [];
      redrawAllStrokes();
    }
  });
});

// ==========================================
// 5. XUẤT PDF (html2pdf)
// ==========================================
document.getElementById('export-pdf-btn').addEventListener('click', () => {
  const rows = document.getElementById('practice-rows-select').value;
  alert(`Bắt đầu tạo PDF với ${rows} dòng luyện tập cho chữ ${currentHanzi || 'chưa chọn'}. (Cần triển khai logic render HTML lưới tại đây để html2pdf chụp)`);
  // Gọi html2pdf logic của bạn ở đây
});