import { useState, useEffect, useRef, useCallback } from 'react';
import { audioService } from '../services/audioService';

interface UseSpeechRecognitionProps {
    onResult: (text: string) => void;
}

export const useSpeechRecognition = ({ onResult }: UseSpeechRecognitionProps) => {
    const [isListening, setIsListening] = useState<boolean>(false);
    const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
    const preListenInputRef = useRef<string>('');

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("Speech Recognition API is not supported in this browser.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'es-MX';
        recognition.maxAlternatives = 1;

        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => setIsListening(false);
        recognition.onerror = (event) => {
            console.error("Speech recognition error", event.error);
            if (speechRecognitionRef.current) {
                speechRecognitionRef.current.stop();
            }
            setIsListening(false);
        };

        recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = 0; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            // We pass the accumulated text back to the component
            // Note: This logic assumes the component handles the "current input" state.
            // In the original App.tsx, it appended to preListenInputRef.current.
            // Here we return the NEW speech part. Handling accumulation might be better in the parent or here.
            // To match App.tsx pattern:
            onResult(preListenInputRef.current + finalTranscript + interimTranscript);
        };

        speechRecognitionRef.current = recognition;

        return () => {
            if (speechRecognitionRef.current) {
                speechRecognitionRef.current.stop();
            }
        }
    }, [onResult]);

    const startListening = useCallback((currentInput: string) => {
        audioService.unlockAudio(); // Unlock audio context if needed for feedback
        audioService.cancel(); // Stop TTS when user wants to speak

        preListenInputRef.current = currentInput ? currentInput.trim() + ' ' : '';
        speechRecognitionRef.current?.start();
    }, []);

    const stopListening = useCallback(() => {
        speechRecognitionRef.current?.stop();
    }, []);

    const toggleListening = useCallback((currentInput: string) => {
        if (isListening) {
            stopListening();
        } else {
            startListening(currentInput);
        }
    }, [isListening, startListening, stopListening]);

    return {
        isListening,
        toggleListening,
        stopListening
    };
};
