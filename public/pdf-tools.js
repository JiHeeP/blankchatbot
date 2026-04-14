import { MAX_SOURCE_TEXT_LENGTH } from "./config.js";

const PDF_MAX_FILE_BYTES = 20 * 1024 * 1024;
const PDF_MAX_PAGE_COUNT = 40;
const PDF_OCR_TEXT_THRESHOLD = 80;
const PDF_TEXT_RENDER_SCALE = 2;
const TESSERACT_CORE_VERSION = "7.0.0";

let pdfModulePromise;
let tesseractModulePromise;

export { PDF_MAX_FILE_BYTES, PDF_MAX_PAGE_COUNT, PDF_OCR_TEXT_THRESHOLD };

export async function extractPdfSourceText(file, onUpdate = () => {}) {
  validatePdfFile(file);

  const initialMeta = {
    fileName: file.name,
    fileSize: file.size,
    pageCount: 0,
    ocrPageCount: 0,
    extractedCharCount: 0,
    truncated: false,
    extractionStatus: "PDF 읽는 중",
    extractionError: "",
  };

  onUpdate(initialMeta);

  const pdfjs = await loadPdfjs();
  const fileBuffer = await file.arrayBuffer();
  const fileBytes = new Uint8Array(fileBuffer);
  const loadingTask = pdfjs.getDocument({
    data: fileBytes,
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  let pdfDocument;

  try {
    pdfDocument = await loadingTask.promise;
  } catch (error) {
    throw createReadablePdfError(error);
  }

  if (pdfDocument.numPages > PDF_MAX_PAGE_COUNT) {
    throw new Error(
      `PDF는 최대 ${PDF_MAX_PAGE_COUNT}페이지까지 업로드할 수 있습니다.`,
    );
  }

  let ocrWorker = null;
  let ocrPageCount = 0;
  let truncated = false;
  let extractionError = "";
  let extractionStatus = "텍스트 추출 중";
  let extractedCharCount = 0;
  let combinedText = "";
  let failedOcrPages = 0;

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const directText = await extractTextFromPage(page);
      let pageText = directText;

      extractionStatus = `페이지 ${pageNumber}/${pdfDocument.numPages} 텍스트 추출 중`;
      onUpdate({
        ...initialMeta,
        pageCount: pdfDocument.numPages,
        ocrPageCount,
        extractedCharCount,
        truncated,
        extractionStatus,
        extractionError,
      });

      if (directText.length < PDF_OCR_TEXT_THRESHOLD) {
        ocrPageCount += 1;
        extractionStatus = `페이지 ${pageNumber}/${pdfDocument.numPages} OCR 중`;
        onUpdate({
          ...initialMeta,
          pageCount: pdfDocument.numPages,
          ocrPageCount,
          extractedCharCount,
          truncated,
          extractionStatus,
          extractionError,
        });

        try {
          if (!ocrWorker) {
            ocrWorker = await createOcrWorker();
          }

          const ocrText = await recognizePageWithOcr(page, ocrWorker);
          if (ocrText.length > pageText.length) {
            pageText = ocrText;
          }
        } catch {
          failedOcrPages += 1;
        }
      }

      const section = buildPageSection(pageNumber, pageText);
      const nextText = combinedText ? `${combinedText}\n\n${section}` : section;

      if (nextText.length > MAX_SOURCE_TEXT_LENGTH) {
        combinedText = nextText.slice(0, MAX_SOURCE_TEXT_LENGTH).trimEnd();
        truncated = true;
      } else {
        combinedText = nextText;
      }

      extractedCharCount = combinedText.length;
    }
  } finally {
    await loadingTask.destroy().catch(() => {});

    if (ocrWorker) {
      await ocrWorker.terminate().catch(() => {});
    }
  }

  if (!stripPageMarkers(combinedText)) {
    extractionStatus = "추출 완료";
    extractionError = "추출 가능한 텍스트가 거의 없습니다. 더 선명한 PDF를 올리거나 직접 참고 자료를 입력해 주세요.";
  } else if (failedOcrPages > 0) {
    extractionStatus = "경고와 함께 완료";
    extractionError = `OCR이 ${failedOcrPages}개 페이지에서 실패했습니다. 읽어낸 텍스트만 반영했습니다.`;
  } else if (truncated) {
    extractionStatus = "일부 생략 후 완료";
  } else {
    extractionStatus = "완료";
  }

  return {
    sourceText: combinedText,
    meta: {
      ...initialMeta,
      pageCount: pdfDocument.numPages,
      ocrPageCount,
      extractedCharCount: combinedText.length,
      truncated,
      extractionStatus,
      extractionError,
    },
  };
}

function validatePdfFile(file) {
  if (!(file instanceof File)) {
    throw new Error("PDF 파일을 찾지 못했습니다.");
  }

  const lowerName = file.name.toLowerCase();
  const looksLikePdf =
    file.type === "application/pdf" || lowerName.endsWith(".pdf");

  if (!looksLikePdf) {
    throw new Error("PDF 파일만 업로드할 수 있습니다.");
  }

  if (file.size > PDF_MAX_FILE_BYTES) {
    throw new Error("PDF는 최대 20MB까지 업로드할 수 있습니다.");
  }
}

async function loadPdfjs() {
  if (!pdfModulePromise) {
    pdfModulePromise = import("./vendor/pdf.min.mjs").then((module) => {
      module.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
      return module;
    });
  }

  return pdfModulePromise;
}

async function loadTesseract() {
  if (!tesseractModulePromise) {
    tesseractModulePromise = import("./vendor/tesseract.esm.min.js");
  }

  return tesseractModulePromise;
}

async function createOcrWorker() {
  const { createWorker } = await loadTesseract();

  return createWorker(["kor", "eng"], 1, {
    workerPath: "/vendor/tesseract-worker.min.js",
    corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_CORE_VERSION}`,
  });
}

async function extractTextFromPage(page) {
  const textContent = await page.getTextContent();

  return textContent.items
    .map((item) => (typeof item?.str === "string" ? item.str.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function recognizePageWithOcr(page, worker) {
  const viewport = page.getViewport({ scale: PDF_TEXT_RENDER_SCALE });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("OCR용 캔버스를 만들지 못했습니다.");
  }

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  try {
    const result = await worker.recognize(canvas);
    return String(result?.data?.text || "").replace(/\s+\n/g, "\n").trim();
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function buildPageSection(pageNumber, pageText) {
  const marker = `[Page ${pageNumber}]`;
  const cleaned = String(pageText || "").trim();

  return cleaned ? `${marker}\n${cleaned}` : marker;
}

function stripPageMarkers(value) {
  return String(value || "").replace(/\[Page \d+\]/g, "").trim();
}

function createReadablePdfError(error) {
  const name = error?.name || "";

  if (name === "PasswordException") {
    return new Error("비밀번호가 걸렸거나 암호화된 PDF는 읽을 수 없습니다.");
  }

  if (
    name === "InvalidPDFException" ||
    name === "FormatError" ||
    name === "MissingPDFException" ||
    name === "UnexpectedResponseException" ||
    name === "UnknownErrorException"
  ) {
    return new Error("읽을 수 없는 PDF입니다. 다른 파일로 다시 시도해 주세요.");
  }

  if (error instanceof Error && error.message) {
    return new Error(error.message);
  }

  return new Error("PDF를 처리하지 못했습니다. 다른 파일로 다시 시도해 주세요.");
}
