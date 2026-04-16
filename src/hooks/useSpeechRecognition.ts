import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";

// --- Ambient Type Declarations for Web Speech API ---
declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

interface SpeechRecognitionEvent {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

type SpeechRecognition = any;
// --------------------------------------------------

export function useSpeechRecognition(onTranscript: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any | null>(null);

  const startListening = useCallback(() => {
    const w = window as any;
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast.error("Speech recognition not supported in this browser.");
      return;
    }
    if (!recognitionRef.current) {
      const rec = new SpeechRecognitionAPI();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";
      rec.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) onTranscript(transcript);
        setIsListening(false);
      };
      rec.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error !== "aborted") toast.error(`Microphone error: ${event.error}`);
        setIsListening(false);
      };
      rec.onend = () => setIsListening(false);
      recognitionRef.current = rec;
    }
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e) {
      console.warn("Speech recognition start failed:", e);
      setIsListening(false);
    }
  }, [onTranscript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isListening, startListening, stopListening };
}
