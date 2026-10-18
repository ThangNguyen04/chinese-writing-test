import { initDatabase, saveProgress, loadProgress } from "./firebase.js";
import { fetchCharData, createProgressiveStrokeSVG, exportWorksheetToPDF } from "./pdfExport.js";

// Danh sách từ vựng mặc định giống hệt trong ảnh mẫu của bạn (年级, 暑假, 请教)
const DEFAULT_WORDS = [
  { chars: "年级", pinyin: "nián jí", meaning: "Năm học / Lớp" },
  { chars: "暑假", pinyin: "shǔ jià", meaning: "Kỳ nghỉ hè" },
  { chars: "请教", pinyin: "qǐng jiào", meaning: "Xin chỉ giáo" },
  { chars: "学习", pinyin: "xué xí", meaning: "Học tập" }
];

let words = JSON.parse(localStorage.getItem("hanzi_wordlist") || "null") || DEFAULT_WORDS;
let currentWordIndex = 0;
let currentCharIndex = 0;
let writer = null;
let showOutline = true;
let learnedChars = new Set();

async function initApp() {
  await initDatabase();
  learnedChars = await loadProgress();
  renderWordList();
  selectWord(0);
  initFreehandCanvases();
  bindEvents();
}

function saveWordList() {
  localStorage.setItem("hanzi_wordlist", JSON.stringify(words));
}

function renderWordList() {
  const listEl = document.getElementById("word-list");
  listEl.innerHTML = "";

  words.forEach((item, idx) => {
    const isActive = idx === currentWordIndex;
    const allLearned = Array.from(item.chars).every(c => learnedChars.has(c));

    const div = document.createElement("div");
    div.className = `p-3 rounded-lg border cursor-pointer transition flex justify-between items-center ${
      isActive ? "border-emerald-500 bg-emerald-50/70" : "border-slate-200 hover:bg-slate-50"
    }`;
    div.innerHTML = `
      <div>
        <div class="flex items-center gap-2">
          <span class="text-xl font-bold font-serif text-slate-800">${item.chars}</span>
          <span class="text-xs font-medium text-emerald-600">${item.pinyin}</span>
          ${allLearned ? '<span class="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">✓ Đã thuộc</span>' : ""}
        </div>
        <p class="text-xs text-slate-500 mt-0.5">${item.meaning}</p>
      </div>
      <button class="btn-delete-word text-slate-300 hover:text-rose-500 px-2 py-1 text-sm" data-idx="${idx}" title="Xóa từ">&times;</button>
    `;

    div.addEventListener("click", (e) => {
      if (e.target.classList.contains("btn-delete-word")) {
        e.stopPropagation();
        if (words.length > 1) {
          words.splice(idx, 1);
          saveWordList();
          if (currentWordIndex >= words.length) currentWordIndex = 0;
          renderWordList();
          selectWord(currentWordIndex);
        }
        return;
      }
      selectWord(idx);
    });

    listEl.appendChild(div);
  });

  document.getElementById("learned-counter").textContent = `Đã thuộc: ${learnedChars.size} chữ`;
}

function selectWord(index) {
  currentWordIndex = index;
  currentCharIndex = 0;
  const word = words[index];

  document.getElementById("current-word-title").textContent = word.chars;
  document.getElementById("current-word-pinyin").textContent = word.pinyin;
  document.getElementById("current-word-meaning").textContent = word.meaning;

  renderCharSelector();
  renderWordList();
  loadCharacterIntoWriter(Array.from(word.chars)[0]);
  clearAllCanvases();
}

function renderCharSelector() {
  const selector = document.getElementById("char-selector");
  selector.innerHTML = "";
  const chars = Array.from(words[currentWordIndex].chars);

  chars.forEach((ch, idx) => {
    const btn = document.createElement("button");
    const active = idx === currentCharIndex;
    btn.className = `w-9 h-9 rounded-lg font-serif text-lg font-bold border transition ${
      active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
    }`;
    btn.textContent = ch;
    btn.addEventListener("click", () => {
      currentCharIndex = idx;
      renderCharSelector();
      loadCharacterIntoWriter(ch);
    });
    selector.appendChild(btn);
  });
}

async function loadCharacterIntoWriter(char) {
  const target = document.getElementById("hanzi-target");
  target.innerHTML = "";
  document.getElementById("quiz-feedback").textContent = "";

  writer = window.HanziWriter.create("hanzi-target", char, {
    width: 220,
    height: 220,
    padding: 15,
    showOutline: showOutline,
    strokeAnimationSpeed: 1.2,
    delayBetweenStrokes: 250,
    strokeColor: "#0f172a",
    radicalColor: "#16a34a",
    outlineColor: "#cbd5e1",
    drawingWidth: 22
  });

  // Hiển thị thứ tự từng nét bên cạnh
  const previewEl = document.getElementById("stroke-order-preview");
  const badgeEl = document.getElementById("stroke-count-badge");
  previewEl.innerHTML = '<span class="text-xs text-slate-400">Đang tải thứ tự nét...</span>';

  const charData = await fetchCharData(char);
  if (charData && charData.strokes) {
    badgeEl.textContent = `${charData.strokes.length}画 (Nét)`;
    previewEl.innerHTML = charData.strokes
      .map((_, sIdx) => `
        <div class="p-1 bg-white border border-slate-200 rounded shadow-2xs">
          ${createProgressiveStrokeSVG(charData.strokes, sIdx, 36)}
        </div>
      `)
      .join("");
  } else {
    badgeEl.textContent = "?画";
    previewEl.innerHTML = '<span class="text-xs text-rose-500">Không tìm thấy dữ liệu nét chữ này.</span>';
  }
}

// Khởi tạo 4 ô Canvas luyện viết tự do (Hỗ trợ Apple Pencil / Touch / Mouse)
function initFreehandCanvases() {
  const canvases = document.querySelectorAll(".freehand-canvas");
  canvases.forEach(canvas => {
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e293b";

    let drawing = false;

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const startDraw = (e) => {
      e.preventDefault();
      drawing = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    };

    const moveDraw = (e) => {
      if (!drawing) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    };

    const endDraw = (e) => {
      if (!drawing) return;
      e.preventDefault();
      drawing = false;
    };

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", moveDraw);
    window.addEventListener("mouseup", endDraw);

    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", moveDraw, { passive: false });
    canvas.addEventListener("touchend", endDraw);
  });
}

function clearAllCanvases() {
  document.querySelectorAll(".freehand-canvas").forEach(canvas => {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
}

// Dịch Tiếng Việt sang chữ Hán bằng Gemini API (Có fallback model & báo lỗi chi tiết)
async function translateVietnameseWithAI(viText) {
  const rawKey = localStorage.getItem("gemini_api_key") || import.meta.env?.VITE_GEMINI_API_KEY || "";
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");

  if (!apiKey) {
    alert("Vui lòng bấm nút '⚙️ Cấu hình' ở góc trên bên phải để nhập Gemini API Key!");
    document.getElementById("settings-modal").classList.remove("hidden");
    document.getElementById("settings-modal").classList.add("flex");
    return;
  }

  const statusEl = document.getElementById("ai-status");
  statusEl.textContent = "⚡ Đang dịch siêu tốc...";
  statusEl.classList.remove("hidden");

  // Sử dụng 1 model duy nhất theo khuyến nghị của Google để tránh lỗi NOT_FOUND
  const modelName = "gemini-3.8-flash"; 

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              // Câu lệnh (prompt) cực ngắn để AI xử lý nhanh nhất có thể
              text: `Dịch "${viText}" sang tiếng Trung giản thể. Trả về JSON: {"chars":"chữ Hán","pinyin":"phiên âm","meaning":"nghĩa"}`
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 60 // Khóa số lượng chữ trả về để ép tốc độ phản hồi tính bằng mili-giây
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok || data.error) {
      const errCode = data?.error?.status || response.status;
      const errMsg = data?.error?.message || "Lỗi HTTP";
      throw new Error(`[${modelName}] ${errCode}: ${errMsg}`);
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/); // Bóc tách JSON chính xác bỏ qua các ký tự thừa
    
    if (!jsonMatch) {
      throw new Error("Phản hồi không chứa JSON hợp lệ: " + rawText.slice(0, 50));
    }

    const result = JSON.parse(jsonMatch[0]);
    
    if (result && result.chars) {
      words.unshift({
        chars: result.chars.trim(),
        pinyin: (result.pinyin || "").trim(),
        meaning: (result.meaning || viText).trim()
      });
      saveWordList();
      renderWordList();
      selectWord(0);
      document.getElementById("vi-search-input").value = "";
    }
  } catch (err) {
    alert("Lỗi gọi Gemini AI:\n" + err.message);
  } finally {
    statusEl.classList.add("hidden");
  }
}

function bindEvents() {
  // Xem nét mẫu
  document.getElementById("btn-animate").addEventListener("click", () => {
    if (writer) writer.animateCharacter();
  });

  // Tự viết có chấm điểm
  document.getElementById("btn-quiz").addEventListener("click", () => {
    if (!writer) return;
    const currentChar = Array.from(words[currentWordIndex].chars)[currentCharIndex];
    const feedback = document.getElementById("quiz-feedback");
    feedback.textContent = "Hãy dùng bút/tay viết từng nét vào ô bên trên...";

    writer.quiz({
      onMistake: (strokeData) => {
        feedback.textContent = `Sai nét thứ ${strokeData.strokeNum + 1}! Hãy thử lại.`;
      },
      onCorrectStroke: (strokeData) => {
        feedback.textContent = `Chính xác nét ${strokeData.strokeNum + 1}!`;
      },
      onComplete: async (summaryData) => {
        feedback.textContent = `🎉 Tuyệt vời! Hoàn thành chữ "${currentChar}" (Sai ${summaryData.totalMistakes} lần).`;
        learnedChars.add(currentChar);
        await saveProgress(learnedChars);
        renderWordList();
      }
    });
  });

  // Ẩn / Hiện nét mờ
  document.getElementById("btn-toggle-outline").addEventListener("click", () => {
    if (!writer) return;
    showOutline = !showOutline;
    if (showOutline) writer.showOutline();
    else writer.hideOutline();
  });

  // Xóa 4 ô viết tự do
  document.getElementById("btn-clear-canvas").addEventListener("click", clearAllCanvases);

  // Tìm kiếm AI
  document.getElementById("btn-translate-ai").addEventListener("click", () => {
    const val = document.getElementById("vi-search-input").value.trim();
    if (val) translateVietnameseWithAI(val);
  });

  document.getElementById("vi-search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = e.target.value.trim();
      if (val) translateVietnameseWithAI(val);
    }
  });

  // Thêm từ thủ công
  document.getElementById("btn-add-manual").addEventListener("click", () => {
    const chars = document.getElementById("manual-hanzi").value.trim();
    const pinyin = document.getElementById("manual-pinyin").value.trim();
    const meaning = document.getElementById("manual-meaning").value.trim();
    if (!chars) return alert("Vui lòng nhập chữ Hán!");

    words.push({
      chars,
      pinyin: pinyin || "",
      meaning: meaning || "Từ tự thêm"
    });
    saveWordList();
    renderWordList();
    selectWord(words.length - 1);

    document.getElementById("manual-hanzi").value = "";
    document.getElementById("manual-pinyin").value = "";
    document.getElementById("manual-meaning").value = "";
  });

  // Xuất PDF
  document.getElementById("btn-export-pdf").addEventListener("click", async () => {
    const btn = document.getElementById("btn-export-pdf");
    const originalText = btn.innerHTML;
    btn.innerHTML = "⏳ Đang tạo PDF...";
    btn.disabled = true;
    try {
      const rowsPerWord = parseInt(localStorage.getItem("pdf_rows") || "2", 10);
      await exportWorksheetToPDF(words, rowsPerWord);
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });

  // Modal cấu hình
  const modal = document.getElementById("settings-modal");
  document.getElementById("btn-settings").addEventListener("click", () => {
    document.getElementById("input-gemini-key").value = localStorage.getItem("gemini_api_key") || "";
    document.getElementById("select-pdf-rows").value = localStorage.getItem("pdf_rows") || "2";
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  });

  document.getElementById("btn-close-modal").addEventListener("click", () => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  });

  document.getElementById("btn-save-settings").addEventListener("click", () => {
    const key = document.getElementById("input-gemini-key").value.trim();
    const rows = document.getElementById("select-pdf-rows").value;
    localStorage.setItem("gemini_api_key", key);
    localStorage.setItem("pdf_rows", rows);
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  });
}

initApp();
