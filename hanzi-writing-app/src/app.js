import { initDatabase, saveProgress, loadProgress } from "./firebase.js";
import { fetchCharData, createProgressiveStrokeSVG, exportWorksheetToPDF } from "./pdfExport.js";

// Danh sách từ vựng Đài ngữ (Taigi Hanji - POJ - English) mặc định
const DEFAULT_WORDS = [
  { chars: "你好", pinyin: "lí hó", meaning: "Hello / How are you" },
  { chars: "多謝", pinyin: "to-siā", meaning: "Thank you / Many thanks" },
  { chars: "臺灣", pinyin: "Tâi-oân", meaning: "Taiwan" },
  { chars: "學習", pinyin: "ha̍k-si̍p", meaning: "To learn / To study" }
];

let words = JSON.parse(localStorage.getItem("hanzi_wordlist") || "null") || DEFAULT_WORDS;
// Set lưu index các từ đã được chọn để xuất PDF
let selectedWordIndices = new Set(words.map((_, i) => i));
let currentWordIndex = 0;
let currentCharIndex = 0;
let writer = null;
let showOutline = true;
let learnedChars = new Set();

// Bộ nhớ đệm từ điển Open Source ChhoeTaigi trên RAM
let openSourceDict = null;
let dictLoadPromise = null;

// Tải ngầm và tiền xử lý từ điển ChhoeTaigi 1 lần duy nhất
function loadOpenSourceDictionary() {
  if (openSourceDict) return Promise.resolve(openSourceDict);
  if (dictLoadPromise) return dictLoadPromise;

  dictLoadPromise = fetch("/dictionary.json")
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      // Tiền xử lý chuỗi tìm kiếm để tra cứu 40.000+ từ trong < 1ms
      openSourceDict = data.map(item => {
        const mLower = (item.meaning || "").toLowerCase();
        const pLower = (item.pinyin || "").toLowerCase();
        // Tách nghĩa tiếng Anh theo dấu phẩy/chấm phẩy và bỏ từ "to " ở đầu động từ
        const tokens = mLower
          .split(/[,;/]+/)
          .map(s => s.replace(/^\(.*?\)\s*/, "").trim())
          .filter(Boolean);
        return {
          chars: item.chars,
          pinyin: item.pinyin || "",
          meaning: item.meaning || "",
          _mLower: mLower,
          _pLower: pLower,
          _tokens: tokens
        };
      });
      console.log(`✅ Đã nạp ${openSourceDict.length} từ vựng Anh - Đài (ChhoeTaigi).`);
      return openSourceDict;
    })
    .catch(err => {
      console.warn("⚠️ Không tải được /dictionary.json, sẽ dùng Gemini AI fallback:", err.message);
      openSourceDict = [];
      return openSourceDict;
    });

  return dictLoadPromise;
}

// Thuật toán tìm kiếm có xếp hạng độ ưu tiên trong từ điển ChhoeTaigi
function searchInTaigiDictionary(rawQuery) {
  if (!openSourceDict || openSourceDict.length === 0) return null;

  const q = rawQuery.trim().toLowerCase();
  const qNoTo = q.replace(/^to\s+/, ""); // Hỗ trợ tìm động từ cả khi gõ "eat" lẫn "to eat"

  let bestItem = null;
  let bestScore = -1;

  for (let i = 0; i < openSourceDict.length; i++) {
    const item = openSourceDict[i];
    let score = 0;

    // 1. Khớp chính xác chữ Hán hoặc phiên âm POJ
    if (item.chars === rawQuery.trim() || item._pLower === q) {
      score = 100;
    }
    // 2. Khớp chính xác toàn bộ nghĩa tiếng Anh
    else if (item._mLower === q || item._mLower === `to ${qNoTo}`) {
      score = 90;
    }
    // 3. Khớp chính xác 1 nghĩa thành phần (VD: "tea, infusion" khớp với "tea")
    else if (item._tokens.includes(q) || item._tokens.includes(`to ${qNoTo}`) || item._tokens.includes(qNoTo)) {
      score = 80;
    }
    // 4. Nghĩa thành phần bắt đầu bằng từ khóa (ngăn cách bởi khoảng trắng)
    else if (item._tokens.some(t => t.startsWith(q + " ") || t === `a ${q}` || t === `the ${q}`)) {
      score = 65;
    }
    // 5. Chứa nguyên từ (Word boundary) trong câu nghĩa
    else if (item._mLower.includes(q)) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`).test(item._mLower)) {
        score = 50;
      } else {
        score = 25;
      }
    }

    if (score > 0) {
      // Ưu tiên các từ vựng ngắn (1 - 3 chữ Hán) để luyện viết đẹp nhất và nghĩa ngắn gọn
      const charPenalty = Math.max(0, item.chars.length - 2) * 2;
      const lengthPenalty = Math.min(10, item._mLower.length * 0.08);
      const finalScore = score - charPenalty - lengthPenalty;

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestItem = item;
      }
    }
  }

  return bestItem;
}

async function initApp() {
  // Tải từ điển ChhoeTaigi song song ngay khi khởi động
  loadOpenSourceDictionary();

  // Đổi nhãn giao diện tìm kiếm sang Anh - Đài (nếu có trên DOM)
  const searchInput = document.getElementById("vi-search-input");
  if (searchInput) {
    searchInput.placeholder = "Nhập từ tiếng Anh, POJ hoặc chữ Hán (VD: hello, tea, school)...";
  }

  await initDatabase();
  learnedChars = await loadProgress();
  // Khởi tạo set chọn từ: mặc định chọn tất cả
  selectedWordIndices = new Set(words.map((_, i) => i));
  renderWordList();
  selectWord(0);
  initFreehandCanvases();
  bindEvents();
}

function saveWordList() {
  localStorage.setItem("hanzi_wordlist", JSON.stringify(words));
}

function addNewWordToTop(newWord) {
  // Nếu từ này đã có trong danh sách thì đưa lên đầu thay vì tạo trùng
  const existingIdx = words.findIndex(w => w.chars === newWord.chars);
  if (existingIdx !== -1) {
    words.splice(existingIdx, 1);
    selectedWordIndices = new Set(
      [...selectedWordIndices]
        .filter(i => i !== existingIdx)
        .map(i => (i > existingIdx ? i - 1 : i))
    );
  }

  words.unshift(newWord);
  selectedWordIndices = new Set([0, ...[...selectedWordIndices].map(i => i + 1)]);
  saveWordList();
  renderWordList();
  selectWord(0);
}

function renderWordList() {
  const listEl = document.getElementById("word-list");
  listEl.innerHTML = "";

  words.forEach((item, idx) => {
    const isActive = idx === currentWordIndex;
    const allLearned = Array.from(item.chars).every(c => learnedChars.has(c));
    const isSelected = selectedWordIndices.has(idx);

    const div = document.createElement("div");
    div.className = `p-3 rounded-lg border cursor-pointer transition flex justify-between items-center ${
      isActive ? "border-[#b5a898] bg-[#efeae1]/80" : "border-[#e6e0d6] hover:bg-[#f5f2eb]"
    }`;
    div.innerHTML = `
      <label class="flex items-center gap-2 cursor-pointer" title="Chọn để xuất PDF">
        <input type="checkbox" class="word-select-cb w-4 h-4 accent-[#6e7f74] rounded flex-shrink-0" data-idx="${idx}" ${isSelected ? "checked" : ""} />
      </label>
      <div class="flex-1 ml-1 min-w-0" data-nav="${idx}">
        <div class="flex items-center gap-2">
          <span class="text-xl font-bold font-serif text-[#3d3833]">${item.chars}</span>
          <span class="text-xs font-medium text-[#7c6a56]">${item.pinyin}</span>
          ${allLearned ? '<span class="text-xs bg-[#e4ebe6] text-[#526358] px-1.5 py-0.5 rounded">✓ Đã thuộc</span>' : ""}
        </div>
        <p class="text-xs text-[#857d73] mt-0.5 truncate" title="${item.meaning}">${item.meaning}</p>
      </div>
      <button class="btn-delete-word text-[#c7bfb5] hover:text-rose-400 px-2 py-1 text-sm" data-idx="${idx}" title="Xóa từ">&times;</button>
    `;

    // Checkbox chọn để xuất PDF
    div.querySelector(".word-select-cb").addEventListener("change", (e) => {
      e.stopPropagation();
      if (e.target.checked) selectedWordIndices.add(idx);
      else selectedWordIndices.delete(idx);
      updateSelectAllBtn();
    });

    // Click vào phần nội dung từ → chuyển sang luyện
    div.querySelector("[data-nav]").addEventListener("click", () => selectWord(idx));

    // Nút xóa từ
    div.querySelector(".btn-delete-word").addEventListener("click", (e) => {
      e.stopPropagation();
      if (words.length > 1) {
        words.splice(idx, 1);
        selectedWordIndices = new Set([...selectedWordIndices].filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
        saveWordList();
        if (currentWordIndex >= words.length) currentWordIndex = 0;
        renderWordList();
        selectWord(currentWordIndex);
      }
    });

    listEl.appendChild(div);
  });

  document.getElementById("learned-counter").textContent = `Đã thuộc: ${learnedChars.size} chữ`;
  updateSelectAllBtn();
}

function updateSelectAllBtn() {
  const btn = document.getElementById("btn-toggle-select-all");
  if (!btn) return;
  const allSelected = words.every((_, i) => selectedWordIndices.has(i));
  btn.textContent = allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả";
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
      active
        ? "bg-[#6e7f74] text-[#faf8f5] border-[#6e7f74]"
        : "bg-[#faf8f5] text-[#57514a] border-[#dfd9ce] hover:bg-[#efeae1]"
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
    strokeColor: "#2C3E35",   // Xám đen trầm ấm (giúp nổi bật trên nền Mint)
    radicalColor: "#557A6B",  // Xanh Mint đậm cho bộ thủ
    outlineColor: "#C4D6CD",  // Nét mờ Mint nhẹ
    drawingWidth: 22
  });

  // Hiển thị thứ tự từng nét bên cạnh
  const previewEl = document.getElementById("stroke-order-preview");
  const badgeEl = document.getElementById("stroke-count-badge");
  previewEl.innerHTML = '<span class="text-xs text-slate-400">Đang tải thứ tự nét...</span>';

  const charData = await fetchCharData(char);
  if (charData && charData.strokes) {
    badgeEl.textContent = `${charData.strokes.length}畫 (Nét)`;
    previewEl.innerHTML = charData.strokes
      .map((_, sIdx) => `
        <div class="p-1 bg-white border border-slate-200 rounded shadow-2xs">
          ${createProgressiveStrokeSVG(charData.strokes, sIdx, 36)}
        </div>
      `)
      .join("");
  } else {
    badgeEl.textContent = "?畫";
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
    ctx.strokeStyle = "#2C3E35"; // Màu mực tàu trầm ấm 
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

// Tra cứu & Dịch Tiếng Anh sang Đài ngữ (Taigi Hanji + POJ):
// - Lớp 1: Tìm tức thì (0ms) trong từ điển mở ChhoeTaigi (/dictionary.json)
// - Lớp 2: Fallback sang Gemini AI (gemini-3.8-flash) nếu từ chưa có trong từ điển
async function translateEnglishToTaigi(queryText) {
  const query = queryText.trim();
  if (!query) return;

  const statusEl = document.getElementById("ai-status");
  statusEl.textContent = "⚡ Đang tra từ điển ChhoeTaigi...";
  statusEl.classList.remove("hidden");

  try {
    // 1. Đảm bảo từ điển đã nạp xong và tìm kiếm Offline trước
    await loadOpenSourceDictionary();
    const dictMatch = searchInTaigiDictionary(query);

    if (dictMatch) {
      addNewWordToTop({
        chars: dictMatch.chars,
        pinyin: dictMatch.pinyin,
        meaning: dictMatch.meaning
      });
      document.getElementById("vi-search-input").value = "";
      return; // Hoàn tất tức thì, không cần gọi API
    }

    // 2. Nếu không có trong từ điển Offline -> Gọi Gemini AI Fallback
    const rawKey = localStorage.getItem("gemini_api_key") || import.meta.env?.VITE_GEMINI_API_KEY || "";
    const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");

    if (!apiKey) {
      alert(`Không tìm thấy "${query}" trong từ điển ChhoeTaigi offline.\nVui lòng bấm '⚙️ Cấu hình' để nhập Gemini API Key nếu muốn dịch bằng AI!`);
      document.getElementById("settings-modal").classList.remove("hidden");
      document.getElementById("settings-modal").classList.add("flex");
      return;
    }

    statusEl.textContent = "🤖 Đang dịch Anh - Đài bằng AI...";

    const modelName = "gemini-3.8-flash";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Translate the English term "${query}" into Taiwanese Hokkien (Taigi) using Traditional Hanji characters and Pe̍h-ōe-jī (POJ) romanization. Return ONLY plain JSON without markdown: {"chars":"Traditional Taiwanese Hanji","pinyin":"POJ with tone marks","meaning":"English meaning"}`
              }]
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 200
            }
          })
        }
      );

      clearTimeout(timeoutId);

      const rawResponseText = await response.text();
      let data;
      try {
        data = JSON.parse(rawResponseText);
      } catch {
        throw new Error(`Phản hồi không phải JSON hợp lệ: ${rawResponseText.slice(0, 100)}`);
      }

      if (!response.ok || data.error) {
        const errCode = data?.error?.status || response.status;
        const errMsg = data?.error?.message || "Lỗi HTTP";
        throw new Error(`[${modelName}] ${errCode}: ${errMsg}`);
      }

      let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      rawText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Phản hồi AI không chứa JSON: " + rawText.slice(0, 60));
      }

      const result = JSON.parse(jsonMatch[0]);
      if (result && result.chars) {
        addNewWordToTop({
          chars: result.chars.trim(),
          pinyin: (result.pinyin || "").trim(),
          meaning: (result.meaning || query).trim()
        });
        document.getElementById("vi-search-input").value = "";
      }
    } catch (innerErr) {
      clearTimeout(timeoutId);
      throw innerErr;
    }
  } catch (err) {
    if (err.name === "AbortError") {
      alert("Quá thời gian phản hồi (>10s). Vui lòng thử lại!");
    } else {
      alert("Lỗi tra cứu / dịch AI:\n" + err.message);
    }
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

  // Tìm kiếm Từ điển ChhoeTaigi + AI Fallback (Anh -> Đài)
  document.getElementById("btn-translate-ai").addEventListener("click", () => {
    const val = document.getElementById("vi-search-input").value.trim();
    if (val) translateEnglishToTaigi(val);
  });

  document.getElementById("vi-search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = e.target.value.trim();
      if (val) translateEnglishToTaigi(val);
    }
  });

  // Thêm từ thủ công
  document.getElementById("btn-add-manual").addEventListener("click", () => {
    const chars = document.getElementById("manual-hanzi").value.trim();
    const pinyin = document.getElementById("manual-pinyin").value.trim();
    const meaning = document.getElementById("manual-meaning").value.trim();
    if (!chars) return alert("Vui lòng nhập chữ Hán (Hanji)!");

    words.push({
      chars,
      pinyin: pinyin || "",
      meaning: meaning || "Custom word"
    });
    selectedWordIndices.add(words.length - 1);
    saveWordList();
    renderWordList();
    selectWord(words.length - 1);

    document.getElementById("manual-hanzi").value = "";
    document.getElementById("manual-pinyin").value = "";
    document.getElementById("manual-meaning").value = "";
  });

  // Xuất PDF - chỉ xuất các từ được chọn (checkbox) trong danh sách
  document.getElementById("btn-export-pdf").addEventListener("click", async () => {
    const btn = document.getElementById("btn-export-pdf");

    const selectedWords = words.filter((_, i) => selectedWordIndices.has(i));
    if (selectedWords.length === 0) {
      alert("Vui lòng chọn ít nhất một từ trong danh sách để xuất PDF!");
      return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = "⏳ Đang tạo PDF...";
    btn.disabled = true;
    try {
      const inlineRows = document.getElementById("inline-pdf-rows");
      const rowsPerWord = parseInt(inlineRows ? inlineRows.value : (localStorage.getItem("pdf_rows") || "2"), 10);
      await exportWorksheetToPDF(selectedWords, rowsPerWord);
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });

  // Nút chọn tất cả / bỏ chọn tất cả từ để xuất PDF
  document.getElementById("btn-toggle-select-all").addEventListener("click", () => {
    const allSelected = words.every((_, i) => selectedWordIndices.has(i));
    if (allSelected) {
      selectedWordIndices.clear();
    } else {
      words.forEach((_, i) => selectedWordIndices.add(i));
    }
    renderWordList();
  });

  // Dropdown số dòng inline trên header - đồng bộ với localStorage
  const inlineRowsEl = document.getElementById("inline-pdf-rows");
  if (inlineRowsEl) {
    inlineRowsEl.value = localStorage.getItem("pdf_rows") || "2";
    inlineRowsEl.addEventListener("change", () => {
      localStorage.setItem("pdf_rows", inlineRowsEl.value);
    });
  }

  // Modal cấu hình
  const modal = document.getElementById("settings-modal");
  document.getElementById("btn-settings").addEventListener("click", () => {
    document.getElementById("input-gemini-key").value = localStorage.getItem("gemini_api_key") || "";
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  });

  document.getElementById("btn-close-modal").addEventListener("click", () => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  });

  document.getElementById("btn-save-settings").addEventListener("click", () => {
    const key = document.getElementById("input-gemini-key").value.trim();
    localStorage.setItem("gemini_api_key", key);
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  });
}

initApp();