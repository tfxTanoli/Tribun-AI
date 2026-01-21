import { useState, useEffect, useRef, useCallback } from 'react';
import { audioService } from '../services/audioService';

interface UseSpeechRecognitionProps {
    onResult: (text: string) => void;
}

export const useSpeechRecognition = ({ onResult }: UseSpeechRecognitionProps) => {
    const [isListening, setIsListening] = useState<boolean>(false);
    const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
    const preListenInputRef = useRef<string>('');
    const shouldProcessResultRef = useRef<boolean>(false);

    const stopListening = useCallback(() => {
        // Immediately update UI state
        setIsListening(false);
        shouldProcessResultRef.current = false; // Ignore any subsequent results

        if (speechRecognitionRef.current) {
            try {
                speechRecognitionRef.current.stop();
            } catch (e) {
                // Ignore errors if already stopped
            }
        }
    }, []);

    const startListening = useCallback((currentInput: string) => {
        audioService.unlockAudio();
        audioService.cancel();

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("Speech Recognition API is not supported.");
            return;
        }

        // Always create a FRESH instance to ensure no old transcript history
        if (speechRecognitionRef.current) {
            // Safety cleanup of old instance
            speechRecognitionRef.current.onend = null;
            speechRecognitionRef.current.onerror = null;
            speechRecognitionRef.current.onresult = null;
            try { speechRecognitionRef.current.stop(); } catch (e) { }
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'es-MX';
        recognition.maxAlternatives = 1;

        preListenInputRef.current = currentInput ? currentInput.trim() + ' ' : '';
        shouldProcessResultRef.current = true; // Enable processing

        recognition.onstart = () => {
            // Confirm state (optimistic update might have already set it)
            if (shouldProcessResultRef.current) {
                setIsListening(true);
            }
        };

        recognition.onend = () => {
            // Only update state if we haven't manually stopped (natural end)
            // or to ensure sync.
            // If we manually stopped, isListening is already false.
            if (shouldProcessResultRef.current) {
                setIsListening(false);
                shouldProcessResultRef.current = false;
            }
        };

        recognition.onerror = (event) => {
            console.error("Speech recognition error", event.error);
            setIsListening(false);
            shouldProcessResultRef.current = false;
        };

        recognition.onresult = (event) => {
            if (!shouldProcessResultRef.current) return;

            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = 0; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            // Combine previous input with NEW fresh transcript
            onResult(preListenInputRef.current + finalTranscript + interimTranscript);
        };

        speechRecognitionRef.current = recognition;

        // Optimistic update
        setIsListening(true);
        try {
            recognition.start();
        } catch (error) {
            console.error("Error starting speech recognition:", error);
            setIsListening(false);
            shouldProcessResultRef.current = false;
        }
    }, []); // Only rebuild if dependencies change (none here ideally)

    const toggleListening = useCallback((currentInput: string) => {
        if (isListening) {
            stopListening();
        } else {
            startListening(currentInput);
        }
    }, [isListening, startListening, stopListening]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (speechRecognitionRef.current) {
                speechRecognitionRef.current.stop();
            }
        };
    }, []);

    return {
        isListening,
        toggleListening,
        stopListening
    };
};
