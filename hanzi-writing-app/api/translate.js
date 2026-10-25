// File: api/translate.js
export default async function handler(req, res) {
  // Cho phép CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Chỉ nhận method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const text = (body.text || '').trim();

  if (!text) {
    return res.status(400).json({ error: 'Thiếu từ khóa cần dịch' });
  }

  // Lấy API Key từ biến môi trường
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Server thiếu cấu hình API Key (GEMINI_API_KEY)' });
  }

  const scriptLabel = body.script === 'traditional' ? 'chữ Hán phồn thể (Traditional Chinese)' : 'chữ Hán giản thể (Simplified Chinese)';
  const prompt = `Bạn là từ điển Trung - Việt chuyên nghiệp.
Đầu vào có thể là: Tiếng Việt, Pinyin (có dấu hoặc không dấu), hoặc Chữ Hán.
Từ khóa cần tra cứu: "${text}".

Nhiệm vụ:
- Nếu là tiếng Việt: Dịch sang ${scriptLabel} thông dụng và tự nhiên nhất.
- Nếu là Pinyin: Nhận diện từ ghép ${scriptLabel} thông dụng nhất tương ứng với Pinyin đó.
- Nếu là chữ Hán: Giữ đúng chữ Hán (chuyển sang ${scriptLabel}), cung cấp đúng Pinyin và dịch nghĩa tiếng Việt.

Chỉ trả về đúng định dạng JSON trơn, không bọc markdown:
{"hanzi": "chữ Hán", "pinyin": "pinyin có dấu thanh điệu chuẩn, cách âm tiết bằng khoảng trắng (ví dụ: jiā tíng, bǎo bǎo)", "meaning": "nghĩa tiếng Việt ngắn gọn"}`;

  // Thử các model theo thứ tự ưu tiên
  const candidateModels = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];

  for (const model of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 120 }
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.warn(`Model ${model} thất bại (${response.status}):`, errBody);
        continue;
      }

      const data = await response.json();
      const resultText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (resultText) {
        return res.status(200).json(JSON.parse(resultText));
      }
    } catch (e) {
      console.warn(`Lỗi khi gọi model ${model}:`, e.message);
    }
  }

  return res.status(500).json({ error: 'Không thể dịch từ này bằng AI' });
}