import { Speaker, VoiceSettings } from '../types';

interface AudioQueueItem {
    text: string;
    speaker: Speaker;
    id: string;
    audioUrl?: string; // Cache generated audio
}

interface VoiceConfig {
    languageCode: string;
    name: string;
    ssmlGender: 'MALE' | 'FEMALE' | 'NEUTRAL';
    pitch?: number;
    speakingRate?: number;
}


// Canonical source of truth for voice genders
const VOICE_METADATA: { [key: string]: 'MALE' | 'FEMALE' } = {
    // ES - Spain
    'es-ES-Neural2-B': 'MALE',
    'es-ES-Neural2-A': 'FEMALE',
    'es-ES-Neural2-E': 'FEMALE',
    'es-ES-Neural2-F': 'MALE',
    // US - Spanish (Replacing MX)
    'es-US-Neural2-B': 'MALE',
    'es-US-Neural2-A': 'FEMALE',
    'es-US-News-F': 'FEMALE',
    'es-US-Polyglot-1': 'MALE',
};

export class AudioService {
    private static instance: AudioService;
    private queue: AudioQueueItem[] = [];
    private isPlaying: boolean = false;
    private isPaused: boolean = false;
    private currentAudio: HTMLAudioElement | null = null;
    private audioContext: AudioContext | null = null;
    private apiKey: string;
    private isProcessingQueue: boolean = false;
    private nextAudioPreloading: boolean = false;

    // Voice mapping for each speaker
    private voiceMap: Map<Speaker, VoiceConfig> = new Map([
        [Speaker.JUEZ, {
            languageCode: 'es-ES',
            name: 'es-ES-Neural2-B', // Deep male voice (authority)
            ssmlGender: 'MALE',
            pitch: -2.0,
            speakingRate: 0.95
        }],
        [Speaker.MINISTERIO_PUBLICO, {
            languageCode: 'es-US',
            name: 'es-US-Neural2-B',
            ssmlGender: 'MALE',
            pitch: 0.0,
            speakingRate: 1.0
        }],
        [Speaker.DEFENSA, {
            languageCode: 'es-US',
            name: 'es-US-Neural2-A',
            ssmlGender: 'FEMALE',
            pitch: 1.0,
            speakingRate: 1.05
        }],
        [Speaker.TESTIGO, {
            languageCode: 'es-US', // Using generic LatAm/US
            name: 'es-US-News-F',
            ssmlGender: 'FEMALE',
            pitch: 2.0,
            speakingRate: 1.1
        }],
        [Speaker.PROFESOR, {
            languageCode: 'es-ES',
            name: 'es-ES-Neural2-F', // Warm female voice (educational)
            ssmlGender: 'FEMALE',
            pitch: 0.5,
            speakingRate: 0.9
        }]
    ]);

    private constructor() {
        // Get API key from environment
        this.apiKey = import.meta.env.VITE_GOOGLE_TTS_API_KEY || '';

        if (!this.apiKey) {
            console.warn('[AudioService] No API key found. Audio will be disabled.');
        }

        // Initialize AudioContext (will be unlocked on first user interaction)
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            this.audioContext = new AudioContextClass();
        } catch (error) {
            console.error('[AudioService] Failed to create AudioContext:', error);
        }
    }

    public static getInstance(): AudioService {
        if (!AudioService.instance) {
            AudioService.instance = new AudioService();
        }
        return AudioService.instance;
    }

    /**
     * Updates voice settings from the simulation config.
     * Call this before starting the simulation.
     */
    public updateVoiceSettings(settings: VoiceSettings): void {
        if (settings[Speaker.JUEZ]) {
            this.setVoiceForSpeaker(Speaker.JUEZ, settings[Speaker.JUEZ]);
        }
        if (settings[Speaker.MINISTERIO_PUBLICO]) {
            this.setVoiceForSpeaker(Speaker.MINISTERIO_PUBLICO, settings[Speaker.MINISTERIO_PUBLICO]);
        }
        if (settings[Speaker.DEFENSA]) {
            this.setVoiceForSpeaker(Speaker.DEFENSA, settings[Speaker.DEFENSA]);
        }
        if (settings[Speaker.TESTIGO]) {
            this.setVoiceForSpeaker(Speaker.TESTIGO, settings[Speaker.TESTIGO]);
        }
        console.log('[AudioService] Voice settings updated');
    }

    /**
     * Sets the voice for a specific speaker.
     */
    public setVoiceForSpeaker(speaker: Speaker, voiceId: string): void {
        const languageCode = voiceId.split('-').slice(0, 2).join('-'); // Extract 'es-ES' from 'es-ES-Neural2-B'

        // Strict gender lookup with fallback
        let gender: 'MALE' | 'FEMALE' = 'FEMALE'; // Default safety

        if (voiceId in VOICE_METADATA) {
            gender = VOICE_METADATA[voiceId];
        } else {
            console.warn(`[AudioService] Unknown voice ID: ${voiceId}, falling back to heuristic.`);
            // Heuristic fallback
            gender = voiceId.includes('Neural2-A') || voiceId.includes('Neural2-C') ||
                voiceId.includes('Neural2-E') || voiceId.includes('Standard-A')
                ? 'FEMALE' : 'MALE';
        }

        const currentConfig = this.voiceMap.get(speaker);
        this.voiceMap.set(speaker, {
            languageCode,
            name: voiceId,
            ssmlGender: gender,
            pitch: currentConfig?.pitch ?? 0,
            speakingRate: currentConfig?.speakingRate ?? 1.0
        });

        console.log(`[AudioService] Set ${speaker} to ${voiceId} (${gender})`);
    }

    /**
     * Cleans text for speech by removing non-verbal cues and markdown.
     */
    public cleanTextForSpeech(text: string): string {
        return text
            .replace(/\[.*?\]/g, '')       // Remove content in brackets [ ... ]
            .replace(/\*\*/g, '')          // Remove double asterisks
            .replace(/\*/g, '')            // Remove single asterisk
            .replace(/\(.*?\)/g, '')       // Remove content in parentheses
            .trim();
    }

    /**
     * Generates speech audio using Google Cloud Text-to-Speech API.
     */
    private async generateSpeech(text: string, speaker: Speaker): Promise<string | null> {
        if (!this.apiKey) {
            console.warn('[AudioService] Cannot generate speech without API key');
            return null;
        }

        const voiceConfig = this.voiceMap.get(speaker);
        if (!voiceConfig) {
            console.error(`[AudioService] No voice configuration for speaker: ${speaker}`);
            return null;
        }

        try {
            const payload = {
                input: { text },
                voice: {
                    languageCode: voiceConfig.languageCode,
                    name: voiceConfig.name,
                    ssmlGender: voiceConfig.ssmlGender
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    pitch: voiceConfig.pitch || 0,
                    speakingRate: voiceConfig.speakingRate || 1.0
                }
            };

            // console.log('[AudioService] Sending TTS request:', JSON.stringify(payload.voice));

            const response = await fetch(
                `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload)
                }
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('[AudioService] TTS API error:', response.status, JSON.stringify(errorData));
                console.error('[AudioService] Failed Payload:', JSON.stringify(payload));
                return null;
            }

            const data = await response.json();

            if (!data.audioContent) {
                console.error('[AudioService] No audio content in response');
                return null;
            }

            // Convert base64 audio to blob URL
            const audioBlob = this.base64ToBlob(data.audioContent, 'audio/mp3');
            const audioUrl = URL.createObjectURL(audioBlob);

            return audioUrl;

        } catch (error) {
            console.error('[AudioService] Error generating speech:', error);
            return null;
        }
    }

    /**
     * Converts base64 string to Blob.
     */
    private base64ToBlob(base64: string, mimeType: string): Blob {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);

        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }

        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }

    /**
     * Adds a message to the speech queue and starts processing.
     */
    public async speak(text: string, speaker: Speaker): Promise<void> {
        const cleanText = this.cleanTextForSpeech(text);
        if (!cleanText) return;

        const queueItem: AudioQueueItem = {
            text: cleanText,
            speaker,
            id: crypto.randomUUID()
        };

        this.queue.push(queueItem);
        console.log(`[AudioService] Queued for ${speaker}: "${cleanText}"`);

        // Start processing if not already processing
        if (!this.isProcessingQueue) {
            this.processQueue();
        }
    }

    /**
     * Processes the audio queue sequentially with optimized preloading.
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.queue.length > 0) {
            const currentItem = this.queue[0];

            // Wait if paused
            while (this.isPaused) {
                await this.sleep(100);
            }

            // Generate audio if not already cached
            if (!currentItem.audioUrl) {
                currentItem.audioUrl = await this.generateSpeech(currentItem.text, currentItem.speaker);
            }

            // If generation failed, skip this item
            if (!currentItem.audioUrl) {
                console.warn(`[AudioService] Skipping item due to generation failure: ${currentItem.id}`);
                this.queue.shift();
                continue;
            }

            // Preload next item in queue (latency optimization)
            if (this.queue.length > 1 && !this.nextAudioPreloading) {
                this.preloadNextAudio();
            }

            // Play current audio
            await this.playAudio(currentItem.audioUrl);

            // Remove completed item from queue
            this.queue.shift();

            // Clean up object URL to prevent memory leaks
            URL.revokeObjectURL(currentItem.audioUrl);
        }

        this.isProcessingQueue = false;
        this.isPlaying = false;
    }

    /**
     * Preloads the next audio in queue for reduced latency.
     */
    private async preloadNextAudio(): Promise<void> {
        if (this.queue.length < 2) return;

        this.nextAudioPreloading = true;
        const nextItem = this.queue[1];

        if (!nextItem.audioUrl) {
            nextItem.audioUrl = await this.generateSpeech(nextItem.text, nextItem.speaker);
        }

        this.nextAudioPreloading = false;
    }

    /**
     * Plays audio from URL and returns a promise that resolves when finished.
     */
    private playAudio(audioUrl: string): Promise<void> {
        return new Promise((resolve) => {
            this.currentAudio = new Audio(audioUrl);
            this.isPlaying = true;

            this.currentAudio.onended = () => {
                this.isPlaying = false;
                this.currentAudio = null;
                resolve();
            };

            this.currentAudio.onerror = (error) => {
                console.error('[AudioService] Audio playback error:', error);
                this.isPlaying = false;
                this.currentAudio = null;
                resolve(); // Resolve anyway to continue queue
            };

            this.currentAudio.play().catch((error) => {
                console.error('[AudioService] Failed to play audio:', error);
                this.isPlaying = false;
                this.currentAudio = null;
                resolve();
            });
        });
    }

    /**
     * Helper function to sleep for specified milliseconds.
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Stops all current and pending audio.
     */
    public cancel(): void {
        // Stop current audio
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }

        // Clear queue and clean up URLs
        this.queue.forEach(item => {
            if (item.audioUrl) {
                URL.revokeObjectURL(item.audioUrl);
            }
        });

        this.queue = [];
        this.isPlaying = false;
        this.isPaused = false;
        console.log('[AudioService] Audio cancelled');
    }

    /**
     * Pauses playback.
     */
    public pause(): void {
        if (this.currentAudio && !this.currentAudio.paused) {
            this.currentAudio.pause();
        }
        this.isPaused = true;
        console.log('[AudioService] Audio paused');
    }

    /**
     * Resumes playback.
     */
    public resume(): void {
        this.isPaused = false;
        if (this.currentAudio && this.currentAudio.paused) {
            this.currentAudio.play().catch(error => {
                console.error('[AudioService] Failed to resume audio:', error);
            });
        }
        console.log('[AudioService] Audio resumed');
    }

    /**
     * Unlocks audio context on user interaction (iOS/Android requirement).
     */
    public unlockAudio(): void {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().then(() => {
                console.log('[AudioService] Audio context unlocked');
            }).catch(error => {
                console.error('[AudioService] Failed to unlock audio context:', error);
            });
        }
    }

    /**
     * Gets current playing state (for UI binding).
     */
    public getIsPlaying(): boolean {
        return this.isPlaying;
    }

    /**
     * Gets current paused state (for UI binding).
     */
    public getIsPaused(): boolean {
        return this.isPaused;
    }
}

export const audioService = AudioService.getInstance();
