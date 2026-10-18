# Hanzi Master - Ứng dụng Học Viết Tiếng Trung & Xuất PDF Luyện Viết

Dự án Web Full-stack (Vite + HanziWriter + Gemini AI + Firebase + html2pdf) hỗ trợ:
1. **Luyện viết tương tác trên iPad (Apple Pencil / Touch)**: Xem thứ tự nét động, chấm điểm từng nét và 4 ô chữ Điền (田字格) viết tự do không nét mờ.
2. **Tra từ Tiếng Việt sang chữ Hán bằng Gemini AI**: Tự động dịch, lấy Pinyin và tạo bài viết.
3. **Xuất file PDF chuẩn mẫu phiếu bài tập**: Có Pinyin, chữ mẫu lớn, tổng số nét (`6画`, `9画`...), tiến trình từng nét (nét mới màu đỏ, nét cũ màu đen) và lưới ô chữ Điền để in hoặc mở trong GoodNotes/Notability.
4. **Hỗ trợ PWA**: Thêm vào màn hình chính iPad chạy full-screen như ứng dụng gốc.

## Cấu trúc thư mục
```text
hanzi-writing-app/
├── public/
│   └── manifest.json       # Cấu hình PWA cho iPad/Mobile
├── src/
│   ├── app.js              # Logic chính: HanziWriter, Canvas cảm ứng, Gemini AI
│   ├── firebase.js         # Lưu tiến độ học tập (Firestore + LocalStorage fallback)
│   ├── pdfExport.js        # Render SVG từng nét (đỏ/đen) & xuất PDF khổ A4
│   └── style.css           # CSS giao diện & lưới ô chữ Điền (田字格)
├── .env.example            # Biến môi trường mẫu
├── .gitignore
├── index.html
├── package.json
├── vercel.json             # Cấu hình deploy tự động trên Vercel
└── README.md
```

## Cách chạy trên máy (Local)
```bash
npm install
npm run dev
```

## Cách đẩy lên GitHub và Deploy lên Vercel
```bash
git init
git add .
git commit -m "Initial commit: Hanzi Writing App"
git branch -M main
git remote add origin https://github.com/<username>/<repo-name>.git
git push -u origin main
```
Sau đó vào [Vercel](https://vercel.com), chọn **Add New Project** -> Import repo này -> Bấm **Deploy**.
