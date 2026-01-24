
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import bodyParser from 'body-parser';

dotenv.config({ path: '.env.local' });

const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Increased limit for history

// Status check endpoint
app.get('/', (req, res) => {
    res.json({
        status: "online",
        message: "TribunAI Backend is running successfully",
        role: "API Server (Stateless)",
        timestamp: new Date().toISOString()
    });
});

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("ERROR: GEMINI_API_KEY is not set in .env.local");
    // Don't exit in production/Vercel - the error will surface at runtime
    if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
    }
}

const ai = apiKey ? new GoogleGenAI({ apiKey: apiKey }) : null;

// Helper to check if AI is initialized
const checkAI = (res) => {
    if (!ai) {
        res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
        return false;
    }
    return true;
};

app.post('/api/generate-context', async (req, res) => {
    if (!checkAI(res)) return;

    try {
        const { prompt } = req.body;
        const stream = await ai.models.generateContentStream({
            model: 'gemini-2.0-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { temperature: 0.8 }
        });

        res.setHeader('Content-Type', 'text/plain');

        for await (const chunk of stream) {
            const text = typeof chunk.text === 'function' ? chunk.text() : chunk.text;
            if (text) {
                res.write(text);
            }
        }
        res.end();
    } catch (error) {
        console.error("Error generating context:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * STATELESS CHAT START
 * Returns the initial AI response and the system instruction for re-use
 */
app.post('/api/chat/start', async (req, res) => {
    if (!checkAI(res)) return;

    try {
        const { systemInstruction, initialMessage } = req.body;

        const model = 'gemini-2.0-flash';

        // Create chat session (no persistence needed - just for this request)
        const chat = ai.chats.create({
            model: model,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.6,
            },
        });

        // Start the stream
        const result = await chat.sendMessageStream({ message: initialMessage });

        res.setHeader('Content-Type', 'text/plain');
        // Return system instruction hash for client to use in continue calls
        res.setHeader('X-System-Instruction-Hash', 'stateless-mode');

        for await (const chunk of result) {
            const text = typeof chunk.text === 'function' ? chunk.text() : chunk.text;
            if (text) {
                res.write(text);
            }
        }
        res.end();

    } catch (error) {
        console.error("Error starting chat:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * STATELESS CHAT CONTINUE
 * Accepts the full conversation history and system instruction
 * Recreates the chat context on each call
 */
app.post('/api/chat/continue', async (req, res) => {
    if (!checkAI(res)) return;

    try {
        const { systemInstruction, history, message } = req.body;

        if (!systemInstruction) {
            return res.status(400).json({ error: "systemInstruction is required for stateless mode" });
        }

        const model = 'gemini-2.0-flash';

        // Create chat session with history
        const chat = ai.chats.create({
            model: model,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.6,
            },
            history: history || [] // Pass conversation history to recreate context
        });

        // Send the new message
        const result = await chat.sendMessageStream({ message });

        res.setHeader('Content-Type', 'text/plain');
        for await (const chunk of result) {
            const text = typeof chunk.text === 'function' ? chunk.text() : chunk.text;
            if (text) {
                res.write(text);
            }
        }
        res.end();

    } catch (error) {
        console.error("Error continuing chat:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/ask-professor', async (req, res) => {
    if (!checkAI(res)) return;

    try {
        const { prompt } = req.body;
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        const text = typeof response.text === 'function' ? response.text() : response.text;
        res.json({ text });

    } catch (error) {
        console.error("Error asking professor:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/evaluate', async (req, res) => {
    if (!checkAI(res)) return;

    try {
        const { prompt, schema } = req.body;

        const config = {
            responseMimeType: "application/json",
        };

        if (schema) {
            config.responseSchema = schema;
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: config
        });

        const text = typeof response.text === 'function' ? response.text() : response.text;
        res.send(text);

    } catch (error) {
        console.error("Error evaluating:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/generate-config', async (req, res) => {
    if (!checkAI(res)) return;

    try {
        const { prompt, schema } = req.body;
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                responseMimeType: "application/json",
                responseSchema: schema
            }
        });
        const text = typeof response.text === 'function' ? response.text() : response.text;
        res.send(text);
    } catch (error) {
        console.error("Error generating config:", error);
        res.status(500).json({ error: error.message });
    }
});


// Export app for Vercel
export default app;

// Only listen locally
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}
