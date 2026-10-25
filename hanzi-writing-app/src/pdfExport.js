// Module tạo trang bài tập PDF giống hệt mẫu "BÀI 4.1 - VIẾT CHỮ"
// Tự động tải dữ liệu SVG từng nét từ HanziWriter CDN và vẽ nét mới màu đỏ, nét cũ màu đen

const charDataCache = {};

export async function fetchCharData(char) {
  if (charDataCache[char]) return charDataCache[char];
  try {
    const data = await window.HanziWriter.loadCharacterData(char);
    charDataCache[char] = data;
    return data;
  } catch (e) {
    console.warn("Không tải được dữ liệu nét của chữ:", char, e);
    return null;
  }
}

/**
 * Tạo SVG hiển thị thứ tự nét từ nét 1 -> nét thứ `stepIndex`
 * Nét hiện tại (stepIndex) tô màu đỏ (#ef4444), các nét trước đó tô màu đen (#1e293b)
 */
export function createProgressiveStrokeSVG(strokes, stepIndex, size = 28) {
  const paths = strokes.slice(0, stepIndex + 1).map((d, idx) => {
    const color = idx === stepIndex ? "#e11d48" : "#1e293b";
    return `<path d="${d}" fill="${color}"></path>`;
  }).join("");

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 1024 1024" style="display:inline-block; vertical-align:middle;">
      <g transform="scale(1, -1) translate(0, -900)">
        ${paths}
      </g>
    </svg>
  `;
}

/**
 * Tạo SVG chữ mẫu hoặc chữ mờ cho vào ô chữ Điền trong PDF
 * (Dùng trực tiếp vector của HanziWriter để đảm bảo máy nào xuất PDF cũng ra đúng font Khải Thể chuẩn)
 */
export function createFullCharSVG(strokes, color = "#111827", size = 42) {
  if (!strokes) return "";
  const paths = strokes.map(d => `<path d="${d}" fill="${color}"></path>`).join("");
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 1024 1024" style="position:relative; z-index:2;">
      <g transform="scale(1, -1) translate(0, -900)">
        ${paths}
      </g>
    </svg>
  `;
}

export async function exportWorksheetToPDF(wordList, rowsPerWord = 2) {
  const sheet = document.getElementById("pdf-sheet");
  sheet.innerHTML = "";

  for (const item of wordList) {
    const chars = Array.from(item.chars);
    const pinyins = item.pinyin.trim().split(/\s+/);

    // Tải dữ liệu nét của từng chữ trong từ
    const charDataList = await Promise.all(chars.map(c => fetchCharData(c)));

    // 1. Cột bên trái: Pinyin + Chữ Hán mẫu lớn
    const leftColsHtml = chars.map((ch, idx) => {
      const py = pinyins[idx] || "";
      const cData = charDataList[idx];
      const svgChar = cData ? createFullCharSVG(cData.strokes, "#111827", 46) : ch;
      return `
        <div class="pdf-char-col">
          <div class="pdf-pinyin-cell">${py}</div>
          <div class="pdf-big-char-cell">${svgChar}</div>
        </div>
      `;
    }).join("");

    // 2. Cột bên phải: Số nét (VD: 6画, 9画) + Dãy hình vẽ từng nét từ nét 1 -> hết
    const strokeLinesHtml = chars.map((ch, idx) => {
      const cData = charDataList[idx];
      if (!cData || !cData.strokes) {
        return `<div class="pdf-stroke-line"><span class="pdf-stroke-count">?画</span></div>`;
      }
      const totalStrokes = cData.strokes.length;
      let stepsSvg = "";
      for (let s = 0; s < totalStrokes; s++) {
        stepsSvg += createProgressiveStrokeSVG(cData.strokes, s, 26);
      }
      return `
        <div class="pdf-stroke-line">
          <span class="pdf-stroke-count">${totalStrokes}画</span>
          ${stepsSvg}
        </div>
      `;
    }).join("");

    // 3. Các dòng ô chữ Điền (12 ô mỗi dòng)
    let practiceRowsHtml = "";
    for (let r = 0; r < rowsPerWord; r++) {
      let cellsHtml = "";
      for (let col = 0; col < 12; col++) {
        const charIdx = col % chars.length;
        const cData = charDataList[charIdx];
        let innerSvg = "";

        // Dòng đầu tiên: 6 ô đầu in chữ màu xanh mẫu, 2 ô tiếp theo in chữ mờ xám để đồ theo, các ô còn lại để trống
        if (r === 0 && col < chars.length * 2) {
          innerSvg = cData ? createFullCharSVG(cData.strokes, "#2563eb", 36) : "";
        } else if (r === 0 && col < chars.length * 3) {
          innerSvg = cData ? createFullCharSVG(cData.strokes, "#cbd5e1", 36) : "";
        }

        cellsHtml += `<div class="pdf-tian-cell">${innerSvg}</div>`;
      }
      practiceRowsHtml += `<div class="pdf-grid-row">${cellsHtml}</div>`;
    }

    const blockHtml = `
      <div class="pdf-word-block">
        <div class="pdf-header-row">
          <div class="pdf-char-columns">${leftColsHtml}</div>
          <div class="pdf-strokes-area">${strokeLinesHtml}</div>
        </div>
        ${practiceRowsHtml}
      </div>
    `;

    sheet.insertAdjacentHTML("beforeend", blockHtml);
  }

  const opt = {
    margin: [8, 10, 8, 10],
    filename: "Bai-Tap-Viet-Chu-Han.pdf",
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
  };

  await window.html2pdf().set(opt).from(sheet).save();
}
