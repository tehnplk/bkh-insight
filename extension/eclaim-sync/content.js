// รันเฉพาะหน้าของ BKH Insight (matches ใน manifest.json) ส่งต่อข้อความระหว่างหน้าเว็บ (window.postMessage) กับ sw.js
// รับเฉพาะข้อความจากหน้าเดียวกันที่ติดป้าย bkh-eclaim-page ; เนื้อหาตรวจจริงที่ sw.js (checkMessage)
window.addEventListener("message", async (e) => {
  const d = e.data;
  if (e.source !== window || e.origin !== location.origin || d?.source !== "bkh-eclaim-page" || !Number.isSafeInteger(d.id)) return;
  let res;
  try {
    res = await chrome.runtime.sendMessage(d.msg);
  } catch {
    // extension ถูกโหลดใหม่/อัปเดต แต่หน้านี้ยังถือ content script ตัวเก่า
    res = { fatal: "ติดต่อ extension ไม่ได้: รีเฟรชหน้านี้แล้วลองอีกครั้ง" };
  }
  window.postMessage({ source: "bkh-eclaim-ext", id: d.id, res: res ?? { error: "extension ไม่ตอบ" } }, location.origin);
});
