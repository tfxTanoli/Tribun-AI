
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const apiKey = process.env.VITE_GOOGLE_TTS_API_KEY;
console.log("Testing TTS Key: " + (apiKey ? "Loaded (" + apiKey.slice(-4) + ")" : "NOT LOADED"));

if (!apiKey) process.exit(1);

const url = `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`;

async function test() {
    console.log("Fetching Voices List from Google TTS...");
    try {
        const response = await fetch(url);
        console.log("Status:", response.status);

        if (response.ok) {
            const data = await response.json();
            console.log("Success! Found " + (data.voices ? data.voices.length : 0) + " voices.");
        } else {
            const text = await response.text();
            console.error("Error Body:", text);
        }

    } catch (e) {
        console.error("Fetch Error:", e);
    }
}

test();
