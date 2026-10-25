// File: api/translate.js
export default async function handler(req, res) {
  // Chỉ nhận method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text } = req.body;
  // Lấy API Key từ biến môi trường của Vercel
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Server thiếu cấu hình API Key' });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;
  const prompt = `Dịch từ tiếng Việt "${text}" sang 1 chữ Hán đơn (nếu có thể). Trả về JSON: {"hanzi": "chữ", "pinyin": "pinyin", "meaning": "nghĩa"}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    if (!response.ok) {
      throw new Error('Lỗi từ Gemini API');
    }

    const data = await response.json();
    const resultText = data.candidates[0].content.parts[0].text;
    
    // Trả kết quả JSON về cho frontend
    return res.status(200).json(JSON.parse(resultText));

  } catch (error) {
    console.error("Lỗi gọi Gemini:", error);
    return res.status(500).json({ error: 'Không thể dịch từ này' });
  }
}