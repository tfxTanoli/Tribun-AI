
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import bodyParser from 'body-parser';

dotenv.config({ path: '.env.local' });

const app = express();
const port = 3001; // Running on 3001 to avoid conflict with Vite (3000)

app.use(cors());
app.use(bodyParser.json());

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("ERROR: GEMINI_API_KEY is not set in .env.local");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: apiKey });

// In-memory store for chat sessions (Simple/Naive implementation for single-user dev)
// structure: { sessionId: { chatSession: ChatObject, history: [] } }
const sessions = {};

// Helper to generate system instruction (Copied from geminiService.ts logic)
// ideally this should be shared, but for now we duplicate to keep server standalone
const generateSystemInstruction = (config, dynamicContext) => {
    // ... [Logic from geminiService.ts needs to be migrated here]
    // Since the logic is complex and involves templating, we will accept the *compiled* systemInstruction from the client 
    // to avoid duplicating all the string templates and types here. 
    // Security Note: Trusting system prompt from client is acceptable here as we are protecting *keys*, 
    // not necessarily enforcing prompt strictness against the authorized user.
    return config.systemInstruction;
};

app.post('/api/generate-context', async (req, res) => {
    try {
        const { prompt } = req.body;
        const stream = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { temperature: 0.8 }
        });

        res.setHeader('Content-Type', 'text/plain');

        for await (const chunk of stream) {
            // SDK returns chunk.text as property, not method
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

app.post('/api/chat/start', async (req, res) => {
    try {
        const { systemInstruction, initialMessage, modelName } = req.body;
        const sessionId = uuidv4();

        const model = 'gemini-2.5-pro'; // Using available model

        const chat = ai.chats.create({
            model: model,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.6,
            },
        });

        sessions[sessionId] = chat;

        // Start the stream
        const result = await chat.sendMessageStream({ message: initialMessage });

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('X-Session-ID', sessionId); // Send session ID in header

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

app.post('/api/chat/continue', async (req, res) => {
    try {
        const { sessionId, message } = req.body;
        const chat = sessions[sessionId];

        if (!chat) {
            return res.status(404).json({ error: "Session not found or expired" });
        }

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
    try {
        const { prompt } = req.body;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
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
    try {
        const { prompt, schema } = req.body;

        // For structured output, we might need specific handling or just raw text parsing if schema passing is complex via JSON
        // The SDK supports responseSchema. 
        // We will pass the schema config if provided.

        const config = {
            responseMimeType: "application/json",
        };

        if (schema) {
            config.responseSchema = schema;
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
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
    try {
        const { prompt, schema } = req.body;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
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


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
