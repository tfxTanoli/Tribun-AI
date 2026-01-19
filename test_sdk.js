
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: '.env.local' });

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey });

async function testGenerate() {
    try {
        console.log("Testing generateContent...");
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: 'Say hello' }] }]
        });

        console.log("Response Keys:", Object.keys(response));
        console.log("Full Response:", JSON.stringify(response, null, 2));

        if (response.response) {
            console.log("Has .response property");
        } else {
            console.log("Missing .response property");
        }

        if (typeof response.text === 'function') {
            console.log("Has .text() method");
            console.log("Text:", response.text());
        }

        if (typeof response.text === 'string') {
            console.log("Has .text property");
            console.log("Text:", response.text);
        }

    } catch (e) {
        console.error(e);
    }
}

testGenerate();
