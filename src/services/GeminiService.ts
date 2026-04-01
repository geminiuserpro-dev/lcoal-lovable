import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY || "";
const IMAGE_MODEL = "gemini-3.1-flash-image-preview";

// Initialize client once for performance
const genAI = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

export interface GeminiImageResponse {
  b64: string;
  mimeType: string;
  text?: string;
}

export const GeminiService = {
  /**
   * Generates an image from a text prompt.
   */
  async generateImage(prompt: string): Promise<GeminiImageResponse> {
    if (!genAI) throw new Error("GEMINI_API_KEY is not set or client failed to initialize.");

    const result = await (genAI as any).models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseModalities: ["IMAGE", "TEXT"],
      } as any,
    });

    const response = result.response;
    let b64 = "";
    let mimeType = "image/jpeg";
    let text = "";

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) {
        b64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || "image/jpeg";
      } else if (part.text) {
        text += part.text;
      }
    }

    if (!b64) {
      throw new Error("No image data returned from Gemini.");
    }

    return { b64, mimeType, text };
  },

  /**
   * Edits an image (or images) based on a prompt.
   */
  async editImage(prompt: string, images: { data: string; mimeType: string }[]): Promise<GeminiImageResponse> {
    if (!genAI) throw new Error("GEMINI_API_KEY is not set or client failed to initialize.");

    const parts: any[] = images.map(img => ({
      inlineData: { data: img.data, mimeType: img.mimeType }
    }));
    parts.push({ text: prompt });

    const result = await (genAI as any).models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: "user", parts }],
      config: {
        responseModalities: ["IMAGE", "TEXT"],
      } as any,
    });

    const response = result.response;
    let b64 = "";
    let mimeType = "image/jpeg";
    let text = "";

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) {
        b64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType;
      } else if (part.text) {
        text += part.text;
      }
    }

    if (!b64) {
      throw new Error("No image data returned from Gemini.");
    }

    return { b64, mimeType, text };
  }
};
