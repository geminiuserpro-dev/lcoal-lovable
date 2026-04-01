export interface GeminiImageResponse {
  b64: string;
  mimeType: string;
  text?: string;
}

export const GeminiService = {
  /**
   * Generates an image from a text prompt via server-side API.
   */
  async generateImage(prompt: string): Promise<GeminiImageResponse> {
    const response = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generateImage", prompt }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to generate image via server.");
    }

    return await response.json();
  },

  /**
   * Edits an image (or images) based on a prompt via server-side API.
   */
  async editImage(prompt: string, images: { data: string; mimeType: string }[]): Promise<GeminiImageResponse> {
    const response = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "editImage", prompt, images }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to edit image via server.");
    }

    return await response.json();
  }
};
