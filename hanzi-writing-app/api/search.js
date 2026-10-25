// File: api/search.js
import { MongoClient } from 'mongodb';

// Tái sử dụng kết nối MongoDB giữa các lần gọi (Serverless Connection Pooling)
let cachedClient = null;

async function getMongoClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Chưa cấu hình biến môi trường MONGODB_URI');
  }
  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
    await cachedClient.connect();
  }
  return cachedClient;
}

const clean = (s) => (s || '').replace(/[\u200b\u200c\u200d]/g, '').trim();
const norm = (s) => clean(s).toLowerCase().normalize('NFC');

// Tách nghĩa tiếng Việt thành các nghĩa thành phần, bỏ phần chú thích trong ngoặc
function segments(vi) {
  return norm(vi)
    .split(/[\/;,]+/)
    .map((s) => s.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Chấm điểm độ khớp của một mục từ điển so với từ khóa tiếng Việt
function scoreEntry(entry, q) {
  const segs = segments(entry.vi);
  const zhLen = Array.from(entry.zh || '').length;
  let score = 0;

  if (segs.includes(q)) {
    score = 100;
    // Nghĩa càng ít thành phần càng chuyên biệt cho từ khóa
    score -= (segs.length - 1) * 4;
  } else if (segs.some((s) => s.startsWith(q + ' '))) {
    score = 60;
  } else if (segs.some((s) => new RegExp(`(^|\\s)${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s)`).test(s))) {
    score = 40;
  } else {
    score = 15;
  }

  // Ưu tiên từ ngắn gọn (2 chữ là đẹp nhất để luyện viết), nghĩa ngắn gọn
  score -= Math.abs(zhLen - 2) * 3;
  score -= Math.min(10, norm(entry.vi).length * 0.05);
  // Mục có ghi chú phương ngữ/Đài Loan... thường kém phổ biến
  if (/\(đài loan\)|\(phương ngữ\)|\(cổ\)|\(văn\)/i.test(entry.vi)) score -= 8;
  return score;
}

// Rút gọn nghĩa hiển thị: bỏ ghi chú lượng từ / tham chiếu chữ Hán, giữ nghĩa khớp từ khóa + tối đa 2 nghĩa gần nhất
function cleanMeaning(vi, query) {
  const segs = segments(vi).filter((s) => !/[\[\]|]|^lt:|lượng từ|\bxem\b/.test(s) && !/[\u3400-\u9fff]/.test(s));
  if (!segs.length) return clean(query);
  const q = norm(query);
  const rest = segs.filter((s) => s !== q).slice(0, 1);
  return [q, ...rest].join(' / ');
}

// Nhờ AI chọn trong danh sách ứng viên của MongoDB từ tiếng Trung thông dụng, tự nhiên nhất.
// AI chỉ được chọn số thứ tự, không tự dịch. Lỗi/timeout -> trả -1 (dùng ứng viên xếp hạng cao nhất).
async function pickMostCommon(query, entries) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return -1;

  const list = entries
    .map((e, i) => `${i}. ${clean(e.zh)} (${clean(e.pinyin).replace(/\s+/g, ' ')}) - ${segments(e.vi).slice(0, 3).join(' / ')}`)
    .join('\n');
  const prompt = `Từ tiếng Việt: "${query}".\nChọn MỘT từ tiếng Trung thông dụng, tự nhiên và chính xác nhất cho từ này trong các ứng viên:\n${list}\nChỉ trả về JSON: {"index": số thứ tự}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    for (const model of ["gemini-3.5-flash-lite", "gemini-3.8-flash"]) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 30 }
          })
        }
      );
      if (!r.ok) continue;
      const data = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      const idx = Number(JSON.parse(text)?.index);
      if (Number.isInteger(idx) && idx >= 0 && idx < entries.length) return idx;
    }
  } catch (e) {
    console.warn('AI chọn ứng viên lỗi:', e.message);
  } finally {
    clearTimeout(timer);
  }
  return -1;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = (req.query?.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Thiếu từ khóa tìm kiếm' });
  }

  try {
    const client = await getMongoClient();
    const dbName = process.env.MONGODB_DB || "hanzi_app";
    const collName = process.env.MONGODB_COLLECTION || "dictionary";
    const collection = client.db(dbName).collection(collName);

    const respond = (r, score, exact) =>
      res.status(200).json({
        hanzi: clean(r.zh || r.tw),
        hanzi_tw: clean(r.tw || r.zh),
        pinyin: clean((r.pinyin || '').replace(/[\u200b\u200c\u200d]+/g, ' ')).replace(/\s+/g, ' '),
        meaning: cleanMeaning(r.vi, query),
        score,
        exact
      });

    // 1. Người dùng nhập chữ Hán -> khớp chính xác
    const byHanzi = await collection.findOne({ $or: [{ zh: query }, { tw: query }] });
    if (byHanzi) return respond(byHanzi, 100, true);

    // 2. Tìm theo nghĩa tiếng Việt: chỉ nhận ứng viên có nghĩa TRÙNG KHỚP ĐÚNG với từ khóa
    const q = norm(query);
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const raw = await collection
      .find({ vi: { $regex: escaped, $options: 'i' } })
      .limit(1000)
      .toArray();

    // Bỏ mục có ký tự không phải chữ Hán (VD: "3Q", "K书")
    const hanOnly = raw.filter((c) => /^[\u3400-\u9fff]+$/.test(clean(c.zh)));
    // Ưu tiên nghĩa chính (thành phần đầu tiên) trùng khớp; nếu không có thì nghĩa phụ trùng khớp
    const primary = hanOnly.filter((c) => segments(c.vi)[0] === q);
    const secondary = hanOnly.filter((c) => segments(c.vi).includes(q));
    const pool = primary.length ? primary : secondary;

    if (pool.length === 1) return respond(pool[0], 100, true);

    if (pool.length > 1) {
      // Xếp hạng sơ bộ, giữ tối đa 12 ứng viên, rồi nhờ AI chọn từ thông dụng nhất trong số đó
      const ranked = pool
        .map((c) => ({ c, s: scoreEntry(c, q) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 12);
      const idx = await pickMostCommon(query, ranked.map((r) => r.c));
      const chosen = ranked[idx >= 0 ? idx : 0];
      return respond(chosen.c, chosen.s, true);
    }

    // Không có ứng viên khớp nghĩa -> trả 404 để frontend chuyển sang AI dịch

    return res.status(404).json({ message: 'Không tìm thấy trong từ điển MongoDB' });
  } catch (err) {
    console.error("Lỗi tra cứu MongoDB:", err);
    return res.status(500).json({ error: 'Lỗi kết nối cơ sở dữ liệu MongoDB: ' + err.message });
  }
}
