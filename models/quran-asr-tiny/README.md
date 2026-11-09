# quran-asr-tiny (نموذج القرآن التجريبي)

نموذج التعرف على تلاوة القرآن المستخدم في «نموذج القرآن (تجريبي)» في التسميع.

- المصدر: https://huggingface.co/Abdou/quran-asr-tiny — الملف `model.int8.onnx` كما هو بدون تعديل
  (SHA-256: 58de6db034bb4f6516b3bc1c68e7a0ac4e77abffe603a550ee87b39dcd0c7ac6)
- الرخصة: MIT (انظر `LICENSE`)، © Abdou
- البحث: Small Conformer-CTC Models for On-Device Quranic Recitation Recognition — https://doi.org/10.5281/zenodo.23761691
- طريقة الاستخدام عندنا: `js/asr/core.js` (خصائص الصوت وفك CTC)، `js/asr/worker.js` (تشغيل النموذج بـ onnxruntime-web)،
  `js/asr/segmenter.js` (تقطيع الصوت بالوقفات)، `js/asr/listener.js` (الميكروفون)
