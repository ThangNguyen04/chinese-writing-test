import fs from "fs";
import path from "path";

function parseChhoeTaigiCSV(csvText) {
  const lines = csvText.split(/\r?\n/);
  const result = [];
  
  if (lines.length === 0) return result;

  // Lấy dòng tiêu đề và làm sạch dấu ngoặc kép
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, '').trim());
  
  // Xác định chính xác index dựa trên tên cột bạn cung cấp
  const hanjiIdx = headers.indexOf("HoaBun");
  const pojIdx = headers.indexOf("PojUnicode"); 
  const engIdx = headers.indexOf("EngBun");

  if (hanjiIdx === -1 || pojIdx === -1 || engIdx === -1) {
    console.error("❌ Lỗi: Không tìm thấy đủ các cột HoaBun, PojUnicode, hoặc EngBun trong file CSV.");
    console.log("👉 Các cột hiện có trong file của bạn:", headers);
    return [];
  }

  console.log(`⏳ Đang bóc tách file ChhoeTaigi_MaryknollTaiengSutian.csv...`);

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    
    // Tách cột an toàn (bỏ qua dấu phẩy nếu nó nằm trong ngoặc kép " ")
    const row = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const cleanRow = row.map(val => val.replace(/^"|"$/g, '').trim());
    
    const hanji = cleanRow[hanjiIdx];
    const poj = cleanRow[pojIdx];
    const english = cleanRow[engIdx];

    // Chỉ lấy từ có chữ Hán hợp lệ (bỏ qua các từ trống hoặc chỉ có dấu gạch ngang "-")
    if (hanji && hanji !== "-" && english && english !== "-") {
      result.push({
        chars: hanji,
        pinyin: poj || "",
        meaning: english
      });
    }
  }
  return result;
}

const csvFilePath = "taigi.csv";

if (!fs.existsSync(csvFilePath)) {
  console.error(`❌ Không tìm thấy file "${csvFilePath}". Hãy đảm bảo bạn đã để file này nằm cùng chỗ với file build-dict.mjs!`);
  process.exit(1);
}

const csvText = fs.readFileSync(csvFilePath, "utf-8");
const dictionary = parseChhoeTaigiCSV(csvText);

const outPath = path.join("public", "dictionary.json");
fs.mkdirSync("public", { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(dictionary), "utf-8");

console.log(`✅ Thành công! Đã lọc và xuất ${dictionary.length} từ vựng Đài - Anh ra file ${outPath}.`);