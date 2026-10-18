// Cấu hình Firebase & Lưu trữ Tiến độ học tập (Hỗ trợ cả Cloud Firestore & LocalStorage fallback)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Thay bằng cấu hình Firebase Project của bạn nếu muốn đồng bộ nhiều thiết bị
const firebaseConfig = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || "",
};

let db = null;
let auth = null;

export async function initDatabase() {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    console.info("Chưa cấu hình Firebase. Đang sử dụng LocalStorage để lưu tiến độ học tập.");
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    await signInAnonymously(auth);
  } catch (err) {
    console.warn("Firebase fallback sang LocalStorage:", err);
  }
}

export async function saveProgress(learnedChars) {
  localStorage.setItem("hanzi_learned", JSON.stringify(Array.from(learnedChars)));
  if (db && auth?.currentUser) {
    try {
      await setDoc(doc(db, "users", auth.currentUser.uid), {
        learned: Array.from(learnedChars),
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.warn("Lỗi lưu Firestore:", e);
    }
  }
}

export async function loadProgress() {
  const local = JSON.parse(localStorage.getItem("hanzi_learned") || "[]");
  const learnedSet = new Set(local);
  if (db && auth?.currentUser) {
    try {
      const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
      if (snap.exists() && snap.data().learned) {
        snap.data().learned.forEach(c => learnedSet.add(c));
      }
    } catch (e) {
      console.warn("Lỗi tải Firestore:", e);
    }
  }
  return learnedSet;
}
