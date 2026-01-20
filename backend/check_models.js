import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load .env.local from current dir or parent
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const apiKey = process.env.GEMINI_API_KEY;
console.log("API Key present:", !!apiKey);
console.log("Key length:", apiKey ? apiKey.length : 0);

if (!apiKey) {
    console.error("No API KEY!");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: apiKey });

async function main() {
    try {
        console.log("Checking SDK structure...");
        // Only log keys to avoid massive output
        console.log("ai keys:", Object.keys(ai));
        if (ai.models) console.log("ai.models keys:", Object.keys(ai.models));

        console.log("\nAttempting to list models...");
        // Try common listing patterns
        let models = [];
        if (ai.models && ai.models.list) {
            const response = await ai.models.list();
            // response might be an iterable or have a 'models' property
            if (Array.isArray(response)) models = response;
            else if (response.models) models = response.models;
            else if (typeof response[Symbol.asyncIterator] === 'function') {
                for await (const m of response) models.push(m);
            } else {
                console.log("Unknown response format:", response);
            }
        }

        const output = models.map(m => `- ${m.name || m.displayName} (${m.supportedGenerationMethods})`).join('\n');
        console.log("Writing models to backend/models_list.txt");
        try {
            await import('fs/promises').then(fs => fs.writeFile(path.join(process.cwd(), 'backend', 'models_list.txt'), output));
            console.log("File written successfully.");
        } catch (err) {
            console.error("Failed to write output file:", err);
            console.log(output); // Fallback
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
