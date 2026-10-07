import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger.js';

export class DocumentParser {
  private geminiClient: GoogleGenerativeAI | null = null;

  constructor() {
    if (env.GEMINI_API_KEY) {
      this.geminiClient = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
  }

  /**
   * Extracts clean, structured text from any kind of file:
   * - Documents: PDF (.pdf), Word (.docx), Plain text (.txt, .md, .csv, .json, .html)
   * - Images: .png, .jpg, .jpeg, .webp (via Multimodal Vision OCR)
   */
  async extractTextFromFile(params: {
    base64Data: string;
    filename: string;
    mimeType?: string;
  }): Promise<{ text: string; detectedTitle: string; pageOrItemCount?: number }> {
    const { base64Data, filename, mimeType } = params;

    // Clean base64 string (strip data:*/*;base64, prefix if present)
    const base64Clean = base64Data.replace(/^data:[^;]+;base64,/, '').trim();
    const resolvedMime = mimeType || this.detectMimeType(filename);
    const cleanFilename = filename || 'Uploaded Document';
    const baseTitle = cleanFilename.replace(/\.[^/.]+$/, '');

    logger.info({ filename: cleanFilename, mimeType: resolvedMime }, '📄 Processing file ingestion in RAG parser');

    // 1. Plain Text / Markdown / CSV / JSON formats
    if (
      resolvedMime.startsWith('text/') ||
      resolvedMime === 'application/json' ||
      /\.(txt|md|markdown|csv|json|html|xml|log)$/i.test(cleanFilename)
    ) {
      const buffer = Buffer.from(base64Clean, 'base64');
      const text = buffer.toString('utf-8');
      return {
        text: text.trim(),
        detectedTitle: baseTitle
      };
    }

    // 2. Images (OCR & Multimodal Document Understanding)
    if (resolvedMime.startsWith('image/')) {
      const extractedText = await this.extractWithGeminiMultimodal(
        base64Clean,
        resolvedMime,
        `You are an expert OCR and multimodal document analysis engine for a RAG knowledge base.
Analyze this image thoroughly and extract all information:
1. Transcribe all visible text, headings, policies, labels, product specifications, pricing, and numbers accurately.
2. If there are tables or diagrams, describe the data and relationships clearly.
3. Organize the extracted text using clear "TOPIC: [Topic Name]" section headers to make it optimal for semantic chunking.
4. Output the transcribed content directly with no conversational filler or commentary.`
      );

      return {
        text: extractedText.trim(),
        detectedTitle: `${baseTitle} (Image/OCR)`
      };
    }

    // 3. PDF Documents (Extract text locally first with PDFParse - zero quota limits)
    if (resolvedMime === 'application/pdf' || /\.pdf$/i.test(cleanFilename)) {
      try {
        const { createRequire } = await import('module');
        const req = createRequire(import.meta.url);
        const pdfModule = req('pdf-parse');

        const buf = Buffer.from(base64Clean, 'base64');
        const parser = new pdfModule.PDFParse({ data: buf });
        const result = await parser.getText();
        await parser.destroy().catch(() => {});

        const pdfText = result?.text
          ? result.text.replace(/-- \d+ of \d+ --/g, '').replace(/\n\s*\n\s*\n+/g, '\n\n').trim()
          : '';

        if (pdfText && pdfText.length > 20) {
          logger.info(
            { filename: cleanFilename, pages: result?.total, length: pdfText.length },
            '📄 Successfully extracted PDF text locally without API limits'
          );
          return {
            text: pdfText,
            detectedTitle: `${baseTitle} (PDF Document)`
          };
        }
      } catch (localPdfErr: any) {
        logger.warn({ filename: cleanFilename, err: localPdfErr?.message }, 'Local PDF text parse failed, trying multimodal fallback');
      }

      // Fallback: Gemini multimodal if PDF consists purely of scanned images
      const extractedText = await this.extractWithGeminiMultimodal(
        base64Clean,
        'application/pdf',
        `You are a high-precision document extraction engine for a RAG pipeline.
Extract all contents of this PDF document:
1. Preserve every section, paragraph, table, policy rule, bullet point, and detail verbatim.
2. Mark distinct sections with clear "TOPIC: [Section or Topic Name]" headers to facilitate semantic chunking.
3. Output only the extracted document text, preserving all original facts without summarizing or omitting anything.`
      );

      return {
        text: extractedText.trim(),
        detectedTitle: `${baseTitle} (PDF Document)`
      };
    }

    // 4. Word Documents (.docx)
    if (
      resolvedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      /\.docx$/i.test(cleanFilename)
    ) {
      // Extract text from raw XML or fallback to Gemini
      try {
        const textFromXml = this.extractDocxXml(base64Clean);
        if (textFromXml && textFromXml.length > 50) {
          return {
            text: textFromXml,
            detectedTitle: `${baseTitle} (Word Document)`
          };
        }
      } catch {}

      // Fallback: Gemini multimodal if applicable
      const extracted = await this.extractWithGeminiMultimodal(
        base64Clean,
        resolvedMime,
        'Extract all readable text, paragraphs, and sections from this document accurately. Use TOPIC: [Name] headers for distinct topics.'
      );
      return {
        text: extracted,
        detectedTitle: `${baseTitle} (Word Document)`
      };
    }

    // 5. General fallback: try decoding as UTF-8 or Gemini analysis
    try {
      const buffer = Buffer.from(base64Clean, 'base64');
      const text = buffer.toString('utf-8');
      // If it looks like mostly printable characters
      const printable = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
      if (printable.length / text.length > 0.85 && printable.trim().length > 20) {
        return {
          text: printable.trim(),
          detectedTitle: baseTitle
        };
      }
    } catch {}

    throw new Error(`Unsupported file format for "${cleanFilename}" (${resolvedMime}). Please upload text, PDF, Word, or image files.`);
  }

  /**
   * Calls Gemini Multimodal (Vision / PDF processing) to extract all text and topics
   */
  private async extractWithGeminiMultimodal(base64: string, mimeType: string, prompt: string): Promise<string> {
    if (!this.geminiClient) {
      throw new Error('Gemini API key is required to extract text from images or PDF documents');
    }

    const candidateModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        const model = this.geminiClient.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([
          prompt,
          {
            inlineData: {
              mimeType,
              data: base64
            }
          }
        ]);

        const text = result.response.text();
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      } catch (err: any) {
        lastError = err;
        logger.warn({ model: modelName, err: err?.message }, 'Failed extraction with model, trying next candidate');
      }
    }

    throw new Error(`Document/Image text extraction failed: ${lastError?.message || 'Gemini extraction error'}`);
  }

  /**
   * Simple zero-dependency XML text extractor for .docx (which is a ZIP containing word/document.xml)
   */
  private extractDocxXml(base64: string): string {
    const buffer = Buffer.from(base64, 'base64');
    const str = buffer.toString('binary');
    // Search for word/document.xml text markers
    const textMatches = str.match(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g);
    if (textMatches && textMatches.length > 0) {
      const extracted = textMatches
        .map((m) => m.replace(/<[^>]+>/g, ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return extracted;
    }
    return '';
  }

  private detectMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'webp': return 'image/webp';
      case 'gif': return 'image/gif';
      case 'pdf': return 'application/pdf';
      case 'txt': return 'text/plain';
      case 'md': return 'text/markdown';
      case 'csv': return 'text/csv';
      case 'json': return 'application/json';
      case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'html': return 'text/html';
      default: return 'application/octet-stream';
    }
  }
}

export const documentParser = new DocumentParser();
