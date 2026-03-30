import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: "What is the weather in Tokyo?",
    config: {
      tools: [{ functionDeclarations: [{ name: "get_weather", description: "Get weather", parameters: { type: Type.OBJECT, properties: { location: { type: Type.STRING } } } }] }],
    }
  });
  console.log(JSON.stringify(response.candidates[0].content.parts, null, 2));
}
test();
