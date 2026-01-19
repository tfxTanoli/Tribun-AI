
import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const apiKey = process.env.GEMINI_API_KEY;
console.log("Testing API Key ending in: ..." + (apiKey ? apiKey.slice(-4) : "NONE"));
console.log("Full Key Length: " + (apiKey ? apiKey.length : 0));

if (!apiKey) {
    console.error("No API key found in .env.local!");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function testModel(modelName) {
    console.log(`\nAttempting model: ${modelName}`);
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: "Reply with 'OK' if you can hear me." }] }],
        });
        console.log(`SUCCESS with ${modelName}! Response:`, response.response.text());
        return true;
    } catch (error) {
        console.error(`FAILED with ${modelName}. Error: ${error.message}`);
        // console.error(JSON.stringify(error, null, 2));
        return false;
    }
}

async function runTests() {
    const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro', 'gemini-2.0-flash-exp'];

    for (const model of models) {
        const success = await testModel(model);
        if (success) {
            console.log("\n>>> API Key is VALID and working with at least one model.");
            process.exit(0);
        }
    }

    console.error("\n>>> API Key failed with all tested models.");
    process.exit(1);
}

runTests();
